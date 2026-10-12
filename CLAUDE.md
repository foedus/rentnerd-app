# RentNerd — instructions for every session

RentNerd is a private web app for a small group of landlords. **SPEC.md is the source of truth**
(product, data model, screens, acceptance criteria §13, API §14, operations §15). The owner is
non-technical: write plain-language notes in PROGRESS.md, and never ask them to read code.

## Stack and platform (SPEC.md §4, D-01..D-34)
- TypeScript everywhere. One npm package: React + Vite client, Hono API that also serves the SPA,
  pg-boss worker, shared code. Postgres via Drizzle ORM. Better Auth (email/password).
- React Router, TanStack Query, React Hook Form + Zod (schemas shared with the API),
  React Aria Components, Tailwind CSS, TipTap for templates, exceljs for import.
- PDFs: HTML rendered by Playwright Chromium in the worker, stored in S3 (Tigris in production,
  MinIO locally), downloaded through 5-minute signed URLs. Email: Nodemailer SMTP (Mailpit locally).
- Tests: Vitest (unit, integration) and Playwright (acceptance). Docker Compose locally.
- Fly.io app `rentnerd-app`, region `sjc`, https://rentnerd-app.fly.dev. One Docker image, process
  groups `web` (`node dist/server.js`) and `worker` (`node dist/worker.js`), release command
  `node dist/migrate.js`, one machine each. GitHub Actions deploys when main is green.

## Repo layout
```
SPEC.md                 product spec (read-only for build sessions)
CLAUDE.md               this file          PROGRESS.md   session log, blocked work, disputes
docs/tasks.json         ordered task plan  docs/RESTORE.md, docs/RUNBOOK.md (later tasks)
src/client/             React app (routes, pages, components)
src/server/             Hono app, routes under /api, auth, startup seeding, test routes
src/worker/             pg-boss consumers and schedules (email, pdf, digest, backup, cleanup)
src/shared/             Zod schemas, pure calculations (D-32), formatting, placeholder registry
src/cli/                dist/cli.js commands (resend-admin-invite, restore-backup)
src/db/                 Drizzle schema and migrations
tests/acceptance/       LOCKED Playwright acceptance suite (own package.json, test.env, COVERAGE.md)
scripts/verify.sh       the gate; scripts/smoke-prod.sh  production smoke test
scripts/guard.sh        LOCKED edit guard hook;  scripts/run-loop.sh  LOCKED (owner's run loop)
.claude/agents/         reviewer.md, qa.md subagents;  prompts/  LOCKED (owner's prompts)
```
Unit tests sit next to the code as `*.test.ts`; integration tests as `*.int.test.ts`.

## Commands
| What | Command |
|---|---|
| Start services | `docker compose up -d --wait` (Postgres 5432, Mailpit 1025/8025, MinIO 9000) |
| Dev servers | `npm run dev` (Vite + API + worker, reads `.env.local`; never the real `.env`) |
| Build | `npm run build` → `dist/server.js`, `dist/worker.js`, `dist/migrate.js`, `dist/cli.js`, SPA |
| Lint / types | `npm run lint`, `npm run typecheck` |
| Unit tests | `npm run test:unit` |
| Integration tests | `npm run test:integration` (needs Compose services) |
| New migration | `npm run db:generate` (drizzle-kit), commit the SQL in `src/db/migrations/` |
| Apply migrations | `npm run build && node dist/migrate.js` (production: Fly `release_command`) |
| Acceptance (one AC) | `npm run build && cd tests/acceptance && npx playwright test --grep "AC-OWN-01 "` |
| Verify (gate) | `CURRENT_TASK=T0xx ./scripts/verify.sh`; everything: `VERIFY_ALL=1 ./scripts/verify.sh` |
| Deploy | `git push origin main` — the GitHub Actions workflow verifies, deploys and smoke-tests |
| Production smoke | `./scripts/smoke-prod.sh` (read-only, as the smoke user) |
| Production debugging | `fly logs -a rentnerd-app`, `fly status -a rentnerd-app` (nothing else) |

The npm script names above are a contract with `scripts/verify.sh`; keep them. Vitest must accept
`--allowOnly=false --reporter=json --outputFile.json=<file>` passed through `npm run test:unit --`.
For production debugging, FLY_API_TOKEN in the environment allows `fly logs` and `fly status`
for rentnerd-app only. Don't try other fly commands, other apps, or reading secrets.

## Rules (non-negotiable)
1. **One task per session.** Take the first task in `docs/tasks.json` whose status is "todo" and
   whose `depends_on` are all "done". Do only that task, then stop.
2. **Never edit** `tests/acceptance/`, `scripts/guard.sh`, `scripts/run-loop.sh`, `prompts/` or
   `.claude/`. Never edit SPEC.md (except Appendix D, and only as an adjudicator).
3. **Never weaken, skip or delete a test to make something pass.** No `.only`, `.skip`, `.todo`,
   `.fixme`, loosened assertions or deleted cases. Fix the app instead.
4. **Every change ships with unit and/or integration tests** for the behaviour it adds or fixes.
5. **Run `./scripts/verify.sh` before every commit** (with `CURRENT_TASK` set). It must pass.
   Never change verify.sh or smoke-prod.sh to check less; fix them only if genuinely broken,
   and say so in PROGRESS.md.
6. **Commit and push directly to main.** No branches, no pull requests, no force pushes.
7. **If genuinely blocked**: set the task's status to "blocked" in docs/tasks.json, add the reason
   and what the owner must do to PROGRESS.md under "Blocked", commit, push and stop.
8. Never commit secrets. `.env` holds production values for scripts only; don't print it.
9. Never run destructive commands against production (no deletes, no database writes).

## Session workflow
1. Read PROGRESS.md (latest entries, Blocked, Disputed tests) and the task in docs/tasks.json.
2. Read the SPEC.md sections behind the task and its acceptance criteria; read the matching
   tests in tests/acceptance/ (see COVERAGE.md) to see exactly what they check.
3. Implement in small steps with unit/integration tests. Keep the diff under ~250 lines; if the
   task is clearly bigger, finish a coherent part, note the rest in PROGRESS.md and keep the
   task "todo" (never mark a task done with failing criteria).
4. `CURRENT_TASK=T0xx ./scripts/verify.sh` until green.
5. Ask the `reviewer` subagent to review the diff; fix every blocking finding and re-run verify.
   Use the `qa` subagent for UI-heavy tasks when time allows.
6. Set the task to "done", add a dated PROGRESS.md entry (what changed, in plain words, and
   anything the owner should know), commit with a clear message, push, and stop.

## Harness contract with the locked tests (see tests/acceptance/COVERAGE.md)
- Tests start the app themselves (§15.5): `node dist/server.js` on :8080, `node dist/worker.js`,
  `node dist/cli.js`, with `tests/acceptance/test.env`. verify.sh runs the same commands inside the
  image `rentnerd-app:local` with `docker run --network host`, so the image's WORKDIR must contain
  `dist/` and `node_modules`, and must include `postgresql-client` (and Chromium once PDFs exist).
- docker-compose.yml: services `postgres` (user/password `rentnerd`, databases `rentnerd` and
  `rentnerd_test`), `mailpit`, `minio` (`minio`/`minio12345`, bucket `rentnerd-test` created by
  an init container). The official `minio/minio` image is no longer published: use the
  community build `pgsty/minio` (pin a version).
- Test routes (only when D-25 allows) need no session: `POST /api/test/clock {"now": iso|null}`,
  `/api/test/reset`, `/api/test/jobs/{daily-digest,backup,cleanup}`, `/api/test/fail-next-pdf`,
  `/api/test/fail-next-email`. Reset empties all app data; tests then restart the processes.
- The test clock moves every Date in web, worker **and cli**. Exceptions: S3 request signing uses
  real time. Session cookies use `Max-Age` (not only `Expires`).
- API bodies use §6 field names; money fields end in `Cents`; enums are the §6 backtick codes or
  else the label text; lease tenants `[{tenantId, isPrimary}]`; rent steps
  `[{effectiveDate, amountCents}]`; actions accept `version`; omitted extension terms copy the
  previous term. Single records are returned unwrapped; lists are `{data, page, pageSize, total}`.
- Find-by-role: every control has the exact §11 label; required fields add "(required)"; tables
  named in §11 carry that accessible name; the Dashboard Portfolio summary is a `<dl>`.
- If a locked test contradicts the spec: record the test, failure output and reasoning in
  PROGRESS.md under "Disputed tests", mark the task "blocked", commit, push and stop (§15.5).

## Coding conventions
- Strict TypeScript, no `any` in app code, ESLint clean. Small modules, named exports.
- All derived values (status, rent, occupancy, compliance, thresholds) are pure functions in
  `src/shared` with unit tests (D-32); never re-implement them in the client or SQL.
- Money is integer cents; dates are `YYYY-MM-DD` strings; "today" is America/New_York via the
  app clock helper, never `new Date()` directly in business logic.
- Validate every request with the shared Zod schema; errors use the §14.1 envelope.
- Authorize on the server for every route: session required, Admin-only routes 403 to others,
  every write by the smoke user 403, Origin check on POST/PATCH/PUT/DELETE.
- Every change to business data writes an audit row in the same transaction (D-27) and bumps
  `version` (409 on mismatch, D-10). Lease changes write a LeaseRevision (D-31).
- Use parameterised Drizzle queries only; no string-built SQL. Sanitise template HTML.
- UI copy, labels and messages exactly as written in SPEC.md, including curly quotes and "–".
- Accessibility first: React Aria widgets, visible 2 px focus rings, 24 px targets, live regions.
- Commit messages: imperative summary naming the task, e.g. "T031: Properties list screen".
