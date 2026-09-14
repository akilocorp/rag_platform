# @language  Python
# @updated   2026-09-14
# @changed   New package: transactional email bodies that aren't part of the auth flow. Created for the
#            collaborator invitations; `auth.py` keeps its own two senders, which predate this.
"""Transactional emails sent from outside the auth blueprint."""
