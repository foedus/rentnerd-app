#!/usr/bin/env bash
# RentNerd autonomous build loop. Run inside tmux from ~/rentnerd-app.
set -uo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a
mkdir -p logs
LOCKED="tests/acceptance scripts/guard.sh scripts/run-loop.sh scripts/verify.sh scripts/smoke-prod.sh prompts .claude"
stalls=0; finals=0
log() { echo "$(date '+%F %T') $*" | tee -a logs/loop.log; }

for i in $(seq 1 5000); do
  # 1. Restore any locked file that changed
  if ! git diff --quiet acceptance-locked -- $LOCKED; then
    git checkout acceptance-locked -- $LOCKED
    echo "- $(date -Is) loop restored locked files" >> PROGRESS.md
    git add -A && git commit -qm "Restore locked files" && git push -q
    log "restored locked files"
  fi

  # 2. All tasks done? Run the full final check
  if jq -e 'all(.[]; .status=="done")' docs/tasks.json >/dev/null; then
    log "all tasks done; running final check"
    if VERIFY_ALL=1 ./scripts/verify.sh > "logs/final-$i.log" 2>&1 && ./scripts/smoke-prod.sh >> "logs/final-$i.log" 2>&1; then
      log "COMPLETE: all tasks done, full verification and production smoke tests passed"; exit 0
    fi
    finals=$((finals+1))
    if [ $finals -ge 5 ]; then log "FINAL CHECK KEEPS FAILING: see logs/final-$i.log"; exit 1; fi
    { echo "- $(date -Is) FINAL CHECK FAILED (attempt $finals). Last 60 lines of logs/final-$i.log:"; tail -n 60 "logs/final-$i.log" | sed 's/^/    /'; } >> PROGRESS.md
    jq --arg id "FIX-$i" '. + [{"id":$id,"title":"Make VERIFY_ALL=1 ./scripts/verify.sh and ./scripts/smoke-prod.sh pass; see the latest FINAL CHECK entry in PROGRESS.md","depends_on":[],"criteria":[],"status":"todo"}]' docs/tasks.json > /tmp/tasks.json && mv /tmp/tasks.json docs/tasks.json
    git add -A && git commit -qm "Final check failed; add fix task" && git push -q
  fi

  # 3. Is any task ready to start?
  ready=$(jq '[.[]|select(.status=="done")|.id] as $d | [.[]|select(.status=="todo" and (((.depends_on//[]) - $d)|length==0))] | length' docs/tasks.json)
  if [ "$ready" -eq 0 ]; then log "NEEDS HUMAN: no task can start; see blocked entries in PROGRESS.md"; exit 2; fi

  # 4. One fresh Claude session for one task
  before=$(git rev-parse HEAD)
  log "iteration $i starting"
  claude -p "$(cat prompts/iteration.md)" --model sonnet --dangerously-skip-permissions \
    --output-format stream-json --verbose > "logs/iter-$i.jsonl" 2>&1

  # 5. Progress, usage limit, or stall?
  if [ "$(git rev-parse HEAD)" != "$before" ]; then
    stalls=0; log "iteration $i committed: $(git log -1 --format=%s)"
  elif tail -n 3 "logs/iter-$i.jsonl" | grep -qiE 'usage limit|limit reached|out of (extra )?usage|resets? (at|in)'; then
    log "iteration $i hit the usage limit; waiting 1 hour"; sleep 3600
  else
    stalls=$((stalls+1)); log "iteration $i made no progress ($stalls/4); waiting 15 minutes"
    if [ $stalls -ge 4 ]; then log "STALLED: see the last logs/iter-*.jsonl"; exit 1; fi
    sleep 900
  fi
done
