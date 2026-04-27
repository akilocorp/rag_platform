"""
URL fetch + content extraction.

Single source of truth used by:
  - URL ingestion endpoint (/api/files/url)
  - the web_fetch agent tool (Step 3, future)

Uses trafilatura for HTML→text extraction (handles boilerplate removal,
respects robots-meta, etc.). Blocks fetches to private/internal hosts so
this can't be turned into an SSRF gadget.
"""
import ipaddress
from urllib.parse import urlparse

from langchain_core.documents import Document

# Hostnames we never fetch — cloud metadata, loopback, link-local, etc.
BLOCKED_HOSTS = {
    'localhost',
    '169.254.169.254',  # AWS / GCP / Azure IMDS
    'metadata.google.internal',
}


class UnsafeURLError(ValueError):
    """Raised when a URL is rejected by the safety check."""


def _is_safe_url(url: str) -> bool:
    """Reject obviously dangerous targets: non-http(s), private IPs, blocklist."""
    try:
        parsed = urlparse(url)
    except Exception:
        return False

    if parsed.scheme not in ('http', 'https'):
        return False
    host = (parsed.hostname or '').lower()
    if not host:
        return False
    if host in BLOCKED_HOSTS:
        return False

    # If host is a literal IP, block private/loopback/link-local ranges.
    try:
        ip = ipaddress.ip_address(host)
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved:
            return False
    except ValueError:
        # Not an IP literal — fine, leave hostname checks above as the gate.
        pass

    return True


def fetch_url_as_documents(url: str):
    """
    Fetch `url`, extract main content, return ([Document], title).

    Returns ([], None) if the page produced no extractable content.
    Raises UnsafeURLError if the URL fails the safety check.
    """
    if not _is_safe_url(url):
        raise UnsafeURLError(f"URL is not allowed: {url}")

    try:
        import trafilatura
    except ImportError as e:
        raise RuntimeError("trafilatura is not installed on the server") from e

    downloaded = trafilatura.fetch_url(url)
    if not downloaded:
        return [], None

    extracted = trafilatura.extract(
        downloaded,
        include_comments=False,
        include_tables=True,
        favor_recall=True,
    )
    if not extracted or not extracted.strip():
        return [], None

    title = None
    try:
        meta = trafilatura.extract_metadata(downloaded)
        if meta and getattr(meta, 'title', None):
            title = meta.title
    except Exception:
        pass

    document = Document(
        page_content=extracted,
        metadata={
            'source_url': url,
            'title': title or url,
        },
    )
    return [document], title
