#!/usr/bin/env bash
# Read-only production smoke test (SPEC.md D-24): runs the @smoke tests in
# tests/acceptance/smoke.prod.spec.ts against $PROD_URL as the smoke user.
#
#   PROD_URL         default https://rentnerd-app.fly.dev
#   SMOKE_USER_EMAIL / SMOKE_USER_PASSWORD   required (read from .env if present)
#   SMOKE_ALL=1      run every smoke test; by default only those whose criterion
#                    belongs to a task marked "done" in docs/tasks.json
#
# Exits non-zero on any failure or skipped test.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Read only the variables this script needs from .env, and only if not already set.
read_env() {
  [ -n "${!1:-}" ] && return 0
  [ -f .env ] || return 0
  local line v
  line="$(grep -E "^$1=" .env | tail -1)" || return 0
  v="${line#*=}"; v="${v%\"}"; v="${v#\"}"; v="${v%\'}"; v="${v#\'}"
  export "$1=$v"
}
for name in PROD_URL SMOKE_USER_EMAIL SMOKE_USER_PASSWORD; do read_env "$name"; done
export PROD_URL="${PROD_URL:-https://rentnerd-app.fly.dev}"
: "${SMOKE_USER_EMAIL:?SMOKE_USER_EMAIL must be set}"
: "${SMOKE_USER_PASSWORD:?SMOKE_USER_PASSWORD must be set}"

[ -d tests/acceptance/node_modules ] || npm ci --prefix tests/acceptance

CRITERIA="$(node -e '
  const tasks = JSON.parse(require("fs").readFileSync("docs/tasks.json", "utf8"));
  const ids = new Set();
  for (const t of tasks) if (process.env.SMOKE_ALL === "1" || t.status === "done") for (const c of t.criteria) ids.add(c);
  console.log([...ids].join("|"));
')"
if [ -z "$CRITERIA" ]; then
  echo "No done tasks yet; nothing to smoke-test."
  exit 0
fi

LIST="$(cd tests/acceptance && npx playwright test --project=smoke --list --grep "@smoke" 2>/dev/null || true)"
if ! grep -qE "($CRITERIA) " <<<"$LIST"; then
  echo "No smoke test covers a done criterion yet; nothing to check."
  exit 0
fi

echo "Smoke-testing $PROD_URL"
cd tests/acceptance
npx playwright install chromium >/dev/null
RENTNERD_SMOKE=1 npx playwright test --project=smoke --forbid-only --grep "^(?=.*@smoke)(?=.*($CRITERIA) )"
node -e '
  const s = JSON.parse(require("fs").readFileSync("test-results/results.json", "utf8")).stats || {};
  if ((s.skipped || 0) > 0) { console.error(`${s.skipped} smoke test(s) skipped`); process.exit(1); }
  console.log(`smoke: ${s.expected} passed`);
'
