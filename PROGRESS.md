# RentNerd — build progress

A plain-language log of the autonomous build, newest first. Each session adds one dated entry
for the task it worked on: what changed, whether verify passed, and anything the owner needs to
know or do. The task list and statuses live in `docs/tasks.json`.

## Blocked

- **2026-10-16** — Owner moved T048's PDF-deletion clause to T088; T048 marked done.

## Disputed tests

**2026-10-13** — Owner approved fix to tests/acceptance/helpers/mailpit.ts (sort by Mailpit receive time); T021 and T025 reopened.

## Log

### 2026-10-17 — Owner session: the "suddenly signed out" test failures (cause found and fixed; not committed)
- **Cause:** when a test moves the app's pretend clock, the website changes its own clock and saves it, and separately
  re-reads the saved clock four times a second. Now and then a re-read that started just before the save finished
  just after it and put the clock back to the old date for up to a quarter of a second. A sign-in in that moment got a
  session dated from the old day, and once the clock caught up that session looked a week out of date, so the user
  was "signed out". It was not caused by tests running at the same time: they run one at a time.
- Shown on the old code: 3 of 300 sign-ins straight after a clock move were lost; AC-CMP-05 repeated alone landed on
  the Sign in page on its 8th try. With the fix: 0 of 1,200 lost. This also explains the CI failure of AC-LEASE-19
  (signed out just after its clock move) and of AC-USR-04 (the invitation still looked valid) on 2026-10-17.
- **Fix** (`src/db/test-clock.ts`, `src/db/reset.ts`): a re-read that overlaps a clock change is thrown away. New unit
  tests replay the exact timing and fail on the old code. This code only runs in test mode, never in production.
- A second, separate flaky check (the Leases page unit test, about 1 run in 8) also stopped verify: with every
  status unchecked the page waited a moment before showing "No leases match these filters." and briefly showed the old
  rows. It now shows the empty list at once (`src/client/pages/Leases.tsx`).
- Test suite: one diagnostics-only change, logged in `tests/acceptance/CHANGELOG.md` (a refused sign-in again after a
  clock move is now reported instead of hidden). No assertion was changed. Three full verify runs in a row passed (115).

### 2026-10-16 — T048F: Flaky AC-CMP-05 sign-out (did not reproduce; closed on the owner's test)
- The task's test for "done" is two full `verify.sh` runs in a row passing: they did, both before and after the change below (108 acceptance tests each). Six extra runs of the API, sign-in and Compliance tests together also all passed, so I never saw the failure itself.
- **One change, a hardening and not a proven fix:** the sign-in, invitation, import and password-reset attempt counters measured their time windows with the app clock. When the test clock jumps (as the acceptance tests do constantly), attempts could age out early or stay stuck in the future, which could refuse a legitimate sign-in. They now use real time. A unit test (clock jumps a year back and forward) covers it and fails without the change.
- **The cause is unknown.** Not shown to be the cause: the sign-in limiter beyond the clock issue above (successful sign-ins are given back), Better Auth's own rate limit (off in the tests), the worker (never touches sessions), and the app clock (only shifts `Date`; cookies use real-time Max-Age). The most likely remaining cause is in the locked tests: `renewBrowserSessions` (`tests/acceptance/helpers/api.ts`) signs the browser in again after a clock jump and silently drops it if that sign-in isn't answered 200, which would look like a sign-out.
- **If it happens again**, keep `tests/acceptance/test-results` and `tests/acceptance/.state/logs/web.log` from that run and reopen this; the owner can also approve making that helper report a refused sign-in instead of hiding it.
- No screens changed, so no QA pass.

### 2026-10-16 — Owner: new task T048F (flaky AC-CMP-05)
- Added T048F at the top of the task list so it runs next: find and fix why AC-CMP-05 (Compliance "Mark done") is sometimes
  signed out during a full verify run even though it passes on its own. Done means two full verify runs in a row pass.

### 2026-10-13 — T025: Users screen (done)
- `/users` (Admin only) has the "Invite landlord" button and dialog (Name, Email, "Send invitation"; an existing email shows
  "A user with this email already exists.") and the Users table: Name, Email, Role, Status (Active / Invited / Invitation expired /
  Invitation revoked / Deactivated) and Last sign-in. New invitees show up immediately. Row actions come with T026.
- After the owner-approved fix to the Mailpit test helper, all 24 acceptance tests pass in verify.sh (including AC-USR-01, -02, -04, -06,
  AC-PLAT-04 and AC-PLAT-08).
- Reviewer: PASS. QA findings fixed: the invite dialog now clears its fields and errors when closed, and shows the "There is a problem"
  summary (focus moves to it after a failed send); a server-side field error now shows on the matching field; the empty-name message in
  this dialog reads "Enter a name."; a role sent in the request is ignored (tested - invitees are always landlords).

### 2026-10-13 — T021: forgot and reset password (BLOCKED on one disputed test)
- `/forgot-password` ("Send reset link", "Back to sign in") always shows "If an account exists for that email, we've sent a reset link."
  The "Reset your RentNerd password" email goes only to active, verified people (not invited, deactivated or unknown addresses),
  at most 3 per address per hour; each visitor address may ask 20 times per hour, then gets the 429 "Too many attempts..." message.
- `/reset-password?token=...` takes the new password twice (12+ characters, must match); links work once and for 1 hour. A bad or
  old link shows "This reset link is invalid or has expired." with "Request a new link". Success signs the person out everywhere,
  sends "Your RentNerd password was changed" and returns to `/login` with "Your password has been reset. Please sign in."
  Reset attempts are limited to 20 per visitor address per 15 minutes.
- Signed-out visitors to addresses that aren't pages (e.g. `/verify-email`) now see "Page not found" instead of the sign-in page.
- verify.sh: everything passes except AC-AUTH-05, which crashes inside the locked Mailpit helper (see Disputed tests).
  Owner: the locked helper needs the fix described there.
- The reviewer approved. QA findings fixed: using one reset link now cancels any other outstanding reset links; failed password checks show
  a "There is a problem" summary with links to the fields and move focus to it; the "invalid or has expired" message takes focus.
  Left for later: the "password has been reset" notice reappears if `/login` is reloaded, and the browser's own tooltip shows for an
  empty or malformed email on `/forgot-password`. The audit rows for password reset/changed come with T028.

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
- For later tasks: T019 must only accept a same-site `next` address after sign-in. The menu library used to inject an inline style that the security policy
  blocked (console warning); its rule now ships in our own stylesheet, so the policy stays unchanged and the warning is gone.
  The page also announces the new page title to screen readers after each navigation.
  A missing `/assets/...` file now answers 404 instead of the page shell. After clicking a navigation link focus moves
  to the page's main area.
- verify.sh passes; the reviewer approved; QA findings were fixed (the error screen now has "Try again" and shows the too-many-attempts message on 429). Nothing for the owner to do.

### 2026-10-13 — T019: the sign-in page
- `/login` now has Email and Password fields, a "Sign in" button and a "Forgot password?" link (that page arrives in T021).
  There is no sign-up link. A wrong password, an unknown email, a deactivated account and an invited person who hasn't
  accepted all show the same "Incorrect email or password."; a 429 shows "Too many attempts. Try again in a few minutes."
  (the server-side limit itself is T020).
- Signed-out visitors are sent to `/login` and, after signing in, come back to the page they asked for (including any
  `#section`). Only addresses on this site are accepted as the return page. Signing out returns to `/login`.
- The server now refuses to start a session for anyone who isn't "Active" (so a deactivated person with the right password
  is turned away), and records the "Last sign-in" time shown in the Users list.
- Fixed along the way: addresses containing an encoded line break (e.g. `/x%0a`) showed a blank page; they now behave like the
  address without it.
- verify.sh passes; the reviewer approved; QA findings fixed (blank page, `#section` kept, `/login/` loop, empty-field hint via
  the browser's own required-field message). Nothing for the owner to do.

### 2026-10-13 — T020: limits on sign-in attempts
- Sign-in now allows 5 failed tries per email and 30 failed tries per visitor address in any 15 minutes. After that, even the
  right password gets a 429 "Too many attempts. Try again in a few minutes." (shown on `/login`). Unknown emails are limited the
  same way, so the page never reveals whether an account exists. Successful sign-ins are not counted.
- The visitor address comes from Fly's `Fly-Client-IP` header in production and from the connection itself elsewhere;
  `X-Forwarded-For` is ignored. Counters are in memory (one web machine), so a restart resets them.
- verify.sh passes; the reviewer approved. No screens changed, so no QA pass. Nothing for the owner to do.

### 2026-10-13 — T022: the accept-invitation page
- `/accept-invite?token=…` now shows "You're joining RentNerd as {email}." with Your name (already filled in), Password and
  Confirm password, and a "Create account" button. Success signs the person in and opens the Dashboard.
- A missing, wrong, used, expired or revoked link shows "This invitation is invalid or has expired. Ask the administrator to send a new one."
  The same message appears if the link is used up between opening the page and pressing the button.
- Password rules match the reset page (12+ characters, both fields must match); mistakes are listed in a summary that takes focus.
  A network or server failure shows "Something went wrong. Please try again." and focus moves to that message (QA findings fixed).
- verify.sh passes; the reviewer approved; QA findings fixed. Nothing for the owner to do.

### 2026-10-13 — T023: shared form kit
- Added the building blocks every later form screen will use: labels that end in "(required)", an error under each field
  that screen readers link to the field, a "There is a problem" summary at the top that takes focus after a failed save and
  links to each field, a "{Thing} saved." message announced politely, the "Someone else changed this record…" alert with a
  "Reload" button, and "Something went wrong. Please try again." for unexpected failures. Forms check input with the same
  Zod rules as the server.
- Nothing on screen changes yet, because no page uses the kit until the form screens (from T031). The earlier sign-in, reset
  and invitation pages keep their own code for now.
- verify.sh passes; the reviewer approved. No QA pass (no screens changed). Nothing for the owner to do.

### 2026-10-13 — T024: shared interface pieces
- Added the reusable pieces later screens will use: a confirmation dialog (focus starts on "Cancel", Escape closes it and
  focus goes back to the button that opened it), a button that stays focusable but does nothing when unavailable and explains
  why to screen readers, a money box ("2150", "2,150" and "2150.00" all become $2,150.00), date helpers in New York time
  ("Jan 5, 2027"), a named table inside a keyboard-scrollable area, and "Previous" / "Next" with "Page X of Y".
- Nothing on screen changes yet; no page uses them until the list and form screens. 
- For later tasks: the money box fills its text only when first shown, so a form that resets its values must remount it
  (give it a `key`). `formatDate` assumes a real `YYYY-MM-DD` date.
- verify.sh passes; the reviewer approved. No QA pass (no screens changed). Nothing for the owner to do.

### 2026-10-13 — T042: shared calculations (dates and rent)
- Added the one place where date and rent maths lives (used later by leases, dashboard, emails and PDFs): "plus N months/years"
  that land on the last day of a short month (Jan 31 + 1 month = Feb 28; Feb 29 + 1 year = Feb 28), whole months between two dates
  (2026-11-01 to 2027-10-31 = 12; a 365-day lease = 12), days between, and full years since a start date.
- Rent: rent on a given date for "none", fixed-percentage (compounded each anniversary, rounded to the cent half-up every year,
  Feb 29 starts use Feb 28) and custom-schedule terms, plus the rent schedule table rows (Period start, Period end, Monthly rent).
  The $2,000 at 3% example gives $2,000.00, $2,060.00, $2,121.80 as the spec requires.
- Money formatting already existed (T024), so it was not repeated. No screens changed.
- verify.sh passes; the reviewer approved. No QA pass (no screens changed). Nothing for the owner to do.

### 2026-10-13 — T043: lease calculations
- Added the single place that works out a lease's facts from its dates (used later by lease screens, dashboard, emails and PDFs):
  the effective end date (latest extension), the current term, the rent on any date (including gaps between terms, month-to-month
  rent, and the "last known rent" after a term ends), and the last rent (on the move-out date, else the end date).
- Lease status follows the six rules in order (Ended, Upcoming, Active incl. "moving out {date}", Month-to-month, Ended (superseded),
  Needs decision). A unit is Occupied for Active, Month-to-month and Needs decision leases; otherwise Vacant, or "leased from {date}"
  with an Upcoming lease. Potential rent of a vacant unit is the last rent of its most recent non-archived lease; never-leased units have none.
  Archived leases are ignored.
- Overlapping terms are not defined by the spec; this code assumes later screens reject them. No screens changed.
- verify.sh passes; the reviewer approved. No QA pass (no screens changed). Nothing for the owner to do.

### 2026-10-13 — T044: tax reimbursement, other income and statistics
- Added the single place where these numbers are worked out (used later by the lease screens, Dashboard and property pages):
  commercial tax reimbursement (share % × the rise from the base year to the latest tax year, ÷ 12, rounded to the cent once; never
  below $0.00; "—" when the base year, share or tax years are missing) with its explanation text, e.g.
  "25% × (2025 tax $52,000.00 − 2020 tax $40,000.00) ÷ 12"; other income per lease (parking + tax, from the current term).
- Portfolio and per-property statistics: units, occupied, vacant, occupancy (1 decimal), monthly/annual rent roll, other income,
  vacancy loss, value (latest market estimate, else purchase price), gross yield (2 decimals) and the "Based on {n} of {m} properties
  with a value." note. Callers must pass only non-archived properties and units. No screens changed.
- verify.sh passes; the reviewer approved. No QA pass (no screens changed). Nothing for the owner to do.

### 2026-10-13 — T021: forgot and reset password (finished)
- The owner-approved fix to the test mail helper is in, and all password-reset acceptance tests (AC-AUTH-05, -06, -07, -11) now pass.
- Final polish after the QA pass: a bad email on `/forgot-password` now shows "Enter a valid email address." on the page (and moves
  focus to the field) instead of a browser tooltip, and the next try works on the first click. The reset page only says "invalid or
  has expired" for a genuinely bad link; other failures show "Something went wrong. Please try again."
- Also fixed from QA: the "password has been reset" notice no longer comes back when `/login` is reloaded, the reset page's field
  errors are red, and the "password changed" email now reads "...reset your password now:" followed by the link, as §10.4 says.
- Also fixed: a password made only of spaces is now refused (reset page, invitation page and the server), with "Password can't be
  only spaces." The reviewer approved. Nothing for the owner to do.

### 2026-10-13 — T026: Users row actions
- The Users table now has an "Actions" column: **Resend invitation** (any invited person), **Revoke invitation** (only while the
  invitation is still valid), **Deactivate** (active landlords, with the confirmation text from the spec) and **Reactivate**.
  The Admin and Smoke rows have no actions. After each action a short message is announced ("Invitation revoked.", "User
  deactivated." …) and keyboard focus moves to it; if the server refuses (e.g. someone else already changed the user), its own
  message is shown. Landlords already saw the no-access page on /users and /activity, and the server already returned 403.
- Changed the shared confirmation dialog to announce as a plain "dialog" (the locked tests look for that).
- QA noted: the Activity API route doesn't exist yet (404 for landlords) — to recheck when the Activity log task lands; the
  deactivate dialog title is the whole sentence (kept so wording matches the spec).
- verify.sh passes; the reviewer approved; QA findings (lost focus, generic error) fixed. Nothing for the owner to do.

### 2026-10-13 — T027: Account settings
- New page `/account`. **Profile**: change your name with "Save name" ("Name saved."; the name in the top-right menu updates at
  once); your email is shown but can't be edited. **Change password**: Current password, New password, Confirm new password
  ("Password changed."). A wrong current password says "Current password is incorrect."; short passwords and mismatches show the
  same messages as the reset page. Changing the password signs out every other device and sends the "password was changed" email.
- The Smoke user sees only their name and email (no forms), and the server refuses their changes anyway.
- QA fixes: keyboard focus stays on the button after saving, "saved" messages disappear when you edit again, and the name box
  shows the trimmed name after saving.
- Note for later: changing a name doesn't write an Activity-log row yet (no audit logging exists so far); to add when the audit task lands.
- verify.sh passes; the reviewer approved. Nothing for the owner to do.
- T027 follow-up: a new password equal to the current one is now refused ("New password must be different from your current
  password."), a "saved" message clears when the other form on the page saves, and required fields are marked `aria-required`.
  The audit row for name changes waits for the "Audit log foundation" task (no audit table exists yet); the page title no longer
  flashes "Loading – RentNerd" on first load: it already shows the requested page's title (e.g. "Account settings – RentNerd").

### 2026-10-13 — T028: Audit log foundation
- Added the activity record ("audit log") that later screens will show to the Admin. Each entry stores who did it, when, what kind of
  action, which record, a plain-words summary, the before → after of changed fields (e.g. "Name: Lou → Louise") and the visitor's
  address. Passwords, hashes, tokens and session ids are never written (anything with such a field name is dropped automatically).
- Recorded now: sign-in, failed sign-in (for an unknown email the typed address is not stored), sign-out, password reset, password
  changed, invitation sent / resent, invitation revoked, user deactivated / reactivated, and a user changing their own name (the
  gap noted at T027). Sign-in and sign-out by the Smoke user are not recorded. Admin actions are written in the same database
  transaction as the change, so a refused action leaves no entry.
- Not yet: the Activity page and `GET /api/audit-log` (later task), clearing addresses after 2 years (cleanup task), and entries
  for properties/leases etc. (they will use the same writer when those exist). No screens changed.
- verify.sh passes; the reviewer approved. No QA pass (no screens changed). Nothing for the owner to do.

### 2026-10-13 — T029: Owners API
- Added the owners back end: list (search, sort, paging, "show archived"), create, read, edit, archive, restore and delete, all with the
  §6.3 rules (required fields, 2-letter state, 5 or 9 digit ZIP, valid email) and plain error messages per field. Editing a stale copy
  is refused with a "changed by someone else" conflict; unknown ids give "not found"; every change writes an Activity-log row (edits
  show before → after). The read-only Smoke user can read but not change owners.
- Properties and units don't exist yet, so "owner is used by a property" is not checked yet: archiving and deleting always succeed for
  now. The check is already in place behind a single switch point (`OwnerUsage` in `src/server/owner-routes.ts`) and is tested with a
  stand-in; the Properties/Units tasks must plug in the real lookups (archive refused with the property list, delete refused when
  any property or unit refers to the owner). No screens changed.
- verify.sh passes; the reviewer approved. No QA pass (no screens changed). Nothing for the owner to do.

### 2026-10-13 — T030: Owners screens
- New pages: **Owners** (`/owners`: Search owners, Show archived, Add owner, table with Owner name / Owner type / City / Properties),
  **Add owner** and **Edit owner** (all the §6.3 fields, Save owner and Cancel, the "There is a problem" summary linking to each
  field) and the owner **detail** page (fields, Properties table, Edit owner, Archive owner / Restore owner, Delete owner). After
  saving you land on the owner's page with "Owner saved."; deleting returns to the list with "Owner deleted."; archived owners are
  marked "(archived)" in the list. Delete owner is greyed out with the reason "Owners used by properties or units can only be
  archived" when something uses the owner. The Smoke user sees the pages without any change buttons.
- If someone else changed the owner meanwhile, **Reload** now really reloads the form with the latest values (QA found it didn't).
- The "Skip to main content" link used to sit above the top of the page, which the locked form tests can't click; it is now tiny and
  invisible until focused, then appears as before. Keyboard behaviour is unchanged.
- The owner detail API now also says whether anything refers to the owner (used to grey out Delete).
- AC-OWN-01 and AC-OWN-02 pass. AC-OWN-03 (in-use owner) needs properties, so it waits for the Properties tasks (T075); the
  Properties column and the in-use checks fill in then.
- QA noted, left as is: a ZIP written "12180-1234" is refused (the spec says 5 or 9 digits and an earlier unit test pins this), and
  State accepts any two letters.
- verify.sh passes; the reviewer approved; QA pass done and findings fixed. Nothing for the owner to do.

### 2026-10-13 — T031: Properties API
- Added the properties back end: list (search by name or address, sort, paging, "show archived"), create, read and edit, plus `GET /api/people`
  (active Admin/Landlord users with name and email, for the "Responsible landlords" choice). Rules follow §6.4: required fields with plain
  messages per field, 2-letter state, 5 or 9 digit ZIP, 10-digit BBL, year built from 1700 to this year, purchase price in cents, and the
  owner must exist and not be archived. The name must be unique among non-archived properties (ignoring capitals): "A property with this
  name already exists."
- Responsible landlords default to whoever creates the property; each must be an active Admin or Landlord, so the Smoke user, deactivated
  and invited users are refused with a validation error. Editing a stale copy gives the "changed by someone else" conflict, unknown ids
  give "not found", and every create/edit writes an Activity-log row (edits show before → after, including owner and responsible landlords).
- Not yet (later tasks): archive/restore/delete, the "Single-unit property" option, and the property type, which shows "—" until units
  exist. Owner archive/delete checks still need to be plugged in to the real property lookups (`OwnerUsage`). No screens changed.
- verify.sh passes; the reviewer approved. No QA pass (no screens changed). Nothing for the owner to do.

### 2026-10-13 — T032: Units API
- Added the units back end: list a property's units (sorted, paged, "show archived"), add a unit, read a unit and edit it. Rules follow §6.7:
  label and use are required; bedrooms 0–20, bathrooms one decimal, square feet whole numbers; the label must be unique within the property
  (ignoring capitals): "A unit with this label already exists in this property."; the use (Residential/Commercial) can't change after the unit
  is created (asking for a different one is refused with "Use can't be changed. To change it, archive this unit and add a new one.").
- A unit can have an "owner if different from the property"; it must exist and not be archived, and the unit then shows that owner (otherwise
  the property's owner). Editing a stale copy gives the "changed by someone else" conflict; every create/edit writes an Activity-log row.
- A property's Type (Residential / Commercial / Mixed) now comes from its non-archived units ("—" when it has none). Adding a property with
  `singleUnitUse` also creates the unit "Entire property" with that use, in the same step (the Add property screen's checkbox will use it).
- Not yet (later tasks): archive, restore and delete of units, status/rent figures on units (they need leases), the unit screens, and the
  owner archive/delete checks (`OwnerUsage`) still need plugging in to real property/unit lookups. No screens changed.
- verify.sh passes; the reviewer approved. No QA pass (no screens changed). Nothing for the owner to do.

### 2026-10-13 — T033: Properties list screen
- New page **Properties** (`/properties`): Search properties (matches name or address), Show archived, Add property, and a table with
  Property (links to the property), Address, Owner, Type, Units, Occupied and Responsible landlords. The empty state reads "No properties
  yet. Add a property or import a spreadsheet." The Smoke user doesn't see Add property. The property list API now also returns the number
  of non-archived units for each property.
- Occupied shows 0 for now because leases don't exist yet; the lease tasks must fill it in from the shared occupancy calculation. The
  Add property page (`/properties/new`, already blocked for the Smoke user) and the property detail page come with the next tasks.
- AC-PROP-10 passes. QA found that a failed list load had no way to retry; the page now shows "Try again" under the error. QA also asked
  whether Show archived should add archived properties or replace the list; it adds them, as the spec says for Owners (AC-OWN-03), so that stays.
- verify.sh passes; the reviewer approved; QA pass done. Nothing for the owner to do.

### 2026-10-13 — T034: Add/Edit property form
- New pages **Add property** (`/properties/new`) and **Edit property** (`/properties/:id/edit`) with every §11.8 field: name, address, city, State,
  ZIP, "Located in New York City", BBL, year built, Owner, Responsible landlords, purchase price, purchase date and notes, plus Save property and
  Cancel. The Owner choice lists only owners that aren't archived, with an **Add owner** button that opens the owner form in a pop-up; after saving,
  the new owner is selected. Responsible landlords are tick boxes showing name and email, with you ticked by default and "Choose at least one
  responsible landlord." if none. On Add only, **Single-unit property** shows **Use** (Residential/Commercial) and creates the "Entire property" unit.
  A name that's already taken shows "A property with this name already exists." next to the field. The Smoke user still can't open the page.
- A purchase price that isn't an amount (e.g. "abc") is now refused with a message instead of being silently dropped (QA found this). Fields in the
  Add owner pop-up have their own ids so screen readers and the "There is a problem" links point at the pop-up's fields (QA found this).
- Saving goes to `/properties/:id`, which has no page yet (the property detail comes with a later task), so it shows "Page not found" for now.
- AC-PROP-03, AC-OWN-04 and AC-PLAT-03 pass.
- QA noticed that archiving an owner used by properties was still allowed, so the real lookups are now plugged in (`dbOwnerUsage`): archiving is
  refused with the list of non-archived properties that use the owner (directly or through a unit's "owner if different"), and deleting is refused
  while any property or unit refers to it. AC-OWN-03's UI part still waits for the property detail pages.
- The Add owner pop-up no longer closes (and loses typed data) when you click outside it; Cancel and Escape still close it.
- verify.sh passes; the reviewer's findings (missing Edit tests, version fallback, archived current owner) are fixed; QA pass done.

### 2026-10-13 — T035: Property detail page
- New page **Property** (`/properties/:id`): the heading is the property name; the summary lists address, Type, Owner, Located in New York City,
  BBL, year built, purchase price and date, and each responsible landlord with name and email. Below are the tabs Units, Values, Property taxes,
  Compliance and Investments (open one directly with `?tab=Compliance`). The Units tab has the table (Unit, Use, Status, Tenants, Current rent,
  Lease end), Show archived and Add unit (hidden for the Smoke user). Edit property is on the page too.
- Not yet (later tasks): Values, Property taxes, Compliance and Investments tab contents, current value / rent roll / yield / total invested in the
  summary, Archive/Restore/Delete property, and the unit screens (Add unit leads to a "Page not found" until the Units screens are built). Status,
  Tenants, Current rent and Lease end show "—" until leases exist.
- AC-PROP-01, AC-PROP-02, AC-PROP-04 and AC-USR-14 pass. QA found that an unknown property showed "Something went wrong" instead of "Page not found"
  and had no Try again; both fixed. Very long names now wrap instead of widening the page. The error message now takes keyboard focus, a lost session (on the property or its Units list) sends you back to sign in, a refused request says "You don't have access to this page.", and
  "Show archived" stays ticked when you switch tabs and come back.
- verify.sh passes; the reviewer approved; QA pass done. Nothing for the owner to do.

### 2026-10-13 — T036: Unit screens
- New pages **Add unit** (`/properties/:id/units/new`), **Edit unit** (`/units/:id/edit`) and **Unit** (`/units/:id`). The form has Unit label, Use, Bedrooms,
  Bathrooms, Square feet, "Owner (if different from property)" and Notes, with Save unit and Cancel. A duplicate label shows "A unit with this label already
  exists in this property." next to the field. On Edit, Use is shown as plain text with the hint "Use can't be changed. To change it, archive this unit and add a
  new one." The unit page's heading is "{Property name} – Unit {label}" and the summary lists Use, Bedrooms, Bathrooms, Square feet, Owner (the unit's own
  owner if set, otherwise the property's) and Status. Saving lands on the unit page with "Unit saved."
- On the property's Units tab each unit now links to its page and shows Status "Vacant" (every unit is vacant until leases exist; Tenants, Current rent and
  Lease end still show "—").
- Not yet (later tasks): Current lease card, Lease history, rent figures, New lease, Archive/Restore/Delete unit.
- AC-UNIT-01, AC-UNIT-02 and AC-UNIT-05 pass. The reviewer approved; QA found nothing blocking and every QA finding was fixed: the Use hint is linked to
  the read-only value for screen readers; after "Reload" on a stale-edit message, focus moves to the first field (all forms); the property and unit summaries
  no longer overflow a 320 px screen; numbers typed with thousands commas ("1,200") are accepted; and the unit page says when the Owner is set for this unit
  rather than inherited from the property.
- One email test (fail-next-email) failed once in the first verify.sh run and passed on re-run and alone; it's a timing flake unrelated to this task.
- verify.sh passes. Nothing for the owner to do.

### 2026-10-14 — T037: Property values
- The property page's **Values** tab now works: a current-value line, a table (Date, Value type, Amount, Source / notes) with **Edit** and **Delete** on each
  row (Delete asks first), and **Add value**, which opens a pop-up with Date, Value type, Amount and Source / notes (**Save value**, **Cancel**). The Smoke user
  sees the table but no buttons. Behind it are the new value endpoints (list, add, edit, delete) and a new database table; every change is written to the
  activity log.
- The property summary now has **Current value**, e.g. "$950,000.00 (Market estimate Jun 1, 2026)" or "(Purchase price)". The latest market estimate wins;
  without one the purchase price is used; assessed values never count (D-15). One shared calculation (`currentValue`) does this for everyone.
- Not yet (later tasks): Monthly rent roll, Gross yield and Total invested in the summary; the other tabs.
- AC-PROP-05 and AC-PROP-06 pass. The reviewer approved. QA found and I fixed: focus is returned to **Add value** after a delete; amounts are capped at $10 billion
  ("Enter a smaller amount."); two estimates on the same date are listed newest-first, matching which one counts; saving an edit with no changes no longer
  bumps the version. Not changed (the spec is silent): future-dated estimates count as the current value, and very narrow phone screens wrap the amount in the summary.
- verify.sh passes. Nothing for the owner to do.

### 2026-10-14 — T038: Property taxes
- The property page's **Property taxes** tab now works: a table (Tax year, Annual property tax) with **Edit** and **Delete** on each row (Delete asks first), and **Add tax year**, which opens a pop-up with Tax year and Annual property tax (**Save tax year**, **Cancel**). The Smoke user sees the table but no buttons. Behind it are the new tax-year endpoints (list, add, edit, delete) and a new database table; every change is written to the activity log.
- Tax years must be between 1990 and 2100 and each year can be entered once per property: a second 2025 shows "This tax year already exists for this property." next to the Tax year field (also when editing a year into one that exists).
- Not yet (later tasks): refusing to delete a tax year that a lease uses as its base tax year — leases don't exist yet, so that check arrives with them (§6.6).
- AC-PROP-07 passes. The reviewer approved. QA found and I fixed: a lost session while saving/deleting now says "Your session has ended. Sign in again to continue." and returns you to sign-in; editing a year someone else just deleted says so instead of "Something went wrong". Also fixed: a negative amount like -5 now says "The amount can't be negative." (all money fields show their own minimum message instead of "Enter an amount."), and Reload after a stale edit keeps the pop-up open with the latest values.
- verify.sh passes. Nothing for the owner to do.

### 2026-10-14 — T039: Tenants API
- New tenant endpoints: list (search by name or email, paging, sorting, "show archived"), add, view, edit, archive, restore and delete. An Individual needs a first and last name; a Business needs a business name and a contact person, and each missing field gets its own message (e.g. "Enter the contact person."). Email, phone and notes are optional. Switching a tenant's type clears the names that no longer apply. Every change is written to the activity log, and editing from a stale page is refused with "changed by someone else".
- Each tenant comes back with its display name ("Ann Lee" or "Acme Shop (Bo Diaz)"). Page-size limit (200) and the 422 for a larger one work as in the other lists.
- Not yet (later tasks): refusing to delete a tenant who is on a lease. Leases don't exist yet, so for now no tenant counts as being on one; the check is already plugged in and tested, and only needs the real lease lookup when leases are built. The Tenants screens come later too.
- AC-API-03 passes. The reviewer approved. No screens changed, so no QA pass. verify.sh passes. Nothing for the owner to do.

### 2026-10-14 — T040: Tenant screens
- New pages **Tenants** (`/tenants`: Search tenants, Show archived, Add tenant; columns Name, Contact person, Email, Phone, Current unit(s)), **Add tenant** / **Edit tenant** (Tenant type choice of Individual or Business; the name fields shown change with the type; Email, Phone, Notes; Save tenant, Cancel) and **Tenant** details (contact details, a Leases table, Edit / Archive / Restore / Delete tenant, with Delete asking first). Saving lands on the tenant's page with "Tenant saved."; the Smoke user sees no buttons.
- A missing name now says "Enter a contact person." (and likewise "Enter a first name.", "Enter a last name.", "Enter a business name.") to match the spec; the API uses the same wording.
- Not yet (later tasks): the Leases table and "Current unit(s)" stay empty ("–") until leases exist, and Delete tenant only becomes unavailable for tenants on a lease once leases are built (AC-TEN-04, AC-TEN-05).
- AC-TEN-01, AC-TEN-02 and AC-TEN-03 pass. The reviewer approved. QA found and I fixed: long emails/names no longer push the details page sideways on a phone screen; saving an edit for a tenant someone else deleted now says "Tenant not found.". Not changed: search text isn't kept in the web address.
- verify.sh passes. Nothing for the owner to do.
- Also: several older screen tests waited a fixed 30 ms for data and sometimes failed on a busy machine (not a bug in the app). They now wait 100 ms, and the Values and Property taxes tests wait until their table appears. No assertion was changed.

### 2026-10-14 — T041: Deactivating a landlord updates properties
- Deactivating a landlord now also takes them off every property's responsible landlords, in the same step as signing them out. A property that would be left with nobody gets the Admin instead; a property that still has other landlords just loses that one. Reactivating does not put them back (as the spec says). Each affected property is recorded in the activity log and counts as edited, so an open edit page for it will ask to reload.
- AC-USR-08 passes. The reviewer approved. No screens changed, so no QA pass. verify.sh passes. Nothing for the owner to do.

### 2026-10-14 — T045: Lease data model
- The database now has the tables leases need: leases, the tenants on each lease, extensions (with their own tenants), rent steps for a lease or an extension, and lease versions (a saved copy each time a lease changes). The database itself refuses a lease whose end isn't after its start, zero rent, a rent due day outside 1–28, a move-out date without a reason (or the reverse), more than one primary tenant, and a rent step attached to both or neither of a lease and an extension. Deleting a lease removes everything attached to it; a unit or tenant that is on a lease can't be deleted from under it.
- Shared checks for lease and extension input are in place for the lease screens and API (the next tasks): field limits (e.g. "Enter a percentage above 0 and up to 50."), and rules across fields (exactly one primary tenant, rent step dates inside the term and increasing, children only for Residential units, tax terms only for Commercial units). Rules that need other records (overlapping leases, extension chain, base tax year exists, archived tenants) come with the API task.
- Nothing visible changes yet, so no screens were checked. The reviewer approved; verify.sh passes. Nothing for the owner to do.

### 2026-10-14 — T046: Create a lease (API)
- New endpoint to add a lease to a unit. It checks every rule in the spec: end after start, rent above zero, exactly one primary tenant, rent steps inside the term and in order, the annual percentage, children only for Residential units, tax terms only for Commercial units, the base tax year must already be entered for the property, and archived or unknown tenants are refused. A move-out date and its reason must come together.
- A lease whose dates clash with another lease on the unit is refused with "This unit already has a lease for those dates." (a lease ending the day before another starts is fine; older leases can be entered). When the only clash is the unit's current lease and the new one starts after it, sending `replaceCurrentLease` (with a reason, default "Replaced by new lease") ends the current lease the day before the new start, in the same step. The new lease, its tenants, its rent steps and a version 1 copy of it are saved together and written to the activity log.
- Also: a tenant who is on a lease can now no longer be deleted (only archived), as the spec says.
- The request can also carry `newTenants` (each with `isPrimary` and the usual tenant fields). They are created in the same step as the lease, so if the lease is refused no tenant is left behind; they count toward the "exactly one primary tenant" rule and each is written to the activity log.
- Not done here: the error for a clash doesn't yet say whether "Replace current lease" is offered; the New lease screen task can add that.
- No screens changed, so no QA pass. The reviewer approved. verify.sh passes. Nothing for the owner to do.

### 2026-10-14 — T047: Lease read API
- New read-only endpoints for leases: a list (filter by status — can be given several times — property, unit, tenant, and "archived"; sort and page like the other lists), one lease with its tenants, rent steps, extensions, status, and the values of its current term (tenants, rent, deposit, pets, tax terms and so on), the rent schedule (master term then each extension), the list of versions, and one version's saved copy. Status is worked out by the shared lease rules, so the list shows the same status as everywhere else; archived leases show "· Archived" after their status. A tenant who is only on an extension still shows up when filtering by that tenant. Unknown lease or version numbers give "not found".
- Not yet (later tasks): the Leases and lease detail screens. No screens changed, so no QA pass. The reviewer approved. verify.sh passes. Nothing for the owner to do.

### 2026-10-14 — T048: Change a lease (API)
- New endpoints to change a lease: **edit** (only the fields you send change; tenants and rent steps you send replace the old lists), **Mark month-to-month** (with an optional rent; otherwise the last rent applies), **End lease** (a move-out date, which may be before the lease start, plus a reason) and **delete**. Every edit re-checks all the lease rules: dates, rent, one primary tenant, rent steps, the percentage, residential/commercial fields, a base tax year that exists, no archived tenants newly added, no clash with another lease on the unit, and that extensions still start after the lease ends and still have a tenant from the original lease.
- Each change saves a new numbered version with a readable line such as "Monthly rent: $2,150.00 → $2,200.00" (older versions stay as they were) and an activity-log entry. A change made from a stale page is refused ("changed by someone else"); an edit that changes nothing doesn't create a version. Month-to-month is only offered to Active or Needs decision leases; ending isn't allowed for Upcoming or already ended leases; both are refused if they would make the lease clash with another one on the unit. Archived leases can't be changed.
- Deleting a lease removes its versions, tenants, extensions and rent steps in one step. Not yet: removing generated PDFs and their stored files, because PDFs don't exist yet — that comes with the PDF tasks.
- No screens changed, so no QA pass. The reviewer found that month-to-month skipped the clash check; fixed and tested. verify.sh passes. Nothing for the owner to do.

### 2026-10-14 — T050: New lease wizard, frame and step 1
- New page **New lease** (`/units/:id/leases/new`, not for the Smoke user) showing "Step 1 of 4" with **Next** (and **Back** from step 2). Step 1 has the **Add existing tenant** search box (by name or email; archived tenants and ones already added aren't offered), **Add new tenant** (a small form with **Add tenant** and **Cancel**; new tenants are only saved later, together with the lease), a table of the added tenants with a **Primary contact** choice and **Remove** on each row.
- **Next** says "Add at least one tenant." or "Choose a primary contact." when needed, and the message goes away once fixed. Leaving with tenants added (a link, the browser's Back button, reload or closing the tab) asks "Discard this lease? Your changes will be lost." with **Discard** / **Keep editing**.
- Not yet (later tasks): steps 2–4 only show their headings, so a lease can't be saved from the wizard yet (AC-LEASE-01 and the others need those steps); a **New lease** button on the unit page.
- AC-LEASE-02 and AC-LEASE-17 pass. verify.sh passes. The reviewer approved. QA found and I fixed: Back button skipped the prompt, a stale "Choose a primary contact." message, an unclosable pop-up after typing only spaces, lost keyboard focus after Remove. Also fixed: each tenant row now shows the email so two tenants with the same name can be told apart, and the Back-button guard keeps just one extra history entry however often tenants are added and removed.
- Nothing for the owner to do.

### 2026-10-14 — T051: New lease wizard, step 2 (term and rent)
- Step 2 of **New lease** now has **Lease start date**, **Lease end date**, **Monthly rent**, **Security deposit**, **Rent due day**, **Late fee**, **Late fee grace period (days)** and the **Rent increases** choice (None / Fixed percentage each year / Custom schedule). A percentage shows **Annual increase (%)**; a custom schedule shows rows of **Effective date** and **Monthly rent** with **Add row** and **Remove**. A **Rent schedule** table (Period start, Period end, Monthly rent) updates as you type. When the end date is before today, **Move-out date** and **Reason** also appear (both or neither).
- **Next** shows a "There is a problem" list and a message by each field, e.g. "Lease end date must be after the start date." and "Effective date must fall within the lease term."; the messages clear as you fix them. A lease term can be at most 50 years (the spec sets no limit; this stops absurd dates from breaking the page).
- Not yet (later tasks): steps 3 and 4 and saving; the **Replace current lease** option (needs the clash check at save time, AC-LEASE-09). Move-out date/Reason values typed and then hidden (end date moved to the future) must be ignored when saving — the saving task should handle that.
- AC-LEASE-03 and AC-LEASE-08 pass. verify.sh passes. The reviewer approved. QA found and I fixed: a second custom row added after Back/Next shared an id with the first (Remove deleted both); a far-future end date with a percentage blanked the page; the preview used rows that failed validation; focus now moves to a new row; repeated error messages say which rent step they belong to.
- Nothing for the owner to do.

### 2026-10-14 — T052: New lease wizard, steps 3 and 4 (special terms, review, save)
- Step 3 now has **Pets**, **Parking**, **Parking charge (monthly)**, **Break clause** and **Other special terms**. A Residential unit also asks **Children reside in unit** (Yes/No, required: "Choose Yes or No."); a Commercial unit doesn't show it and instead has **Base tax year** (a choice of the property's tax years, or the hint to add them on the Property taxes tab), **Tenant's share of tax increase (%)** and a **Tax reimbursement (monthly)** line that updates as you type, with the same explanation as the spec.
- Step 4 shows a summary of all values, a **Lease template** choice and **Save lease**. Saving creates the lease (new tenants are created with it) and goes to the lease's page. Move-out date/Reason typed and then hidden by a future end date are not sent. A refused save (e.g. the dates clash with another lease) shows the server's message in a "There is a problem" box and keeps everything entered. Moving between steps now puts keyboard focus on the step heading.
- Not yet (later tasks): the lease's page itself (T053, so after saving you'll see an empty page for now), real templates in the Lease template choice and **Save and generate PDF** (shown but disabled; T090), and Replace current lease needs the clash handling task.
- AC-LEASE-04 passes. verify.sh passes. The reviewer approved. QA found and I fixed: a network failure showed a raw browser message, focus was lost when changing steps, a refused save's messages didn't say which field they were about (now "Base tax year: …"), the Review summary lacked the computed Tax reimbursement, and money fields rejected ".50" and "5." (now accepted everywhere). Also: when a save is refused because the dates clash with another lease, the Review step now offers **Replace current lease** (asks "End the current lease on {day before the new start} and start this one?" with a Reason, default "Replaced by new lease"). It is offered only when it can work: the server's clash refusal now also says when Replace applies (one current lease, new start later), and the offer disappears if the dates are changed. Pressing the browser's Back after saving no longer lands on an empty wizard; it goes to the unit page. Left for T057: showing the clash on step 2 and the AC-LEASE-09 checks.
- Nothing for the owner to do.

### 2026-10-14 — T053: Lease detail page
- New page **Lease** (`/leases/:id`) titled "Lease – {Property} Unit {label}" with a status badge (e.g. Upcoming, Active, Needs decision). Sections: **Tenants** (name, email, phone, "Primary contact" marker, for the current term), **Term and rent** (start, end, Effective end date, Current monthly rent, deposit, rent due day, late fee and grace period, plus the **Rent schedule** table across the original term and any extensions), **Special terms** (children only for Residential; base tax year and the tenant's share for Commercial) and **Other income** (parking charge; for Commercial, Tax reimbursement (monthly) with the explanation, e.g. "25% × (2025 tax $52,000.00 − 2020 tax $40,000.00) ÷ 12", and $0.00 when the latest tax is lower).
- The server's lease detail now also says whether the unit is Residential or Commercial and works out the tax reimbursement. Percent fields (tax share, annual increase) now also accept numbers written as text, like "25".
- Not yet (later tasks): Extensions, Versions and Documents sections and the action buttons (Edit lease, Mark month-to-month, End lease, Delete lease, Generate PDF); the Leases list page.
- AC-LEASE-01, 06, 07, 14, 15 and 24 pass. verify.sh passes. The reviewer approved. QA found and I fixed: values were squeezed into a sliver on a phone screen (labels now stack above values), "1 days" now reads "1 day", and line breaks in special terms are kept. Left as is: wide tables scroll sideways on narrow screens (they are keyboard reachable).
- Nothing for the owner to do.

### 2026-10-14 — T054: Lease information on units
- The unit page now shows **Status** as Occupied, Vacant, or "Vacant · leased from {date}", plus **Current rent** (occupied) or **Potential rent** (vacant units that have had a lease: the last rent). A **Current lease** card shows tenants, term, status and **View lease** (or "No current lease."), and a **Lease history** table lists Start, End, Tenants, Status and Rent at end, newest first. On the property's Units tab, Status, Tenants, Current rent and Lease end now fill in. Primary contact is listed first among tenants.
- A lease past its end with no move-out date and no later lease ("Needs decision") still counts as Occupied, as the spec says.
- AC-LEASE-05 passes. verify.sh passes. The reviewer approved. QA found and I fixed: long unbroken tenant names pushed the unit page sideways on a phone; tenant order looked random. Also fixed: Lease end (and the history's End) now show the move-out date when one is set, and a month-to-month lease shows no Lease end. Left for later tasks: the unit page's New lease / Archive / Delete buttons belong to later tasks.
- Nothing for the owner to do.

### 2026-10-14 — T062: Dashboard API
- New read-only endpoint `GET /api/dashboard` (any signed-in user, including the Smoke user). It returns the Portfolio summary (units, occupied, vacant, occupancy, rent rolls, other income, vacancy loss, portfolio value, gross yield and the note "Based on 1 of 2 properties with a value."), one row per property for the By property table, the leases needing a decision (ended on, current rent) and the leases ending in the next 90 days (end date, days left, current rent). Everything comes from the shared calculations, so it agrees with the unit and lease pages. Archived properties, units and leases are left out.
- "Ending in the next 90 days" counts only Active leases, using the move-out date if there is one and otherwise the effective end; month-to-month, upcoming and needs-decision leases are excluded.
- Not yet (later tasks): the Dashboard screen, and the two compliance tables (they need the compliance tasks first). The Properties list still shows 0 for Occupied; the dashboard computes it itself.
- No screens changed, so no QA pass. The reviewer approved. verify.sh passes. Nothing for the owner to do.

### 2026-10-14 — T063: Dashboard screen
- The home page (`/`) now shows the Dashboard: the **Portfolio summary** (Units, Occupied, Vacant, Occupancy, Monthly rent roll, Annual rent roll, Monthly other income, Vacancy loss (monthly), Portfolio value, Gross yield) with the note "Based on {n} of {m} properties with a value.", the **By property** table (property names link to the property; "—" where there is no value or yield), **Leases needing a decision** and **Leases ending in the next 90 days** (each shows "None." when empty). The Smoke user sees the same read-only page.
- Not yet (T064): the **Overdue compliance** and **Compliance due in the next 30 days** tables (they need the compliance tasks first).
- AC-DASH-01, 02, 03, 05, 06 and 07 pass (AC-DASH-04 belongs to T064). verify.sh passes. The reviewer approved. QA found and I fixed: if the dashboard says you're signed out, the page now ends the session and sends you to sign-in instead of a generic error, and the tables are hidden (not shown empty) when loading fails. The tables now appear with their headings while the data loads. Also fixed: a very long property name no longer squeezes its column into a tall sliver on a phone-width screen (the table scrolls sideways instead).
- Nothing for the owner to do.
- Note for the owner: the checks occasionally fail on a test that has nothing to do with the Dashboard, then pass when run again (seen: AC-LEASE-05, AC-AUTH-04, and AC-TEN-01/02 in the online run). AC-TEN-01 and AC-TEN-02 fail about 1 time in 25 even on the code from before this task: the locked test helper `choose` looks for the "Tenant type" choice once, straight after the page loads, without waiting for the form to appear. I can't change locked tests, so if the online run fails on one of these, re-run it.

### 2026-10-15 — T065: Compliance data model and seeding
- The app now stores compliance item types, one compliance item per property and type, and completions. On every start the nine standard items from the spec (HPD Property Registration, Bed Bug Annual Filing, Window Guard, Lead-Based Paint, Stove Knob Cover, Smoke and CO Detector Check, Storefront Registry Filing, Boiler Inspection, Gas Piping Inspection) are added if missing. Existing ones are never overwritten, so later edits survive, and starting twice at once is safe.
- Every property gets an item for every type. An item applies only when the property has at least one non-archived unit that matches the type (Residential/Commercial or All) and, for NYC-only types, the property is marked as in New York City. A property with no units has nothing applicable. Applicability is recalculated when a unit is added or the "Located in New York City" flag changes, and items an editor switched by hand are left alone. Items that become applicable with a yearly date get their next due date (the next occurrence of that month and day); "every N months" and one-time items start as "Not scheduled".
- Not yet (later tasks): unit and property archive/restore must call the same recalculation (T074); a newly created item type must call the helper that adds it to every property (T067); the screens and status/reminder calculations (T066–T071).
- No screens changed, so no QA pass. The reviewer found that a recalculation didn't bump the item's version number; fixed and tested. verify.sh passes. Nothing for the owner to do.

### 2026-10-15 — T066: Compliance calculations
- Added the shared calculations the compliance screens and emails will use: an item's **status** (Not applicable, Completed, Not scheduled, Overdue, Due soon within 30 days, Upcoming), the **Mark done** suggested next due date (yearly items add years until the date is after the completion date; "every N months" items add N months to the completion date; one-time items suggest none), and the **reminder thresholds** with catch-up (compliance: 30 and 7 days before, the due date, then every 7 days overdue; lease ending: 90/60/30 days before; needs decision: 1 day after, then every 7 days; an item is sent when its latest reached threshold has not been logged yet).
- No screens changed, so no QA pass. The reviewer approved. verify.sh passes. Nothing for the owner to do.

### 2026-10-15 — T067: Compliance API
- The server can now list, add, edit, archive, restore and delete compliance item types; list a property's compliance items (`GET /api/properties/{id}/compliance`) and all items with filters for property, status and responsible landlord; switch an item on or off, set its due date and notes; and record, list and delete completions ("Mark done" can also set the next due date in the same step). Status comes from the shared calculation, so every screen will agree.
- Adding a type puts it on every property at once (applicable for properties with units, "Not applicable" for those without). Changing who a type applies to, or restoring it, recalculates applicability but keeps any switch an editor set by hand. A type with completions can't be deleted (archive it instead); deleting one without completions removes its items everywhere. Items of an archived type are hidden and can't be changed. Every change is in the Activity log.
- Note: a seeded type that is deleted comes back the next time the app starts (the catalog is re-seeded); archive it if it should stay out of the way.
- No screens changed, so no QA pass. The reviewer found that editing an item of an archived type returned an empty answer; fixed and tested. verify.sh passes. Nothing for the owner to do.

### 2026-10-15 — T068: Property Compliance tab
- A property's **Compliance** tab now lists every item with its **Applies to this property** switch, **Status**, **Due date** and **Last completed** date. **Mark done** asks for **Completed on** (today by default), **Notes** and **Next due date**, filled in with the suggested date from the spec and updated when you change the completion date (until you type your own). **Set due date** changes or clears the date. **History** lists past completions with **Delete** (after a confirmation). The Smoke user can look but not change anything; the links from the daily email (`?tab=compliance`) now open this tab.
- A switch you turn off stays off when units are added later.
- AC-CMP-02, 03, 05, 06, 11 and 12 pass. verify.sh passes. The reviewer approved. QA found and I fixed everything it reported: the lowercase `?tab=compliance` link opened the Units tab; focus was lost after deleting a completion; odd dates were accepted (dates must now be between 2000 and 2100, and the next due date can't be before the completion date — a rule the spec doesn't state, added by judgement); and every row's switch and buttons had the same spoken name (now e.g. "Mark done – Bed Bug Annual Filing").
- Not yet (later tasks): the Compliance page's Due list and the Dashboard compliance tables (AC-CMP-04, 07, 10 need them).
- Nothing for the owner to do.

### 2026-10-15 — T069: Compliance Due list
- The **Compliance** page (`/compliance`) now has a **Due list** tab with the filters **Property**, **Status** (Overdue, Due soon, Upcoming ticked by default; Not scheduled, Not applicable, Completed can be added) and **Responsible landlord**. Columns: Property (linked), Item, Due date, Status, Last completed, Responsible landlords, and **Mark done** / **Set due date** buttons (hidden for the Smoke user) that open the same dialogs as the property's Compliance tab. Unticking every status shows "Choose at least one status."
- Not yet (later tasks): the **Item types** tab, and the Dashboard compliance tables.
- AC-CMP-10 passes. verify.sh passes. The reviewer approved. QA found and I fixed: a long property name made the page scroll sideways on a phone; keyboard focus was lost when a saved item left the list; the dialogs didn't name the property; the "choose a status" message wasn't announced. Also fixed: the Property filter now lists every property. Also fixed: **Completed on** can no longer be a future date ("The completion date can't be in the future." — a rule the spec doesn't state, added by judgement), and the compliance list API accepts a repeated or bracketed status filter. After a "someone else changed this" message, **Reload** now reopens the Mark done / Set due date dialog on the latest version of the item and keeps what you typed, so you can just press Save again.
- Nothing for the owner to do.

### 2026-10-15 — T070: Compliance Item types tab
- The **Compliance** page now has an **Item types** tab: the notice ("Default dates are starting points. …"), an **Add item type** button and a table (Name, Applies to, NYC only, Schedule) with **Edit**, **Archive** / **Restore** and **Delete** on each row. Archived types stay in the list marked "(archived)". The form has **Name**, **Description**, **Applies to**, **New York City properties only**, **Schedule**, then **Month** + **Day** (yearly) or **Repeat every (months)**, with **Save item type** and **Cancel**; a yearly schedule without month and day shows "Choose a month and day." Delete asks first; a type that has completions can't be deleted and the page says to archive it. The Smoke user sees the list but no buttons.
- AC-CMP-01, 08, 09, 13, 14 and 15 pass. verify.sh passes. The reviewer approved. QA found no serious problems; I fixed the unstyled refusal message and lost keyboard focus after a delete. Also fixed: Month, Day and Repeat every (months) are now marked "(required)" when shown, and "Choose a month and day." now appears once, on the field at fault (Month, or Day), instead of on both. The Item types list now loads every page, so there is no 200-type limit. A flaky Property page unit test (fixed 100 ms wait) now waits for the Units table. Later polish after more QA rounds: the Item types tab is in the address (`/compliance?tab=types`, and switching tabs adds browser-history entries); the list loads every item type (no 200 limit); values typed under another Schedule are dropped when you switch Schedule, so they can't block saving; Day and Repeat every (months) refuse things like "1e1"; a Day that doesn't exist says so ("Feb 29 isn't allowed. Choose another day." / "That day doesn't exist in this month. Choose another day."); a refused Delete's message gets keyboard focus (with a 2 px ring) and scrolls into view. Left as is: non-numeric text in Day says "Choose a month and day."; the blank case shows that message once in the summary box and once on the Month field.
- Nothing for the owner to do.

### 2026-10-15 — T072: Investments API
- The server can now list, add, edit and delete investment entries (date, property, unit or "Whole property", category, description, vendor, cost). The list can be filtered by property, category, From and To, and it also reports the total cost for the whole filter (not just the current page). Every change is in the Activity log; deleting an entry removes it for good. The Smoke user can read but not change.
- A unit must belong to the chosen property. New entries are refused on an archived property or unit (a rule the spec doesn't state, added by judgement), but an existing entry there can still be corrected or deleted. Moving an entry to another property clears its unit unless a new one is given.
- A property or unit that has entries can't be removed from the database (it can only be archived); the delete rules and messages arrive with T074.
- Not yet (later tasks): the Investments screen and the property's Investments tab and Total invested (T073). No screens changed, so no QA pass. The reviewer approved. verify.sh passes. Nothing for the owner to do.

### 2026-10-15 — T073: Investments screen
- The **Investments** page (`/investments`) now has the filters **Property**, **Category**, **From** and **To**, an **Add entry** button and a table (Date, Property, Unit, Category, Description, Vendor, Cost) with **Edit** and **Delete** (after a confirmation). A **Total** row at the bottom adds up Cost for the whole filter, across all pages. In the Add/Edit dialog, **Unit** starts with "Whole property" followed by the chosen property's units. Saving shows "Entry saved."; deleting shows "Entry deleted.". The Smoke user sees everything but no buttons.
- A property's **Investments** tab shows the same list for that property (Add entry is hidden when the property is archived), and the property summary now shows **Total invested**.
- AC-INV-01 to 05 pass. verify.sh passes. The reviewer approved. QA found and I fixed: the Property choice looked empty in the Add entry dialog on a property's tab; saving an entry deleted elsewhere gave a vague error (now "This entry no longer exists. Reload the page."); a From date after the To date now says "From can't be after To." (a message the spec doesn't state, added by judgement).
- Also fixed after QA: the row buttons are now named exactly **Edit** and **Delete** (as the spec says) and described by the entry's description for screen readers, so they can no longer be confused with the dialog's **Delete entry** button. Decided, not a defect: Edit and Delete stay available on entries of archived properties, because the spec (§6.15) gives editors full create/read/update/delete on investment entries; only adding new entries to an archived property is refused. The change is somewhat over the usual ~250-line size because the screen, tab and tests belong together.
- Nothing for the owner to do.

### 2026-10-16 — T081: Templates API and placeholder list
- The server can now list, add, read, edit, archive, restore and delete lease and extension templates, and list the placeholders (`GET /api/placeholders?kind=`). Every landlord sees the same templates; the Smoke user can read but not change. Names must be unique among non-archived templates ("A template with this name already exists."), an empty name gives "Enter a template name.", and the template type can't change after the first save. The list can include archived templates and can be filtered by type. Every change is in the Activity log.
- On save the server re-checks the content (§8.4): only text, Heading 1/2, bold/italic/underline, lists, simple tables, centre alignment and page breaks; no images, links, colours or merged cells. Unknown placeholders, and extension-only ones in a Master lease template, are refused with "Unrecognised placeholders: …" (422), and nothing is saved.
- Not yet: "delete only if no generated PDF has used the template" can't be enforced until the generated-documents table exists (later PDF task), so for now every template can be deleted; that task must add the check (and its test). The editor screens, Preview PDF and the Templates page are later tasks.
- No screens changed, so no QA pass. The reviewer approved. verify.sh passes. Nothing for the owner to do.

### 2026-10-16 — T082: Templates list and editor screens
- The **Templates** page (`/templates`) now lists templates (Name, Type, Last updated, Updated by) with **New template** and **Show archived**; archived ones are marked "(archived)". The editor (`/templates/new`, `/templates/:id`) has **Template name**, **Template type** (fixed after the first save), the **Template content** editor and the toolbar (Heading 1, Heading 2, Bold, Italic, Underline, Numbered list, Bulleted list, Align center, Page break, Insert table, Insert placeholder). The toolbar is one Tab stop; the arrow keys move along it. **Insert placeholder** opens a searchable list of the chips valid for the template type and inserts a "[Chip label]" chip. **Save template** shows "Template saved."; an empty name shows "Enter a template name." and a duplicate name "A template with this name already exists." **Archive template** / **Restore template** and **Delete template** (after a confirmation) work; Delete explains why it is unavailable once a template has been used for a PDF (that check arrives with the PDF task). The Smoke user sees a read-only template.
- AC-TPL-06 and AC-TPL-08 pass. verify.sh passes. The reviewer approved. QA found and I fixed: Tab inside a table no longer adds rows (keyboard users can leave it); lists, page breaks and a second table are unavailable inside a table cell (the server only allows text there); the editor no longer breaks the browser's security policy; Restore shows the name-clash message instead of a generic error; the placeholder search is cleared when the list closes.
- Not yet (later tasks): pasting `{{keys}}` into chips and the "Unrecognised placeholders" warning (T083), Word paste clean-up (T084), **Preview PDF** and the **How to convert a Word lease** help link. Left as is: an archived template can still be edited (the spec doesn't forbid it); no warning when leaving with unsaved changes (not in the spec).
- A small unrelated fix to the Investments dialog from the earlier session (units ready when a property is chosen) was left uncommitted in the working folder; it is committed separately.
- Nothing for the owner to do.

### 2026-10-16 — T083: Placeholder chips, warning and save block
- Pasting text with `{{monthly_rent}}`-style keys into the template editor now turns each recognised key into its chip (e.g. [Monthly rent]); spaces inside the braces are fine. Unknown keys, and extension-only keys in a Master lease template, stay as plain text. The editor lists them under **Unrecognised placeholders: …** (extension-only keys add "(only available in Lease extension templates)"), and **Save template** then says "Fix the unrecognised placeholders before saving." and saves nothing. The warning goes away as soon as the keys are fixed or the template type changes to one that allows them. **Insert placeholder** already offered only the keys valid for the type (T082).
- AC-TPL-01 to 04 pass. verify.sh passes. The reviewer approved. QA found and I fixed: a very long key made the page scroll sideways on a phone; the warning wasn't linked to the editor for screen readers; before a template type is chosen the warning no longer appears (keys can't be judged yet).
- Left as is (spec only converts pasted keys): a valid `{{key}}` typed by hand (not pasted) stays as text without a warning (unknown typed keys are still listed), and a key pasted while Master lease is chosen and kept as text stays text if the type is later switched to Lease extension. Keys split across formatting runs (Word) come with T084.
- Nothing for the owner to do.

### 2026-10-16 — T084: Word paste clean-up
- Pasting from Word (or anywhere) into the template editor now removes images, shapes, headers, footers, footnotes, comments and Word's list-bullet markers, drops hyperlinks but keeps their text, drops tracked deletions (keeps inserted text), and splits merged table cells. When something was removed, the editor shows "Some content was removed: images, headers and other unsupported items aren't allowed in templates." (it clears after a paste that removes nothing, or when the editor is emptied). A `{{key}}` that Word split across formatting runs (e.g. partly bold) now becomes one chip.
- AC-TPL-09 passes. verify.sh passes. The reviewer approved. QA found and I fixed: the notice never went away; Word bullet markers were left in as stray "·" text.
- Left as is: a table cell merged over several rows (rowspan) loses the merge but the rows below aren't padded, so such a table can look ragged (column merges are padded correctly); an empty first paragraph can remain where a removed header/logo was. Not tested with a real Word copy, Firefox or WebKit by hand (the acceptance run covers Chromium only on CI).
- Nothing for the owner to do.

### 2026-10-16 — T085: Template rendering to HTML
- Behind the scenes, a template can now be turned into the page content for a PDF. Every placeholder from the spec gets its value: dates like "January 5, 2027", money like "$2,500.00", rent in words ("Two thousand five hundred dollars and 00/100"), "1st" for the due day, "5 days", "3%", tenant names joined with commas and "and", signature lines (one per tenant) and the rent schedule table. In an extension, the extension's own dates, rent and tenants are used, and "Removed tenants" / "Added tenants" show "None" when nobody changed. Anything with no value prints as `__________`, and the list of empty items (for the "These items are empty…" message) is produced at the same time.
- The output only ever contains the allowed formatting, with all text escaped, so nothing in a template or a tenant name can inject links, images or scripts.
- Not yet (later tasks): the PDF itself, Preview PDF and the Generate PDF dialog use this. No screens changed, so no QA pass. The reviewer approved. verify.sh passes. Nothing for the owner to do.

### 2026-10-16 — T086: PDF rendering engine in the worker
- Behind the scenes, the worker can now turn page content into a PDF: US Letter, 1-inch margins, the bundled Tinos font at 11 pt, centred 16 pt headings, thin table borders, page breaks where the template has them, a footer on every page (address and unit on the left, "Page X of Y" on the right) and the file name as the document title. One Chromium is started on the first job and reused, two PDFs at a time, and replaced after 100 jobs or a crash. Rendering is fully offline: scripts are off, every network request is blocked and the font is built in, so a template can never make the server fetch anything.
- Also added: the storage client for the PDF bucket (MinIO locally, Tigris in production) with save, delete, "does it exist" and 5-minute private download links. The Docker image now includes Chromium, which makes it larger (about 1.7 GB).
- Not yet (later tasks): the Documents API, the "Generating…/Ready/Failed" flow, Preview PDF and the download buttons use this (T087 onwards). No screens changed, so no QA pass. The reviewer approved. verify.sh passes (101 acceptance tests). Nothing for the owner to do.

### 2026-10-16 — T092: Help page "Converting a Word lease"
- New help page at `/help/templates` with the ten steps of Appendix A (including the list of extension keys), open to every signed-in user, the Smoke user too. The template editor (new, saved and read-only views) has a **How to convert a Word lease** link to it. The link opens in a new tab so a half-written template isn't lost; a hidden note says so for screen readers. Long keys on the page wrap instead of breaking mid-word. The page also has a "Back to Templates" link (not in the spec).
- verify.sh passes (101 acceptance tests; one earlier run had a one-off sign-in timeout in AC-LEASE-07, which passed on its own and on re-run). The reviewer approved. QA found and I fixed: the link discarded unsaved work (now a new tab); keys broke mid-word on a phone.
- Left as is: the left menu doesn't highlight "Templates" on the help page.
- Nothing for the owner to do.

### 2026-10-16 — T093: Import template and Import page
- The **Import** page (`/import`) now explains how importing works and has a **Download template** button. It downloads `rentnerd-import-template.xlsx` with an **Instructions** sheet (every column, whether it is required, and its format) and the sheets **Owners**, **Properties**, **Units**, **Tenants** and **Leases**. Each sheet has one column per field, headed with the field's name from the spec, plus the link columns (Owner key, Property key, Unit key, Tenant 1–4 key, Owner override key) and **Responsible landlord emails**.
- Not yet (later tasks): choosing a file, **Check file**, the problems table, **Import** and **Cancel**. The Instructions sheet already describes them.
- AC-IMP-01 passes. verify.sh passes (102 acceptance tests). The reviewer approved. QA found no defects. The spreadsheet library (exceljs) was added to the project.
- Left as is: the read-only Smoke user can also download the template (it changes no data); say if you want it hidden for them.
- Nothing for the owner to do.

### 2026-10-16 — T094: Import file check (part 1)
- On the **Import** page you can now choose a spreadsheet (**Spreadsheet file**) and click **Check file**. A good file shows "Ready to import: 1 owners, 1 properties, 2 units, 2 tenants, 1 leases." (with your own numbers) and a **Cancel** button; a file with problems shows "We found N problems. Fix them in the spreadsheet and check the file again." and a table of Sheet, Row, Column and Problem.
- The file is checked before anything is read from it: it must be an .xlsx ("Choose an .xlsx file."), 5 MB or smaller ("The file must be 5 MB or smaller."), under 50 MB once unpacked and at most 5,000 rows per sheet ("This file is too large to import."). Each person can check 10 files an hour. A template with no rows at all says "The file has no rows to import." (added by judgement). Every check is saved as an import record (the file itself is kept only when it is valid).
- Every cell is read the way the spec says (real Excel dates or YYYY-MM-DD text, money as numbers or "2,150.00", percentages as plain numbers, Yes/No, and the names shown in the dropdowns) and each row is checked with the same rules and messages as the normal forms. Missing sheets or columns are reported too.
- AC-IMP-02 and AC-IMP-06 pass. verify.sh passes. The reviewer approved. QA found and I fixed: keyboard focus was lost after **Check file** and **Cancel**; an empty template looked "ready".
- Not yet (T095/T096): links between sheets (unknown keys, duplicates), checks against existing data (e.g. a property name that already exists), the lease rules that depend on the unit (e.g. "Children reside in unit" for residential), responsible-landlord emails, and the **Import** button itself. Until then "Ready to import" only means every row is well formed, and there is no Import button yet.
- Left as is: the 50 MB unpacked-size check trusts the sizes the file declares about itself; the 10-an-hour limit counts rejected files too and resets if the server restarts.
- Nothing for the owner to do.

### 2026-10-16 — T095: Import file check (part 2)
- **Check file** now also checks how the sheets fit together. A Properties row with an unknown Owner key, a Units row with an unknown Property key or Owner override key, and a Leases row with an unknown Unit key or Tenant key each get a problem naming the sheet, row and column, e.g. "No property with key 'X' in the Properties sheet." A key used twice in one sheet, the same tenant listed twice on one lease, a repeated unit label within one property, and a property name that already exists (or appears twice in the file) are also listed ("A property with this name already exists.").
- Responsible landlord emails must belong to active Admin or Landlord users ("Choose only active Admin or Landlord users."); the Smoke user doesn't count.
- Lease rules now depend on the unit's use, with the same messages as the lease form: a residential lease needs "Children reside in unit", a commercial one can't have it, tax terms are commercial only, a move-out date needs a reason, the end date must be after the start, and two leases on one unit can't overlap ("This unit already has a lease for those dates."). A commercial lease with a Base tax year is refused because the import can't create tax years.
- AC-IMP-04, 05, 07 and 08 pass. verify.sh passes. The reviewer approved. No screens changed, so no QA pass.
- Not yet (T096): the **Import** button itself and re-checking at import time. These cross-sheet checks are skipped while a sheet or column is missing, so the template problems show first.
- Nothing for the owner to do.

### 2026-10-16 — T049: Extensions API
- Behind the scenes, a lease can now be extended: adding an extension needs only an end date and a monthly rent. The start date, tenants and every other term (deposit, due day, late fee, pets, parking, tax, special terms) are copied from the previous term unless given. An extension must start on or after the day after the previous end ("Extension must start on or after Nov 1, 2027."), keeps at least one tenant from the original lease (with the spec's message), and can't be added to an ended lease or one with a move-out date, or clash with another lease on the unit. Adding one turns Month-to-month off. The latest extension can be edited or deleted; older ones are refused. Every change saves a new lease version and an activity-log entry.
- verify.sh passes (108 acceptance tests). The reviewer approved. No screens changed, so no QA pass. The screens for extensions come with later tasks.
- Left as is: deleting an extension doesn't require a version number (same as deleting a lease), but checks it if one is sent.
- Nothing for the owner to do.

### 2026-10-16 — T055: Edit lease and Versions
- A lease page now has an **Edit lease** button (hidden for the read-only Smoke user). It opens `/leases/:id/edit` with the tenants, term and rent, and special terms all on one page, filled in with the lease's values, and **Save lease** (plus **Cancel**). Saving checks every lease rule again and creates a new version. If someone else saved first, the page says "Someone else changed this record. Reload to see the latest version." with a **Reload** button.
- The lease page also has a **Versions** table (Version, Changed on, Changed by, Summary, newest first); each row opens a read-only view of that version at `/leases/:id/versions/:n`, so Version 1 keeps showing the old rent after a change.
- AC-LEASE-16 and AC-LEASE-21 pass. verify.sh passes (110 acceptance tests). The reviewer approved. QA found and I fixed: a huge version number in the address gave an error page instead of "Version not found."
- Left as is: tenants can't be created from the Edit page (only existing tenants can be added or removed, since the edit API takes no new tenants); the version view heading doesn't name the property or unit; the tenant table's Remove / Primary contact controls don't include the tenant's name for screen readers (same as the New lease wizard); the late-fee amount has no upper limit beyond the wizard's (also the same as the wizard); a rent-increase change in the version summary shows the codes "none → schedule"; after Reload keyboard focus starts at the top of the page.
- Nothing for the owner to do.
- T055 process note: the first T055 commit (0cb3c41) was pushed after a verify run that had failed on AC-AUTH-07 (an invitation email arrived too late during test set-up; the test passed in the other full runs, so it looks like a flaky timing problem, not a lease problem). Verify was then re-run on the same code and passed, and CI for 0cb3c41 passed. This follow-up entry was committed only after a green verify and a review.

### 2026-10-16 — T056: Lease actions (month-to-month, end, delete)
- A lease page now has three more buttons for people who can edit (not the read-only Smoke user). **Mark month-to-month** (only for Active or Needs decision leases that aren't already month-to-month) asks "Mark this lease month-to-month after {end date}?" with **Month-to-month monthly rent** filled in with the last rent. **End lease** (hidden for Ended and Upcoming leases) asks for **Move-out date** and **Reason**; any valid date is accepted, even one before the lease start. **Delete lease** asks "Delete this lease, its extensions and all generated PDFs? This cannot be undone." and then returns to the unit page.
- AC-LEASE-12 and AC-LEASE-23 pass. verify.sh passes (112 acceptance tests). The reviewer approved. QA found and I fixed: a blank month-to-month rent was silently replaced by the last rent (now an error); a date in year 0000 sent through the API gave a server error (now "Enter a valid date."); after closing a dialog, keyboard focus went to the first button instead of the one that opened it.
- Left as is: after ending a lease with a move-out date before its start, the lease page doesn't show the move-out date or reason (the spec doesn't list them there); deleting a lease that was already deleted in another tab just goes to the unit page; Firefox and WebKit weren't checked by hand.
- Nothing for the owner to do.

### 2026-10-16 — T057: Replace current lease in the wizard
- When a new lease clashes with the unit's current lease and starts after it, the New lease wizard shows the overlap message and a **Replace current lease** button (not when the clash is with an upcoming lease, several leases, or the new start is not later). The button asks "End the current lease on {day before new start} and start this one?" with a **Reason** (default "Replaced by new lease"). Confirming doesn't save yet: the Review step shows "Saving will end the current lease on … (reason)." and **Save lease** then saves the new lease and ends the old one in one step. Changing the tenants or dates clears the choice.
- Older leases entered without a move-out date and the overlap error with no Replace option already worked from earlier tasks (the older-lease acceptance test AC-LEASE-20 is for T078).
- AC-LEASE-09 and AC-LEASE-19 pass. verify.sh passes (114 acceptance tests). The reviewer approved. QA found and I fixed: the old overlap error stayed on screen after confirming; keyboard focus was lost after confirming (now goes to Save lease).
- Left as is: if a replace save is refused again as an overlap, the Replace button stays hidden until the dates change. Firefox and WebKit weren't checked by hand.
- Nothing for the owner to do.

### 2026-10-17 — T058: Leases list
- The **Leases** page (`/leases`) now lists leases with the columns Property, Unit, Tenants, Start, Effective end, Current rent and Status (an archived lease shows " · Archived"). Filters: a **Status** group of checkboxes (Upcoming, Active, Month-to-month, Needs decision, Ended; all checked except Ended), **Show archived** (off by default) and **Property**. Checking **Ended** also brings back leases that ended because a later lease replaced them. Property links to the lease, Unit to the unit page. Unchecking every status shows "No leases match these filters."
- AC-LEASE-18 passes. verify.sh passes (115 acceptance tests). The reviewer approved. QA found and I fixed: very long property names pushed the other columns off screen; screen readers weren't told when the list changed (now "N leases shown."); every Property link had the same spoken name (now includes the unit); the filters are now kept in the web address (`?status=…&archived=1&property=…&page=2`) so Back from a lease, Reload and shared links keep them; the list is ordered by property, then unit (numbers in natural order), then newest start; every checkbox in the app is now 24 px (it was 13 px, and the later accessibility test would have failed on it); a page number past the end moves to the last page and a made-up property in the address is ignored.
- Left as is: Back after changing a filter leaves the page (filter changes replace the history entry); property names sort alphabetically, so "10 Main St" comes before "2 Main St"; with a very long property name on a 320 px phone the Property column is narrow; the columns aren't clickable for sorting; Show archived adds archived leases to the others; Firefox and WebKit weren't checked by hand. The acceptance suite has an occasional one-off failure on a test that moves the clock (a "Sign in" page appears; it hit AC-LEASE-19 in CI and AC-LEASE-06 locally); it passes on re-run and is not related to this task.
- Nothing for the owner to do.

### 2026-10-17 — T059: Tenant detail Leases table
- A tenant's page now lists every lease they are on (archived ones too) in the **Leases** table: Property, Unit (a link to the lease), Start, End, Status and **Primary contact** (Yes where they are the lease's primary contact, otherwise No). A tenant on no lease sees "This tenant is not on any lease."
- **Delete tenant** was already greyed out (with the reason) for a tenant on any lease, and **Archive tenant** / **Restore tenant** already worked; AC-TEN-04 and AC-TEN-05 pass. verify.sh passes. The reviewer approved. QA found and I fixed: double-clicking Archive or Restore showed a false "changed by someone else" error (the button now ignores a second click while it works); a very long property name squeezed out the other columns on a phone (now wraps).
- Left as is: a tenant who is only on a later extension (not the lease's current term) shows "No" for Primary contact; the page shows up to 200 leases with no paging; Firefox and WebKit weren't checked by hand. Also fixed after QA: archiving or restoring a tenant now requires the version number (a request without one is refused with a 422), and the Property column wraps long names. Every wide table (in the whole app) now shows a soft shadow on a clipped edge so a phone user can tell it scrolls sideways; QA confirmed it on a 320 px screen. QA also saw text highlighted after a double-click in one browser; it did not reproduce in Chromium, so the Archive, Restore and other action buttons simply don't allow text selection now. The Property cell also links to the property.
- Nothing for the owner to do.

### 2026-10-17 — T060: Add / Edit extension and the Extensions table
- A lease page now has an **Extensions** table (Start, End, Tenants, Monthly rent, Notes). Only the latest extension has **Edit** and **Delete**; Delete asks "Delete this extension? This cannot be undone." (my wording; the spec gives none). The **Add extension** button is hidden on Ended leases, on leases with a move-out date, and for the read-only Smoke user.
- **Add extension** (`/leases/:id/extensions/new`) and **Edit** (`/extensions/:id/edit`) have **Extension start date** (filled in as the day after the effective end), **Extension end date**, **Monthly rent**, **Rent increases** (None, percentage, custom schedule), **Notes**, **Save extension** and **Cancel**. Tenants, deposit, due day, late fee, parking and special terms are copied from the previous term by the server. A start date that is too early shows "Extension must start on or after …". Adding to a month-to-month lease makes it Active again.
- AC-EXT-01 to 06 and AC-LEASE-22 pass. verify.sh passes. The reviewer approved. QA found and I fixed: opening Edit for an older (not latest) extension by its web address looked editable and only failed on Save (now says "Only the latest extension can be edited.").
- Not yet (T061 / T090): the Tenants section, the collapsed "Change other terms (optional)" section, **Extension template** and **Save and generate PDF** on this form.
- Also fixed after QA: Edit and Delete now sit under the start date, so they show on a 320 px phone without scrolling sideways; a lease version of 0 sent to the extension API now says "version must be a positive whole number". Firefox and WebKit weren't checked by hand.
- Nothing for the owner to do.
