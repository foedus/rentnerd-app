#!/usr/bin/env bash
input=$(cat)
path=$(jq -r '.tool_input.file_path // empty' <<<"$input")
cmd=$(jq -r '.tool_input.command // empty' <<<"$input")
LOCKED='(tests/acceptance/|scripts/(guard|run-loop|verify|smoke-prod)\.sh|prompts/|\.claude/)'
rel="${path#${CLAUDE_PROJECT_DIR:-$PWD}/}"
if [[ -n "$path" ]] && grep -Eq "^${LOCKED}" <<<"$rel"; then
  echo "This file is locked. Fix the app, not the tests or harness. If something locked is wrong, mark the task blocked and explain in PROGRESS.md." >&2; exit 2
fi
W='(^|[[:space:];&|(])(sed -i|perl -i|rm|mv|cp|tee|truncate|chmod|ln|git checkout|git restore|git rm|git mv)[[:space:]][^|;&]*'
R='>[[:space:]]*[^[:space:]]*'
if grep -Eq "(${W}|${R})${LOCKED}" <<<"$cmd"; then
  echo "That command would change a locked file." >&2; exit 2
fi
if grep -Eq 'fly (apps|postgres|mpg|volumes|storage) (destroy|delete)|git push .*(-f|--force)|DROP (DATABASE|SCHEMA)|rm -rf /|acceptance-locked' <<<"$cmd"; then
  echo "Destructive command blocked." >&2; exit 2
fi
exit 0
