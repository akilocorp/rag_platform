# @language  Python
# @updated   2026-09-14
# @changed   New file: add someone to a config by email. A registered address is added on the spot and
#            the config appears in their dashboard; an unregistered one gets a `config_invites` token
#            and a signup link, redeemed by `auth.register` when they create the account.
"""Collaborators on a config.

WHAT THIS IS FOR
    Two people teaching the same class need to edit the same exercise. Before this
    the only way to share one was `POST /config/{id}/copy`, which hands over a
    DUPLICATE — from that moment the two drift, and the student data sits under
    whichever copy the class actually used. A collaborator edits the original.

OWNER VERSUS COLLABORATOR
    Adding and removing collaborators is the owner's alone, and so is deleting the
    config. Everything else a collaborator can do — see `src/utils/config_access`,
    which is the authority both this file and every gated blueprint read.

    That asymmetry is the point: a co-teacher should be able to run the class
    without being able to take it away from the person who built it.

THE TWO PATHS AN EMAIL CAN TAKE
    registered    the address already has an account. They are added immediately
                  and the config shows up in their dashboard on next load; the
                  email that follows is a courtesy, not a gate. There is no accept
                  step, because the owner typing a colleague's address IS the
                  decision and a pending state nobody notices helps no one.

    unregistered  a `config_invites` row keyed by a URL-safe token, plus an email
                  with a signup link. The token is redeemed at registration (see
                  `auth._redeem_pending_invites`), so access arrives with the
                  account rather than needing a second visit.

    An invite is bound to the EMAIL, not to whoever opens the link: redemption
    matches on the address the new account was created with. A forwarded link
    therefore does nothing for the forwarder, which is the property that makes it
    safe to send one to an address that does not exist yet.
"""
import logging
import re
import secrets
from datetime import datetime, timedelta, timezone

from bson import ObjectId
from bson.errors import InvalidId
from flask import Blueprint, current_app, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required

from models.config import Config
from models.user import User
from src.utils.config_access import (COLLABORATOR_IDS, COLLABORATORS_META,
                                     can_edit, is_owner)
from src.utils.emails.collaborator import (send_collaborator_added_email,
                                           send_collaborator_invite_email)

logger = logging.getLogger(__name__)

collaborator_bp = Blueprint('collaborator_bp', __name__)

# How long an unredeemed signup invite stays valid. Longer than the 7-day clipboard
# token from `config_routes`: that one is pasted in the same sitting, this one waits
# on someone to read their email and create an account, which realistically spans a
# weekend or a term break.
INVITE_TTL_DAYS = 30

# Keeps a typo'd address from being stored as a pending invite forever. Deliberately
# permissive — this rejects "not an email", not unusual-but-valid addresses.
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s.]+\.[^@\s]+$")

_invite_indexes_ready = False


def _invites_collection():
    """`config_invites` with its indexes, created once per process.

    Mirrors `config_routes._transfers_collection`, including why reads still check
    `expires_at` by hand: the TTL monitor only sweeps about once a minute, so an
    expired token stays fetchable for up to that long after it dies.
    """
    global _invite_indexes_ready
    col = current_app.config['MONGO_DB']['config_invites']
    if not _invite_indexes_ready:
        try:
            col.create_index('token', unique=True)
            col.create_index('expires_at', expireAfterSeconds=0)
            # Redemption looks invites up by address at registration time, and the
            # owner's panel lists them per config.
            col.create_index('email')
            col.create_index('config_id')
        except Exception as e:  # noqa: BLE001 — a missing index must not fail a request
            current_app.logger.warning(f"config_invites index setup failed: {e}")
        _invite_indexes_ready = True
    return col


def _norm_email(value) -> str:
    """The one spelling of an address used for storage and every comparison.

    `User.create` already lowercases on write, so matching anything else here would
    silently fail to find accounts that do exist.
    """
    return (value or "").strip().lower()


def _load_config_for(config_id, user_id, owner_only=False):
    """Fetch a config the caller may act on, or (None, error_response).

    `owner_only` separates the two authority levels at the one place they diverge,
    so no route has to remember which of its verbs is which.
    """
    try:
        oid = ObjectId(config_id)
    except (InvalidId, Exception):  # noqa: BLE001
        return None, (jsonify({"error": "Invalid config id"}), 400)

    doc = Config.get_collection().find_one({"_id": oid})
    if not doc:
        return None, (jsonify({"error": "Configuration not found"}), 404)

    permitted = is_owner(doc, user_id) if owner_only else can_edit(doc, user_id)
    if not permitted:
        # 404 rather than 403 for a caller with no access at all: a stranger probing
        # ids should not learn which ones exist. A collaborator hitting an
        # owner-only verb gets a 403, because they already know it exists.
        if owner_only and can_edit(doc, user_id):
            return None, (jsonify({"error": "Only the owner can manage collaborators"}), 403)
        return None, (jsonify({"error": "Configuration not found"}), 404)
    return doc, None


def _person(doc, user_id, role):
    """One row of the collaborators panel.

    Reads the live user record rather than the denormalized copy on the config so a
    changed username or address shows through; falls back to what was stored at
    invite time when the account has since been deleted.
    """
    stored = next((c for c in (doc.get(COLLABORATORS_META) or [])
                   if str(c.get("user_id")) == str(user_id)), {})
    user = User.find_by_id(user_id) or {}
    return {
        "user_id": str(user_id),
        "email": user.get("email") or stored.get("email") or "",
        "username": user.get("username") or stored.get("username") or "",
        "role": role,
        "status": "active",
        "added_at": (stored.get("added_at").isoformat()
                     if hasattr(stored.get("added_at"), "isoformat") else None),
    }


def _roster(doc):
    """Owner first, then collaborators, then anyone still to create an account.

    One list rather than three, because the panel renders it as one list — the
    caller should not have to interleave them to show who has access.
    """
    people = [_person(doc, doc.get("user_id"), "owner")]
    for uid in (doc.get(COLLABORATOR_IDS) or []):
        people.append(_person(doc, uid, "collaborator"))

    now = datetime.now(timezone.utc)
    pending = []
    for inv in _invites_collection().find({"config_id": str(doc["_id"]), "accepted_at": None}):
        exp = inv.get("expires_at")
        if exp and exp.replace(tzinfo=exp.tzinfo or timezone.utc) <= now:
            continue
        pending.append({
            "user_id": None,
            "email": inv.get("email", ""),
            "username": "",
            "role": "collaborator",
            "status": "pending",
            # The token is the revoke handle. Safe to show the owner — they minted
            # it, and it grants access only to the address it was issued for.
            "token": inv.get("token"),
            "added_at": (inv["created_at"].isoformat() if inv.get("created_at") else None),
        })
    return people + pending


@collaborator_bp.route('/config/<string:config_id>/collaborators', methods=['GET'])
@jwt_required()
def list_collaborators(config_id):
    """Everyone with access, including invites not yet redeemed.

    Readable by collaborators, not just the owner: someone editing a shared config
    needs to know who else is in it, and the list is not sensitive to the people
    already on it.
    """
    doc, error = _load_config_for(config_id, get_jwt_identity())
    if error:
        return error
    return jsonify({
        "collaborators": _roster(doc),
        "is_owner": is_owner(doc, get_jwt_identity()),
        "bot_name": doc.get("bot_name") or "Untitled",
    }), 200


@collaborator_bp.route('/config/<string:config_id>/collaborators', methods=['POST'])
@jwt_required()
def add_collaborator(config_id):
    """Owner-only. Add by email — registered users immediately, others by invite."""
    user_id = get_jwt_identity()
    doc, error = _load_config_for(config_id, user_id, owner_only=True)
    if error:
        return error

    email = _norm_email((request.get_json(silent=True) or {}).get('email'))
    if not email or not _EMAIL_RE.match(email):
        return jsonify({"error": "Enter a valid email address."}), 400

    owner = User.find_by_id(user_id) or {}
    if email == _norm_email(owner.get('email')):
        return jsonify({"error": "That's your own address — you already own this."}), 400

    bot_name = doc.get("bot_name") or "an assistant"
    invitee = User.find_by_email(email)

    # ---- already has an account: add now, tell them after -------------------
    if invitee:
        target_id = str(invitee["_id"])
        if target_id in {str(c) for c in (doc.get(COLLABORATOR_IDS) or [])}:
            return jsonify({"error": "They already have access."}), 409

        Config.get_collection().update_one(
            {"_id": doc["_id"]},
            {"$addToSet": {
                COLLABORATOR_IDS: target_id,
                COLLABORATORS_META: {
                    "user_id": target_id,
                    "email": email,
                    "username": invitee.get("username") or "",
                    "added_at": datetime.now(timezone.utc),
                    "added_by": str(user_id),
                },
            }},
        )
        # A failed send must not undo access that is already granted — the config is
        # in their dashboard either way, which is what the feature promised.
        try:
            send_collaborator_added_email(email, owner.get('username') or 'A colleague', bot_name)
        except Exception as e:  # noqa: BLE001
            current_app.logger.warning(f"Collaborator email to {email} failed: {e}")

        fresh = Config.get_collection().find_one({"_id": doc["_id"]})
        return jsonify({"collaborators": _roster(fresh), "status": "added"}), 201

    # ---- no account yet: mint an invite and email a signup link -------------
    col = _invites_collection()
    now = datetime.now(timezone.utc)
    existing = col.find_one({"config_id": str(doc["_id"]), "email": email, "accepted_at": None})
    if existing:
        # Re-inviting is how an owner resends a link somebody lost, so it refreshes
        # the existing token's clock instead of erroring or littering duplicates.
        token = existing["token"]
        col.update_one({"_id": existing["_id"]},
                       {"$set": {"expires_at": now + timedelta(days=INVITE_TTL_DAYS)}})
    else:
        token = secrets.token_urlsafe(24)
        col.insert_one({
            "token": token,
            "config_id": str(doc["_id"]),
            "email": email,
            "bot_name": bot_name,
            "invited_by": str(user_id),
            "invited_by_name": owner.get('username') or '',
            "created_at": now,
            "expires_at": now + timedelta(days=INVITE_TTL_DAYS),
            "accepted_at": None,
        })

    try:
        send_collaborator_invite_email(email, owner.get('username') or 'A colleague', bot_name, token)
    except Exception as e:  # noqa: BLE001
        # Here the send IS the delivery mechanism — a stored token nobody received
        # grants nothing — so the owner is told rather than shown a false success.
        current_app.logger.error(f"Invite email to {email} failed: {e}")
        return jsonify({
            "error": "Couldn't send the invitation email. The invite is saved — try resending.",
            "collaborators": _roster(doc),
        }), 502

    return jsonify({"collaborators": _roster(doc), "status": "invited"}), 201


@collaborator_bp.route('/config/<string:config_id>/collaborators/<string:target_id>',
                       methods=['DELETE'])
@jwt_required()
def remove_collaborator(config_id, target_id):
    """Owner-only. Revoke an active collaborator's access.

    Their edits stay — this removes a person from the config, it does not roll back
    what they did while they had it, and anything they uploaded belongs to the
    config's knowledge base rather than to them.
    """
    doc, error = _load_config_for(config_id, get_jwt_identity(), owner_only=True)
    if error:
        return error

    Config.get_collection().update_one(
        {"_id": doc["_id"]},
        {"$pull": {COLLABORATOR_IDS: str(target_id),
                   COLLABORATORS_META: {"user_id": str(target_id)}}},
    )
    fresh = Config.get_collection().find_one({"_id": doc["_id"]})
    return jsonify({"collaborators": _roster(fresh)}), 200


@collaborator_bp.route('/config/<string:config_id>/invites/<string:token>', methods=['DELETE'])
@jwt_required()
def revoke_invite(config_id, token):
    """Owner-only. Withdraw an invitation before the account is created.

    Deleted outright rather than flagged: an invite is only ever read by redemption
    and by the panel, and neither has any use for a withdrawn one.
    """
    doc, error = _load_config_for(config_id, get_jwt_identity(), owner_only=True)
    if error:
        return error

    _invites_collection().delete_one({"token": token, "config_id": str(doc["_id"])})
    return jsonify({"collaborators": _roster(doc)}), 200


@collaborator_bp.route('/collab-invite/<string:token>', methods=['GET'])
def preview_invite(token):
    """Public. What the registration page shows someone arriving from an invite link.

    Unauthenticated by necessity — the whole point is that this person has no
    account yet. It returns only what the email they were sent already told them
    (which config, who invited them, which address it is for), so serving it to a
    stranger who guessed a 24-byte token leaks nothing they could act on.
    """
    inv = _invites_collection().find_one({"token": (token or "").strip(), "accepted_at": None})
    if not inv:
        return jsonify({"error": "This invitation is no longer valid."}), 404

    exp = inv.get("expires_at")
    if exp and exp.replace(tzinfo=exp.tzinfo or timezone.utc) <= datetime.now(timezone.utc):
        return jsonify({"error": "This invitation has expired."}), 404

    return jsonify({
        "email": inv.get("email", ""),
        "bot_name": inv.get("bot_name", "an assistant"),
        "invited_by": inv.get("invited_by_name", ""),
        # Tells the page whether to send them to sign-in instead of registration —
        # an invited colleague may have created an account in the meantime.
        "has_account": bool(User.find_by_email(inv.get("email", ""))),
    }), 200


def redeem_invites_for(email, user_id):
    """Grant every pending invite for this address. Called after an account is made.

    Lives here rather than in `auth` so the invite schema has exactly one reader.
    Matching is on the EMAIL the account was created with, which is what stops a
    forwarded link from granting access to whoever opened it.

    Never raises: a registration must not fail because a config was deleted while
    its invitation sat unread.
    """
    granted = []
    try:
        col = _invites_collection()
        now = datetime.now(timezone.utc)
        for inv in col.find({"email": _norm_email(email), "accepted_at": None}):
            exp = inv.get("expires_at")
            if exp and exp.replace(tzinfo=exp.tzinfo or timezone.utc) <= now:
                continue
            try:
                oid = ObjectId(inv["config_id"])
            except (InvalidId, Exception):  # noqa: BLE001
                continue
            result = Config.get_collection().update_one(
                {"_id": oid},
                {"$addToSet": {
                    COLLABORATOR_IDS: str(user_id),
                    COLLABORATORS_META: {
                        "user_id": str(user_id),
                        "email": _norm_email(email),
                        "username": "",
                        "added_at": now,
                        "added_by": inv.get("invited_by", ""),
                    },
                }},
            )
            # The config may have been deleted since the invite was sent. Burn the
            # token anyway so it stops appearing as pending forever.
            col.update_one({"_id": inv["_id"]},
                           {"$set": {"accepted_at": now, "accepted_user_id": str(user_id)}})
            if result.matched_count:
                granted.append(inv["config_id"])
    except Exception as e:  # noqa: BLE001
        logger.error("Redeeming invites for %s failed: %s", email, e)
    return granted
