#!/usr/bin/env bash
# RentNerd verification gate. Run before every commit.
#
#   ./scripts/verify.sh                      lint, typecheck, unit, integration, then the
#                                            acceptance tests for every task marked "done"
#                                            in docs/tasks.json plus $CURRENT_TASK
#   CURRENT_TASK=T012 ./scripts/verify.sh    ... also that task's acceptance tests
#   VERIFY_ALL=1 ./scripts/verify.sh         ... every acceptance test
#
# Acceptance tests run against the locally built production Docker image
# (rentnerd-app:local) and the Docker Compose services (Postgres, Mailpit, MinIO).
# Optional: ACCEPTANCE_BROWSERS=chromium,firefox,webkit (default chromium).
#
# Exits non-zero on any failure, on any skipped test, and on any .only.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
OUT="$(mktemp -d)"
# Criteria checked by a person, never by an automated test (SPEC.md §13).
MANUAL_CRITERIA="AC-PLAT-12 AC-A11Y-11"

step() { printf '\n==> %s\n' "$*"; }
fail() { printf '\nverify: FAILED: %s\n' "$*" >&2; exit 1; }

[ -f package.json ] || fail "package.json is missing. Task T001 (scaffold) creates it."

step "Dependencies"
[ -d node_modules ] || npm ci
[ -d tests/acceptance/node_modules ] || npm ci --prefix tests/acceptance

step "No focused or skipped tests in the source"
if grep -rnE '\b(describe|it|test|context|suite)\.(only|skip|todo|fixme)\b|\b(fit|fdescribe|xit|xdescribe|xtest)\(' \
     --include='*.ts' --include='*.tsx' src tests 2>/dev/null; then
  fail "remove .only/.skip/.todo/.fixme (tests must not be skipped or focused)"
fi

step "Lint"
npm run lint

step "Typecheck"
npm run typecheck
npm --prefix tests/acceptance run typecheck

step "Unit tests"
npm run test:unit -- --allowOnly=false --reporter=default --reporter=json --outputFile.json="$OUT/unit.json"

step "Compose services"
if [ -f docker-compose.yml ]; then
  docker compose up -d --wait
  HAVE_COMPOSE=1
else
  echo "docker-compose.yml not found yet (task T002 adds it); skipping services."
  HAVE_COMPOSE=0
fi

step "Integration tests"
npm run test:integration -- --allowOnly=false --reporter=default --reporter=json --outputFile.json="$OUT/integration.json"

step "No skipped unit or integration tests"
node -e '
  const fs = require("fs");
  for (const f of process.argv.slice(1)) {
    if (!fs.existsSync(f)) continue;
    const r = JSON.parse(fs.readFileSync(f, "utf8"));
    const skipped = (r.numPendingTests || 0) + (r.numTodoTests || 0);
    if (skipped > 0) { console.error(`${f}: ${skipped} skipped/todo test(s)`); process.exit(1); }
  }
' "$OUT/unit.json" "$OUT/integration.json" || fail "skipped tests found"

step "Selecting acceptance criteria"
CRITERIA="$(node -e '
  const tasks = JSON.parse(require("fs").readFileSync("docs/tasks.json", "utf8"));
  const all = process.env.VERIFY_ALL === "1";
  const current = process.env.CURRENT_TASK || "";
  if (current && !tasks.some((t) => t.id === current)) { console.error(`CURRENT_TASK ${current} is not in docs/tasks.json`); process.exit(1); }
  const manual = new Set(process.argv[1].split(" "));
  const ids = new Set();
  for (const t of tasks) if (all || t.status === "done" || t.id === current) for (const c of t.criteria) if (!manual.has(c)) ids.add(c);
  console.log([...ids].sort().join(" "));
' "$MANUAL_CRITERIA")"

if [ -z "$CRITERIA" ]; then
  echo "No acceptance criteria selected (no done tasks with criteria yet)."
  step "verify: OK"
  exit 0
fi
echo "Criteria: $CRITERIA"
[ "$HAVE_COMPOSE" = 1 ] || fail "acceptance tests need docker-compose.yml (task T002)"
[ -f Dockerfile ] || fail "acceptance tests need the Dockerfile (task T005)"

step "Production Docker image"
docker build -t rentnerd-app:local .

step "Acceptance tests"
BROWSERS="${ACCEPTANCE_BROWSERS:-chromium}"
PROJECTS=()
for b in ${BROWSERS//,/ }; do PROJECTS+=("--project=acceptance-$b"); done
(cd tests/acceptance && npx playwright install ${BROWSERS//,/ } >/dev/null)
GREP="($(echo "$CRITERIA" | tr ' ' '|')) "
set +e
(cd tests/acceptance && APP_RUNNER=docker APP_IMAGE=rentnerd-app:local ACCEPTANCE_BROWSERS="$BROWSERS" \
  npx playwright test "${PROJECTS[@]}" --forbid-only --grep "$GREP")
STATUS=$?
set -e
[ "$STATUS" = 0 ] || fail "acceptance tests failed (traces and app logs: tests/acceptance/test-results, tests/acceptance/.state/logs)"

node -e '
  const r = JSON.parse(require("fs").readFileSync("tests/acceptance/test-results/results.json", "utf8"));
  const s = r.stats || {};
  if ((s.skipped || 0) > 0) { console.error(`${s.skipped} acceptance test(s) were skipped`); process.exit(1); }
  if ((s.expected || 0) === 0) { console.error("no acceptance tests ran"); process.exit(1); }
  console.log(`acceptance: ${s.expected} passed`);
' || fail "acceptance results check"

step "verify: OK"
