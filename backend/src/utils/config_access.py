# @language  Python
# @updated   2026-09-14
# @changed   New file: the one place that answers "may this user touch this config". Introduced with
#            collaborators — a config can now be edited by people who do not own it, and that fact has
#            to be expressed once rather than re-derived in each of the eleven blueprints that used to
#            compare `doc["user_id"]` to the JWT identity by hand.
"""Who may read, edit and administer a config.

TWO LEVELS, NOT A PERMISSION SYSTEM
    `owner`        the person who created it. Sole authority over destruction and
                   over the collaborator list itself.
    `collaborator` a co-teacher. Everything the owner can do with the exercise —
                   edit it, share it, read its results, run its live sessions —
                   and nothing that would take it away from the owner.

    That is the whole model. There is deliberately no role table and no per-verb
    grant: this exists so two people can teach the same class, and every extra
    level is a thing that can be set wrong.

WHY A FILTER AND NOT A CHECK
    Most call sites authorize by putting ownership INTO the Mongo query
    (`find_one({"_id": oid, "user_id": uid})`) rather than fetching and comparing
    afterwards — a shape chosen precisely so a later edit cannot forget the check.
    `editable_filter` keeps that property: it returns the `$or` to merge into the
    same query, so those call sites widen without inverting into fetch-then-test.

    `can_edit` / `is_owner` exist for the handful of places that already hold a
    document (a public config fetched without a JWT, a socket handler working off
    a cached doc) and cannot re-query cheaply.

THE COLLABORATOR LIST IS IDS, NOT EMAILS
    `collaborator_ids` holds stringified user `_id`s, because that is what the JWT
    identity is and what every query here compares against. Emails move between
    people and change case; an id does not. The email a person was invited by is
    kept alongside in `collaborators` for display only — see `collaborator_routes`.
"""
from typing import Dict, List, Optional

# The config-document field holding stringified user ids with edit access. Read in
# a dozen queries, so it is named once here.
COLLABORATOR_IDS = "collaborator_ids"

# Display metadata for the same people: [{user_id, email, username, added_at,
# added_by}]. Never authorize off this — it is denormalized for the collaborators
# panel and can lag a rename. `COLLABORATOR_IDS` is the authority.
COLLABORATORS_META = "collaborators"


def editable_filter(user_id: str) -> Dict:
    """Mongo filter fragment matching configs this user may edit.

    Merge into an existing query rather than replacing it:
        find_one({"_id": oid, **editable_filter(uid)})

    A falsy user_id yields a filter that matches nothing rather than everything —
    an anonymous caller reaching a route that forgot its `@jwt_required` must come
    back empty, not with the whole collection.
    """
    if not user_id:
        return {"_id": None}
    uid = str(user_id)
    return {"$or": [{"user_id": uid}, {COLLABORATOR_IDS: uid}]}


def is_owner(doc: Optional[Dict], user_id: str) -> bool:
    """True only for the person who created the config.

    The gate for deletion and for the collaborator list itself. Kept separate from
    `can_edit` so that a call site asking for one can never accidentally get the
    other — the two differ by exactly the powers that are irreversible.
    """
    if not doc or not user_id:
        return False
    return str(doc.get("user_id") or "") == str(user_id)


def can_edit(doc: Optional[Dict], user_id: str) -> bool:
    """True for the owner and for anyone on the collaborator list."""
    if not doc or not user_id:
        return False
    if is_owner(doc, user_id):
        return True
    return str(user_id) in {str(c) for c in (doc.get(COLLABORATOR_IDS) or [])}


def role_for(doc: Optional[Dict], user_id: str) -> Optional[str]:
    """"owner" / "collaborator" / None — what the client renders access from.

    Returned alongside the existing `owned` boolean rather than instead of it: a
    collaborator needs `owned` to be true to get the editing affordances at all,
    and needs to be told they are not the owner so the delete control stays hidden.
    """
    if is_owner(doc, user_id):
        return "owner"
    if can_edit(doc, user_id):
        return "collaborator"
    return None


def collaborator_ids(doc: Optional[Dict]) -> List[str]:
    """The stored id list, normalized to strings and de-duplicated."""
    seen, out = set(), []
    for raw in ((doc or {}).get(COLLABORATOR_IDS) or []):
        uid = str(raw)
        if uid and uid not in seen:
            seen.add(uid)
            out.append(uid)
    return out
