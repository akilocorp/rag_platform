"""Email the one-time results link to anonymous uploaders.

Mirrors auth.send_password_reset_email (smtplib + SMTPUTF8 policy). Called from
the pipeline worker once scoring completes. Must run inside an app context.
"""
import logging
import smtplib
from email import policy
from email.message import EmailMessage

from flask import current_app, render_template

logger = logging.getLogger(__name__)


def send_video_results_email(to_email: str, name: str, results_url: str) -> None:
    frontend_url = current_app.config.get('FRONTEND_URL', 'https://app.bitterlylab.com')
    body = (
        f"Hi {name or 'there'},\n\n"
        f"Your video presentation analysis is ready. View your scores and feedback here:\n\n"
        f"{results_url}\n\n"
        f"This is a private link tied to your submission — keep it to yourself.\n"
    )
    try:
        html = render_template('email/video_results.html', results_url=results_url,
                               name=name or '', logo_url=f"{frontend_url}/Logo.svg")
    except Exception:
        html = f"<p>Hi {name or 'there'},</p><p>Your video analysis is ready: " \
               f"<a href='{results_url}'>View results</a></p>"

    sender = current_app.config.get('MAIL_USERNAME') or current_app.config.get('MAIL_DEFAULT_SENDER') or 'noreply@actrlab.com'
    if isinstance(sender, (list, tuple)):
        sender = sender[-1]

    msg = EmailMessage(policy=policy.SMTPUTF8)
    msg['Subject'] = 'Your video presentation results are ready'
    msg['From'] = sender
    msg['To'] = to_email
    msg.set_content(body)
    msg.add_alternative(html, subtype='html')

    server = smtplib.SMTP(current_app.config.get('MAIL_SERVER', 'localhost'),
                          current_app.config.get('MAIL_PORT', 587), local_hostname='localhost')
    try:
        if current_app.config.get('MAIL_USE_TLS', True):
            server.starttls()
        mu, mp = current_app.config.get('MAIL_USERNAME'), current_app.config.get('MAIL_PASSWORD')
        if mu and mp:
            server.login(mu, mp)
        server.send_message(msg)
        logger.info("Video results email sent to %s", to_email)
    finally:
        server.quit()
