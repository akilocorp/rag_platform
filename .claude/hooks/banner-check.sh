#!/usr/bin/env bash
# @language  Bash
# @updated   2026-07-10
# @changed   New: PostToolUse banner-enforcement hook for the debug skill.
#
# Fires after Edit / Write / MultiEdit. Reads the hook payload on stdin and, if
# the edited file is a source file whose header banner is missing or whose
# @updated date is not today, injects a reminder back into Claude's context to
# add/refresh the banner per the `debug` skill. Silent (exit 0, no output) when
# the file is already compliant or isn't a source file.

set -euo pipefail

# Pull the touched file path out of the hook's stdin JSON.
payload=$(cat)
file=$(printf '%s' "$payload" | jq -r '.tool_input.file_path // .tool_response.filePath // empty')

# No path, or the file is gone from disk -> nothing to enforce.
{ [ -n "$file" ] && [ -f "$file" ]; } || exit 0

# Scope gate: only real source files carry the banner. Data / config / docs
# (json, md, geojson, lockfiles, images, csv, txt) are intentionally exempt.
base=$(basename "$file")
case "$base" in
  Dockerfile|Dockerfile.*) ;;  # source with no extension
  *.js|*.jsx|*.ts|*.tsx|*.mjs|*.cjs|*.py|*.css|*.scss|*.html|*.sh|*.bash|*.yml|*.yaml|*.sql|*.lua|*.go|*.java|*.rb|*.php|*.c|*.cpp|*.h|*.hpp) ;;
  *) exit 0 ;;
esac

today=$(date +%F)

# Compliant = all three banner tags present AND @updated stamped with today.
if grep -qE '@language' "$file" \
   && grep -qE '@changed' "$file" \
   && grep -qE "@updated[[:space:]]+$today" "$file"; then
  exit 0
fi

# Non-compliant -> hand Claude an instruction to fix the banner (non-blocking).
reason="File '$file' is missing the required header banner, or its @updated date is not today ($today). Per the debug skill, add or refresh a banner at the very top of this file (after any shebang/pragma) using the file's native comment syntax, with three fields: @language, @updated $today, and @changed (a one-line tagline of what you just changed). Then continue."

jq -n --arg r "$reason" \
  '{hookSpecificOutput: {hookEventName: "PostToolUse", additionalContext: $r}}'
