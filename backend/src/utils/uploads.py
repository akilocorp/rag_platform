# @language  Python
# @updated   2026-09-07
# @changed   New file: single source of truth for the knowledge-base allowed-extensions check,
#            replacing three byte-identical copies (config_routes.py, edit_config_routes.py,
#            user_files.py) that had already started drifting (only user_files.py enforced a
#            file-size cap). Extension list only — MAX_FILE_SIZE stays local to user_files.py,
#            since adding that cap to the other two upload paths is a behavior change, not a
#            pure dedup, and needs its own decision.
ALLOWED_EXTENSIONS = {'txt', 'pdf', 'md', 'docx', 'pptx'}


def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS
