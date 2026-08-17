# @language  Python
# @updated   2026-08-12
# @changed   New package: the syllabus advisor — reads a professor's syllabus and says which class
#            sessions a platform feature actually fits, and which ones it does not.
"""The syllabus advisor.

A professor uploads the syllabus they already teach from; the advisor reads it
session by session and recommends, per session, which platform feature (if any)
fits — with the syllabus line that justifies the call and what the professor
would have to supply to run it.

Three stages, deliberately split so the judgment call is isolated:

  - `catalog`  — the hand-written feature catalog. The ONLY description of the
                 platform the model ever reasons against. Editing what the
                 advisor believes about a feature means editing this file.
  - `syllabus` — `extract_sessions` (text -> structured sessions),
                 `recommend` (sessions + catalog -> recommendations), and
                 `validate` (deterministic checks that drop unfounded claims).
  - `routes/advisor_routes.py` — the HTTP surface and the logged-out gate.

Nothing here creates or edits a config. The advisor only ever *recommends*; the
professor still builds the assistant themselves.
"""
