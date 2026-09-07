# @language  Python
# @updated   2026-09-07
# @changed   New file: extracted from test_email.py and test_verification_email.py, which had
#            this getfqdn patch copy-pasted verbatim (with a minor signature difference). Both
#            scripts now call patch_getfqdn() instead of redefining it locally.
import socket

_orig_getfqdn = socket.getfqdn


def patch_getfqdn():
    """Some hosts (notably Windows machines with a non-ASCII hostname) make smtplib's EHLO
    raise UnicodeEncodeError inside socket.getfqdn(). Falling back to a plain ASCII name keeps
    SMTP working without touching mail server config. Call once, before importing flask_mail."""
    def _safe_getfqdn(name=""):
        try:
            result = _orig_getfqdn(name)
            result.encode("ascii")
            return result
        except (UnicodeEncodeError, AttributeError):
            return name or "localhost"
    socket.getfqdn = _safe_getfqdn
