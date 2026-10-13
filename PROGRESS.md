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

### 2026-10-12 — T007: Fly.io settings (fly.toml)
- Added `fly.toml`: app `rentnerd-app` in San Jose (`sjc`), a `web` program and a `worker` program,
  the database update step that runs before each release, the website on port 8080 with a health
  check every 15 seconds, and the machine sizes from the spec (web 512 MB, worker 1 GB).
  No secrets are in the file. A unit test guards these settings; `fly config validate` accepts it.
- verify.sh passes; the reviewer approved. There is no GitHub Actions workflow yet, so nothing
  deploys from this commit. Nothing for the owner to do.

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

### 2026-10-12 — T008: GitHub Actions workflow (verify, deploy, smoke test, rollback)
- Added `.github/workflows/deploy.yml`. On every push to main it starts the local services, runs
  `verify.sh` (Chrome engine only, slow tests skipped, to save Actions minutes), then deploys to
  Fly, keeps one web and one worker machine, and runs the production smoke test. If the smoke test
  fails, it redeploys the previous release and the run is marked failed.
- The workflow can also be started by hand with a "force smoke failure" switch; that is the manual
  check for AC-PLAT-12 before the first release.
- Owner: the GitHub repository needs the secrets `FLY_API_TOKEN`, `SMOKE_USER_EMAIL` and
  `SMOKE_USER_PASSWORD`. Until they exist, the deploy job will fail (verify still runs). The Fly
  release-listing field names (`Status`, `ImageRef`) are unconfirmed until the first real run.
- verify.sh passes; the reviewer approved.
- First run of the workflow: checks passed and deploy started, but the placeholder worker program
  exited immediately, so Fly reported the worker machine as failed. The placeholder now stays running
  until the real worker arrives in a later task.

### 2026-10-12 — T009: first production deploy
- The GitHub Actions run for the last T008 commit finished green (checks and deploy both passed).
  https://rentnerd-app.fly.dev/healthz and https://rentnerd-app.fly.dev/api/health both answer
  200 `{"status":"ok"}`; the app only says "ok" when it can reach the database, so the database
  connection works. Fly shows the web machine started with its health check passing.
- Nothing in the app changed in this task.
- Owner/next builder: the placeholder worker machine shows "stopped". It exited once during the
  first failed deploy and Fly does not restart stopped machines on later deploys. It does no work
  yet, so nothing is lost; the task that builds the real worker must make sure it is running
  (for example `fly machine start`, in the deploy workflow).
- Evidence: the deploy workflow run 38309209226 (commit 72a9b95) succeeded, and the check of
  /healthz and /api/health was made against that release on 2026-10-12.

### 2026-10-12 — T010: test-mode safety
- The web server, worker and command-line tool now check their settings on start. If the "test
  routes" switch (ENABLE_TEST_ROUTES=true) is on but the environment isn't clearly a test one
  (NODE_ENV not "test", running on Fly, or a database name not ending in "_test"), the program
  stops with a clear message instead of starting. This protects real data from the test-only reset.
- With the switch off, anything under /api/test/ answers "not found". The test routes themselves
  arrive in later tasks; they must be registered before the SPA fallback.
- verify.sh passes (AC-PLAT-05 and AC-PLAT-07 included); the reviewer approved. Nothing for the owner to do.

### 2026-10-13 — T011: test clock
- Added the test clock used by the acceptance tests. `POST /api/test/clock` with a date/time moves
  the whole app clock forward or back (it keeps ticking from there); `{"now": null}` puts it back
  to real time. The setting is stored in the database (new `test_clock` table), so the web server
  re-reads it on start, the worker follows it within about a quarter of a second, and the
  command-line tool reads it each time it runs. Signing requests for file storage will use real time.
- It only exists in test setups (the safety checks from T010 still apply); in production the clock
  is untouched and the route answers "not found".
- Note for later tasks: database `now()` still uses real time, so time-based queries must be given
  the app's time. Job-trigger routes should wait for the worker to pick up a new clock setting.
- verify.sh passes; the reviewer approved. Nothing for the owner to do.

### 2026-10-13 — T012: real worker and test reset
- The worker is now a real program: it connects to the job queue (pg-boss, which keeps its own tables
  in a separate `pgboss` area of the database), sets up the three queues (`email.send`, `pdf.render`,
  `preview.render`), and shuts down cleanly when Fly or you stop it (finishes running jobs first).
  No jobs do anything yet; later tasks add them.
- Added `POST /api/test/reset` (test setups only; "not found" otherwise). It empties every app table
  and every waiting job, and puts the test clock back to real time. Queues and database structure stay.
- Owner/next builder: the worker machine on Fly was "stopped" (see T009). After this deploy, check
  `fly status -a rentnerd-app`; the worker may still need starting by the deploy workflow.
- verify.sh passes; the reviewer approved. No screens changed, so no QA pass.

### 2026-10-13 — T013: email sending
- The worker can now send email. Messages go out through the mail server named in the settings
  (Mailpit on your computer, the real mail service in production). Every message has a plain-text and a
  simple HTML version, both ending with "RentNerd · private landlord tools".
- Each message is recorded in a new `email_log` table (recipient, template, subject, queued/sent/failed,
  time sent, last error) and sent by a background job that retries up to 5 times with growing waits.
  It is marked "failed" only after the last retry.
- Added `POST /api/test/fail-next-email` (test setups only): the next email fails on every retry; later
  ones send normally. Reset clears it.
- Nothing sends email yet; later tasks (invitations, digest) will use `enqueueEmail`. Note for them: the
  digest's one-per-recipient-per-day rule still needs a queue setting plus handling when a job is
  skipped as a duplicate.
- verify.sh passes; the reviewer approved. No screens changed, so no QA pass. Nothing for the owner to do.

### 2026-10-13 — T014: sign-in rules and API guard
- Sign-in sessions are kept in the database for 7 days (renewed at most once a day). The cookie is
  HttpOnly, SameSite=Lax, carries a Max-Age, and is marked Secure whenever the app address is https
  (so in production). Sign-up stays off; passwords must be 12–128 characters.
- Every `/api` address now needs a signed-in user, except the health check, sign-in/out (`/api/auth/*`)
  and the two public invitation addresses; otherwise the answer is 401 `UNAUTHENTICATED`. Invited and
  deactivated people count as signed out.
- Any POST/PATCH/PUT/DELETE must come from the app's own address (the `Origin` header), else 403
  `FORBIDDEN`. The test-only routes are exempt. The read-only smoke user gets 403 on every write
  except signing out. Unexpected server errors answer 500 `INTERNAL` in the standard error format.
- Note for later tasks: the signed-in user is available in route handlers as `c.get("user")`.
- verify.sh passes; the reviewer approved. No screens changed, so no QA pass. Nothing for the owner to do.

### 2026-10-13 — T015: administrator set-up at startup
- When the web app starts and there is no administrator yet, it creates one from the `ADMIN_EMAIL`
  setting (status "Invited") and emails the "You're invited to RentNerd" message with the administrator
  wording and a "Set your password" link that works for 7 days. Starting again sends no second email,
  and starting several copies at once still creates one administrator and one email.
- If `ADMIN_EMAIL` differs from the existing administrator, a warning is logged and nothing changes.
  In production the web app refuses to start if `ADMIN_EMAIL` is missing (the test-route safety check still comes first).
- Added the `invitation` table (only the hash of the link token is stored). The accept-invitation page and
  the `resend-admin-invite` command come in later tasks. Small gap: if the app crashed in the instant between
  saving the administrator and queuing the email, no email goes out; the resend command will cover that.
- verify.sh passes; the reviewer approved. No screens changed, so no QA pass. Before the first deploy the owner
  must have set the `ADMIN_EMAIL` secret on Fly (`fly secrets set ADMIN_EMAIL=<email> -a rentnerd-app`).

### 2026-10-13 — T016: accepting invitations, "my account" and the admin-resend command
- The two public invitation addresses now work. Looking up a link returns the email and name it was sent
  to; accepting it (name + password of 12–128 characters) sets the password, marks the email verified, makes
  the user "Active" and signs them in. A link works once only, even if used twice at the same instant, and
  used, expired or revoked links all give the same "invalid or has expired" answer. Both addresses allow
  20 requests per visitor address per 15 minutes, then answer 429 "Too many attempts. Try again in a few minutes."
- `GET /api/me` shows the signed-in user's own details; `PATCH /api/me` changes their name.
- `node dist/cli.js resend-admin-invite` emails the administrator a fresh link (replacing the old one) and does
  nothing once the administrator has set a password.
- Added the `zod` package for shared request checking. The rate-limit counters live in memory (one web machine),
  so a restart resets them.
- Not done yet, on purpose: audit-log rows for accepting an invitation and renaming yourself (the audit table
  arrives in T028), and the accept-invitation page itself (later client tasks).
- verify.sh passes; the reviewer approved. No screens changed, so no QA pass. Nothing for the owner to do.

### 2026-10-13 — T017: user-management API for the administrator
- The administrator can now list all users (`GET /api/users`, with each invited person's invitation state: valid,
  expired or revoked) and list invitations (`GET /api/invitations`). Landlords get 403 FORBIDDEN on all of these.
- `POST /api/invitations` (name + email) creates the invited landlord straight away and emails the "You're invited"
  message naming the administrator. An email that already belongs to anyone answers 409 "A user with this email already exists."
- Resend replaces the old link with a new one and emails it; Revoke kills the link and leaves the person "invited".
- Deactivate (landlords only, never the administrator: 403) signs the person out everywhere immediately; Reactivate
  brings them back with their old password.
- Not done yet, on purpose: audit-log rows (T028), moving a deactivated landlord's properties to the administrator
  (arrives with properties), and refusing a deactivated person's sign-in with "Incorrect email or password." (T019).
  Until T019 their sign-in itself still succeeds, but every request they then make is answered 401.
- verify.sh passes; the reviewer approved. No screens changed, so no QA pass. Nothing for the owner to do.

### 2026-10-13 — T018: the app's frame (header, menu, navigation, error pages)
- Signed-in people now see the shared frame: a "Skip to main content" link, the "RentNerd" home link, a menu with their
  name ("Account settings", "Sign out") and the left navigation (Dashboard … Import, plus Users and Activity log for the
  administrator only). On narrow screens the navigation sits behind a "Menu" button (Escape closes it).
- Every page has its own "{Page} – RentNerd" title and one heading. Unknown addresses show "Page not found" with "Go to
  dashboard"; pages a person may not open show "You don't have access to this page." (Users/Activity log for landlords;
  editing pages such as `/properties/new` for the read-only smoke user). Visitors who aren't signed in are sent to `/login`.
- All pages are still empty placeholders, and `/login` is only a placeholder until T019. Added the libraries React Router,
  TanStack Query, React Aria and Tailwind.
- For later tasks: T019 must only accept a same-site `next` address after sign-in. QA noticed the browser console logs a
  harmless Content-Security-Policy warning about inline styles (from the menu pop-up); I left the security policy
  unchanged — owner/later task may decide whether to allow inline styles.
- verify.sh passes; the reviewer approved; QA found only minor issues, the useful ones fixed. Nothing for the owner to do.
