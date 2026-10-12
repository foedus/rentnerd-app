#!/usr/bin/env bash
input=$(cat)
path=$(jq -r '.tool_input.file_path // empty' <<<"$input")
cmd=$(jq -r '.tool_input.command // empty' <<<"$input")
if [[ "$path" == *"/tests/acceptance/"* ]]; then
  echo "tests/acceptance is locked. Fix the app, not the test. If a test is wrong, mark the task blocked and explain in PROGRESS.md." >&2; exit 2
fi
if grep -Eq 'tests/acceptance' <<<"$cmd" && grep -Eq '(>|sed -i|rm |mv |cp |tee )' <<<"$cmd"; then
  echo "tests/acceptance is locked." >&2; exit 2
fi
if grep -Eq 'fly (apps|postgres|mpg|volumes|storage) (destroy|delete)|git push .*(-f|--force)|DROP (DATABASE|SCHEMA)|rm -rf /|acceptance-locked' <<<"$cmd"; then
  echo "Destructive command blocked." >&2; exit 2
fi
exit 0
