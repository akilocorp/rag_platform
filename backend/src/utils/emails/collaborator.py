# @language  Python
# @updated   2026-09-14
# @changed   New file: the two collaborator emails — "you've been added" for an address that already
#            has an account, and "create an account to join" for one that doesn't.
"""Collaborator notification and invitation emails.

Mirrors `auth.send_password_reset_email` and `video.notify` — the same smtplib +
SMTPUTF8 shape, the same `MAIL_*` config keys, the same plain-text fallback beside
the HTML part. Kept as one `_send` here so the two bodies below differ only in
what they say.

WHY THE TWO ARE SEPARATE FUNCTIONS AND NOT ONE WITH A FLAG
    They are different messages with different asks. The added-email tells someone
    the config is already in their dashboard and links them straight to it; the
    invite-email asks them to create an account first and is useless without its
    token. Collapsing them behind `if token:` would put that branch in the caller.
"""
import logging
import smtplib
from email import policy
from email.message import EmailMessage
from urllib.parse import quote

from flask import current_app, render_template

logger = logging.getLogger(__name__)


def _frontend_url() -> str:
    return current_app.config.get('FRONTEND_URL', 'https://app.bitterlylab.com').rstrip('/')


def _send(to_email: str, subject: str, text_body: str, template: str, **ctx) -> None:
    """One SMTP send with an HTML part and a plain-text fallback.

    Raises on failure rather than swallowing: the two callers want opposite
    behaviour — adding a registered user logs and carries on, while a failed invite
    is a failed delivery and has to surface — so the decision belongs to them.
    """
    frontend = _frontend_url()
    try:
        html = render_template(template, logo_url=f"{frontend}/Logo.svg", **ctx)
    except Exception:  # noqa: BLE001 — a missing template must not block the email
        html = "<p>" + text_body.replace("\n\n", "</p><p>").replace("\n", "<br/>") + "</p>"

    sender = (current_app.config.get('MAIL_USERNAME')
              or current_app.config.get('MAIL_DEFAULT_SENDER')
              or 'noreply@actrlab.com')
    if isinstance(sender, (list, tuple)):
        sender = sender[-1]

    msg = EmailMessage(policy=policy.SMTPUTF8)
    msg['Subject'] = subject
    msg['From'] = sender
    msg['To'] = to_email
    msg.set_content(text_body)
    msg.add_alternative(html, subtype='html')

    server = smtplib.SMTP(current_app.config.get('MAIL_SERVER', 'localhost'),
                          current_app.config.get('MAIL_PORT', 587),
                          local_hostname='localhost')
    try:
        if current_app.config.get('MAIL_USE_TLS', True):
            server.starttls()
        mu, mp = current_app.config.get('MAIL_USERNAME'), current_app.config.get('MAIL_PASSWORD')
        if mu and mp:
            server.login(mu, mp)
        server.send_message(msg)
        logger.info("Collaborator email (%s) sent to %s", template, to_email)
    finally:
        server.quit()


def send_collaborator_added_email(to_email: str, inviter: str, bot_name: str) -> None:
    """Someone with an account was given access. Links to the dashboard, not a token.

    There is nothing to accept — access is already live — so this deliberately has
    no call to action that could be mistaken for one.
    """
    url = f"{_frontend_url()}/config_list"
    text = (
        f"{inviter} added you as a collaborator on \"{bot_name}\".\n\n"
        f"It's in your dashboard now — you can edit it, share it and see its results:\n\n"
        f"{url}\n"
    )
    _send(to_email, f'{inviter} shared "{bot_name}" with you',
          text, 'email/collaborator_added.html',
          inviter=inviter, bot_name=bot_name, dashboard_url=url)


def send_collaborator_invite_email(to_email: str, inviter: str, bot_name: str, token: str) -> None:
    """No account yet. The link carries the token that grants access at signup.

    The address is NOT put in the URL: redemption matches on whatever address the
    new account is created with, and the server already knows which one the token
    was issued for. Putting it in the link would only make it editable.
    """
    url = f"{_frontend_url()}/register?invite={quote(token)}"
    text = (
        f"{inviter} invited you to collaborate on \"{bot_name}\" in ACTR Lab.\n\n"
        f"You'll need an account first. Create one here and \"{bot_name}\" will be "
        f"waiting in your dashboard:\n\n{url}\n\n"
        f"This invitation is for {to_email} — sign up with that address to claim it.\n"
    )
    _send(to_email, f'{inviter} invited you to collaborate on "{bot_name}"',
          text, 'email/collaborator_invite.html',
          inviter=inviter, bot_name=bot_name, invite_url=url, invited_email=to_email)
