# RentNerd — build progress

A plain-language log of the autonomous build, newest first. Each session adds one dated entry
for the task it worked on: what changed, whether verify passed, and anything the owner needs to
know or do. The task list and statuses live in `docs/tasks.json`.

## Blocked

None.

## Disputed tests

**2026-10-13** — Owner approved fix to tests/acceptance/helpers/mailpit.ts (sort by Mailpit receive time); T021 and T025 reopened.

## Log

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
- AC-UNIT-01, AC-UNIT-02 and AC-UNIT-05 pass. The reviewer approved; QA found nothing blocking. Left alone: the property page is wider than a 320 px screen
  (from T035), focus isn't placed anywhere after "Reload" on a stale-edit message (shared form behaviour), and numbers typed with commas ("1,200") are refused.
  QA's note about the read-only Use text was fixed (the hint is now linked to it for screen readers).
- One email test (fail-next-email) failed once in the first verify.sh run and passed on re-run and alone; it's a timing flake unrelated to this task.
- verify.sh passes. Nothing for the owner to do.
