# RentNerd — build progress

A plain-language log of the autonomous build, newest first. Each session adds one dated entry
for the task it worked on: what changed, whether verify passed, and anything the owner needs to
know or do. The task list and statuses live in `docs/tasks.json`.

## Blocked

(None yet. Blocked tasks are listed here with the reason and what the owner needs to do.)

## Disputed tests

(None yet. A build session that believes a locked acceptance test contradicts SPEC.md records
the test, the failure output and its reasoning here; see SPEC.md §15.5.)

## Log

### 2026-10-12 — Owner decisions on the test review
- The owner accepted every recommendation from the test review (recorded in SPEC.md Appendix C,
  #77). No test needed changing.
- The production backup/restore drill is now the owner's job, not the builder's: task T104 writes
  step-by-step instructions for it in docs/RESTORE.md, and T105 lists it among the checks before
  the first release. Build sessions never touch production beyond reading logs and status.

### 2026-10-12 — Acceptance tests reviewed and marked ready to lock
- A fresh review session checked every acceptance test against the spec and fixed the ones that
  would have failed against a correct app. The main one: moving the test clock more than a week
  ahead signs users out (as the spec requires), and many tests didn't sign in again. Others: a
  test pressed "End lease" on a lease that hadn't started (the spec hides that button), two
  tests raced the PDF worker, and the accessibility checks couldn't read modern colour formats.
  The full list is at the end of tests/acceptance/COVERAGE.md.
- To save GitHub Actions minutes, CI now runs the tests in Chrome's engine only and skips the
  three tests marked "slow" (each over a minute). The full run in three browsers, slow tests
  included, happens on this machine with `VERIFY_ALL=1`; a new last task (T106) makes sure it
  passes before the first release. The spec (§15.4) and the task plan say so.
- Fixed two bugs in scripts/verify.sh that the builder couldn't have fixed later: its check for
  skipped tests would have failed on every GitHub Actions run, and it had no way to skip slow
  tests. The local MinIO image is now pinned to an exact version and fingerprint.
- tests/acceptance/REVIEW_STATUS says READY: the run loop can now tag the tests
  `acceptance-locked`.

### 2026-10-12 — Harness set up
- Added CLAUDE.md, the 105-task plan in docs/tasks.json, the locked Playwright acceptance tests
  (tests/acceptance/, 196 tests covering every automated criterion), scripts/verify.sh,
  scripts/smoke-prod.sh, and the reviewer and qa subagents.
- No app code exists yet. verify.sh fails until task T001 creates the npm package; acceptance
  tests start running from task T005 (Docker image).
