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

### 2026-10-12 — T006: sign-in foundation and the smoke-test user
- Added the user, session, account and verification tables (first database migration) and set up
  Better Auth for email and password sign-in: public sign-up is off, passwords must be 12–128
  characters, sessions last 7 days. Users now carry a role (admin, landlord, smoke) and a status
  (invited, active, deactivated); the database allows only one admin and one smoke user.
- On every start the web server creates the read-only smoke user from `SMOKE_USER_EMAIL` /
  `SMOKE_USER_PASSWORD` if it is missing (already verified), and re-syncs its password if that
  changed. Running it twice, or at the same time, never makes a duplicate. If the smoke email is
  changed while an old smoke user exists, start-up stops with an error (only one is allowed).
- Integration tests cover creating, repeating, concurrent starts, password changes, repair,
  sign-in, disabled sign-up and unverified sign-in. verify.sh passes; the reviewer approved.
  Nothing for the owner to do.

### 2026-10-12 — T005: Docker image
- Added the `Dockerfile`: one image that holds the website, the API, the worker, the migration
  command and the command-line tool, plus the database tools needed for backups (version 17, the
  same as the database). It runs as a normal user, not root. A small test checks the key parts.
- verify.sh now builds the image and runs the first acceptance test (the health check) against
  it; it passes and the reviewer approved. There is no GitHub Actions workflow yet, so nothing
  ran in CI. Chromium for PDFs will be added to the image by the PDF task. Nothing for the owner to do.

### 2026-10-12 — T004: web server serves the website
- The web server now serves the built website (`dist/client`). Any page address that isn't a real
  file (for example `/properties/123`) returns the main page so the site's own navigation works;
  unknown `/api/...` addresses return a "not found" error instead.
- Every response carries the security headers from the spec (content policy, no-sniff, same-origin
  referrer, no framing). Integration tests cover pages, files, the fallback and the headers.
- verify.sh passes; the reviewer approved. Note for later tasks: new API routes must be registered
  before the SPA is mounted at the end of `createApp`, and the strict content policy blocks inline
  styles, so check it when Tailwind/React Aria arrive. Nothing for the owner to do.

### 2026-10-12 — T003: database connection, migrations and health check
- The app can now connect to Postgres using `DATABASE_URL`. `dist/migrate.js` applies database
  migrations (there are none yet; tables arrive with later tasks, and `npm run db:generate` creates them).
- `GET /api/health` (and `GET /healthz`) answer `{"status":"ok"}` when the database responds and
  a 503 when it doesn't. Integration tests cover both cases and the migration command.
- verify.sh passes; the reviewer approved. Note for the Docker image task: it must include `src/db/migrations`
  next to `dist/`. Nothing for the owner to do.

### 2026-10-12 — T002: local services (Docker Compose)
- Added `docker-compose.yml`: Postgres (databases `rentnerd` and `rentnerd_test`), Mailpit (mail
  catcher) and MinIO (file storage, with buckets `rentnerd-test` and `rentnerd-dev` created
  automatically), all with health checks so `docker compose up -d --wait` works. Added
  `.env.example` with the matching settings for local development.
- The bucket-creating container stays idle after its work, because Docker treats any container
  that exits as a failure when waiting. A new integration test checks all services, both
  databases and both buckets.
- verify.sh passes; the reviewer approved after one fix (test coverage). Nothing for the owner to do.

### 2026-10-12 — T001: project scaffold
- Created the single npm package: folders for the website (React + Vite), the API (Hono), the
  background worker, shared code, the command-line tool and the database. `npm run build` now
  produces the four programs (`dist/server.js`, `dist/worker.js`, `dist/migrate.js`,
  `dist/cli.js`) plus the website; for now they are placeholders that just print a line.
- Set up lint, type checking, and unit and integration test runners (one small unit test).
  `dist/` and `coverage/` are no longer tracked by git.
- verify.sh passes; the reviewer approved after one fix (I had added a health check that belongs
  to a later task, so I removed it). Nothing for the owner to do.

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
