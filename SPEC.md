# RentNerd — Product Specification

Version 1.4 · 2026-10-12 (owner review decisions applied; see Appendix C)

---

## 1. Purpose

RentNerd is a private, free web application for a small, known group of landlords who jointly manage a portfolio of small properties (mostly New York City buildings of 1–4 units, plus standalone residential and commercial units, some outside NYC). It lets them:

1. Keep one shared record of owners, properties, units, current rent, lease dates, special lease terms, tenants and tenant contact details.
2. Generate printable master leases and short lease extensions as PDFs from their own templates, to be printed and signed offline.
3. Track recurring compliance obligations (NYC defaults, switchable off per property) and lease endings, with a daily summary email to the landlord(s) responsible for each property.
4. See basic portfolio statistics: occupancy, rent roll, other income, real-estate value and gross yield.
5. Keep a log of renovation and appliance investments.

It is not a commercial product and is not intended to scale beyond a few dozen users.

## 2. Users and roles

| Role | How created | Count | Privileges |
|---|---|---|---|
| **Admin** | Created automatically at startup from the `ADMIN_EMAIL` Fly secret (the owner's email), see §15.3 | Exactly 1, permanent | Everything a Landlord can do, **plus** invite landlords, resend and revoke invitations, deactivate/reactivate landlords, view the Activity log. Cannot be deactivated. |
| **Landlord** | Invited by the Admin | Any number (expected ≤ 20) | Full create/read/update/delete/archive access to **all** business data (owners, properties, units, tenants, leases, extensions, documents, templates, compliance, investments, import). No access to user management or Activity log. |
| **Smoke (read-only)** | Created/updated at startup from `SMOKE_USER_EMAIL` / `SMOKE_USER_PASSWORD` | At most 1 (exactly 1 in production) | Can sign in and **read** the same screens as a Landlord. Every create/update/delete/archive/generate/import request returns 403. Never offered as a responsible landlord; never receives reminder emails. |

- There is no public sign-up, no tenant login, and no per-property permission. All landlords see all data. (Accepted by the owner for now; see Appendix C, #50.)
- The smoke user has *fewer* privileges than a Landlord, which satisfies §4's "no special privileges". Its sign-ins and sign-outs are not written to the Activity log (§6.16), so the log holds only real users' activity.
- "Signed-in user" below means any active Admin, Landlord or Smoke user. "Editor" means an active Admin or Landlord.

## 3. Glossary

- **Property**: an address with an owner. Either a building with several units, or a single-unit property (a standalone house, condo or store).
- **Unit**: a rentable space within a property. Each unit is **Residential** or **Commercial**. A property's type is derived from its units: *Residential*, *Commercial* or *Mixed*.
- **Owner**: the legal entity (LLC, trust, individual, etc.) named as landlord on leases.
- **Responsible landlords**: the one or more editors assigned to a property. Each receives its reminder emails.
- **Lease**: the master lease for a unit, with one or more tenants and a term.
- **Extension**: a later term added to a lease, with new dates and rent, and optionally changed tenants, other-income terms and special terms (§6.10). A lease can have many extensions in sequence.
- **Current term**: the term containing today; if today is after the effective end, the latest term; if today is before the start, the master term. The current term's tenants, other-income fields and special terms are the lease's "current" values.
- **Term**: either the master lease's period or one extension's period.
- **Effective end date**: the end date of the latest extension, or the lease end date if there are no extensions.
- **Rent roll**: the sum of the current monthly rents of occupied units.
- **Other income**: parking charges plus commercial tax reimbursements.

## 4. Platform (fixed technical context — verbatim)

- Stack: TypeScript; React + Vite front end; Hono API; one Docker image running a web process and a worker process; Postgres via Drizzle ORM; Better Auth (email/password, email verification, password reset); pg-boss job queue for emails and PDFs; PDFs rendered from HTML with Playwright/Chromium in the worker, stored in S3-compatible storage (Tigris), served via short-lived signed URLs; email via Nodemailer SMTP (Mailpit locally); Vitest and Playwright for tests; Docker Compose locally for Postgres, Mailpit and MinIO; GitHub Actions deploys to Fly.io when main is green.
- Hosting: Fly.io app "rentnerd-app", region sjc, URL https://rentnerd-app.fly.dev. Production secrets already set: DATABASE_URL, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_ENDPOINT_URL_S3, AWS_REGION, BUCKET_NAME, SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM, AUTH_SECRET, SMOKE_USER_EMAIL, SMOKE_USER_PASSWORD.
- Email is sent from mail.rentnerd.xyz.
- On startup the app must create, if absent, an email-verified standard user from SMOKE_USER_EMAIL / SMOKE_USER_PASSWORD so automated smoke tests can log in to production. This user gets no special privileges.

## 5. Decisions

Technical and product decisions made on the owner's behalf, with reasoning.

| # | Decision | Reasoning |
|---|---|---|
| D-01 | **Single npm package** with `src/client` (React), `src/server` (Hono API + static SPA hosting), `src/worker` (pg-boss consumers and schedules), `src/shared` (Zod schemas, calculations, types). Hono serves the built SPA and `/api/*` from the same origin. | One Docker image and two processes are required. One package is the simplest fit, and a single origin avoids CORS and keeps cookies simple. |
| D-02 | Fly `processes`: `web` (`node dist/server.js`) and `worker` (`node dist/worker.js`). Migrations run as the Fly `release_command` (`node dist/migrate.js`). | Migrations run once per deploy, before new machines start. |
| D-03 | Front-end libraries: React Router, TanStack Query, React Hook Form + Zod (schemas shared with the API), **React Aria Components** for interactive widgets, Tailwind CSS, TipTap (ProseMirror) for the template editor. | React Aria provides WCAG-conformant keyboard and screen-reader behaviour out of the box. Sharing Zod schemas guarantees identical validation in the browser and on the server. TipTap is a mature, accessible-enough rich-text editor that handles pasted Word content. |
| D-04 | **Money stored as integer cents**, percentages as `numeric(7,4)`, calendar dates as Postgres `date`, timestamps as `timestamptz` (UTC). All "today" logic uses the **America/New_York** time zone. | Avoids floating-point errors. Most properties are in NYC. |
| D-05 | The Admin is created **automatically at startup** from the `ADMIN_EMAIL` **Fly secret** (set to the owner's email; it is deliberately not written in the repository, including this spec). If no admin exists, the web process creates the user (role `admin`, status `invited`, unverified) and sends the invitation email (§10.1) once. If an admin already exists, `ADMIN_EMAIL` is ignored (a warning is logged if it differs). If the admin's invitation expires before it is accepted, `node dist/cli.js resend-admin-invite` (run via `fly ssh console`) sends a new one. | The owner asked for a fixed admin, kept as a secret so their email isn't stored in the repository. The app can never be left without a way to finish admin setup. |
| D-06 | "Removing" a landlord means **deactivating** them (no hard delete). Their sessions are revoked immediately and they are removed from every property's responsible landlords; any property left with none is assigned to the Admin. They can be reactivated (responsibilities are not restored automatically). | Audit history must keep referring to the person. Reassignment ensures reminders keep flowing. |
| D-07 | Invitations: inviting creates the **user row immediately** (status `invited`, `emailVerified` false, no password) plus a single-use link valid 7 days. Accepting sets the password, marks the email **verified** and sets status `active`. Better Auth `requireEmailVerification` stays on. Because invited users have no password and every other account is created verified, there is no separate verification-email flow: an invited user who tries to sign in gets the normal "Incorrect email or password." | Satisfies the fixed requirement for email verification without a redundant second email. The Admin sees invitees in the Users list. |
| D-08 | Sessions: Better Auth database sessions in an HttpOnly, Secure, SameSite=Lax cookie. Lifetime 7 days, extended on use (refreshed at most once per day). Password 12–128 characters. Sign-in is rate-limited to **5 failures per 15 minutes per email** (from any IP), plus 30 failures per 15 minutes per IP across all emails. Other limits are in §16 (Security). | Per email, as the owner chose. The per-IP limit slows guessing across many accounts. |
| D-09 | **Archive instead of delete** for owners, properties, units, tenants, templates and compliance item types once they are referenced elsewhere. A template counts as referenced once any generated PDF used it, so it stays available to regenerate that document. Hard delete is allowed only for unreferenced records, and for leases, extensions, generated PDFs and investment entries (with confirmation). | Keeps lease history intact, as the owner asked. Lets mistakes still be removed. |
| D-10 | **Optimistic concurrency**: every editable record has a `version` integer. Updates must send it; a mismatch returns `409 CONFLICT`. A lease's tenants, rent steps and extensions share the lease's version (the lease is one unit of editing). | Several landlords edit the same shared data, and silent overwrites would lose work. |
| D-11 | Current rent is **calculated, not stored**: the rent in effect on a date is derived from the term's base rent and its increase rule. It therefore "updates automatically" on each anniversary or scheduled date, with no job needed. | No risk of a missed job leaving the wrong rent. |
| D-12 | Percentage increases compound annually on each anniversary of the **term's** start date. Each year's rent = previous year's rent × (1 + %), rounded to the nearest cent (half up). For a 29 February start, the anniversary is 28 February in non-leap years. | The standard interpretation of "x% per year." |
| D-13 | Commercial tax reimbursement (monthly) = tenant share % × max(0, property tax for the **latest tax year entered** − property tax for the lease's **base tax year**) ÷ 12, rounded to the cent. Tax years are entered per property as a year number plus an annual amount. | Implements "percentage of increase over base year" from data the landlord already has. |
| D-14 | Lease statuses are derived from dates (§7.4). Whenever a lease's effective end date (master or latest extension) passes without the lease having been extended, marked month-to-month, given a move-out date or followed by a later lease on the unit, it becomes **Needs decision**. The landlord resolves it with *Add extension*, *Mark month-to-month* or *End lease*. Until then the unit counts as occupied at the last known rent. | The owner chose "flag for decision." |
| D-15 | Value basis for yield and portfolio value: the latest **Market estimate**, falling back to **Purchase price**. Assessed values are recorded with full history but not used in yield. | NYC assessed values are far below market value and would inflate yields. |
| D-16 | Potential rent of a vacant unit = the **last rent** (§7.2) of its most recent non-archived lease. Units never leased have no potential rent. | The owner said "use last rent as potential rent." |
| D-17 | Templates are rich text built in the in-app editor, stored as TipTap JSON, with **placeholders** as non-editable chips. Text pasted with `{{placeholder_key}}` tokens converts to chips automatically. PDFs render from HTML with a fixed print stylesheet. | Lets the landlord prepare Word files offline by typing `{{keys}}`, then paste them in. The owner accepted no pixel-exact Word fidelity. |
| D-18 | Each generated PDF stores a **snapshot** (the rendered HTML and the data used), taken by the web process **when the PDF is requested**, together with the lease version number it was made from. Later edits to a template or lease don't change existing PDFs. PDFs are kept until a landlord deletes them; deletion also removes the stored file. | The owner wants to review past leases later. |
| D-19 | PDF generation is asynchronous via pg-boss. The browser polls the document's status every 2 seconds. Jobs retry 3 times with backoff before the status becomes **Failed**. **Try again** re-renders the same stored snapshot (it does not pick up newer data; use **Generate PDF** for that). | Chromium rendering belongs in the worker, per the platform requirements. Retrying the snapshot means a retry can never silently produce a different document. |
| D-20 | Signed download URLs expire after **5 minutes** and are created on demand for each click. Template previews are stored under `previews/` and deleted after 24 hours. | "Short-lived signed URLs." |
| D-21 | Reminder emails are **one daily digest per responsible landlord**, sent at 08:00 America/New_York by a pg-boss cron schedule. No email is sent if there is nothing to report. A `reminder_log` table makes the job idempotent, and a missed day is caught up on the next run (§10.5). | The owner's choice. Idempotency prevents duplicate emails after retries or redeploys; catch-up means a missed day is never lost. |
| D-22 | Spreadsheet import is **in-app**: download an `.xlsx` template, fill it in, upload it, see a validation report, then commit all-or-nothing in one transaction. Import only creates new records. Uses the `exceljs` library. | The owner prefers spreadsheet import. All-or-nothing avoids half-imported portfolios. |
| D-23 | The compliance catalog is seeded with NYC defaults (§9.1). Each property has a **Located in New York City** flag. Items apply automatically by location and unit use, and can be switched off per property. Seeded dates are starting points that the landlords must verify. The app gives no legal advice. | NYC is the common case, but not every property is in NYC. |
| D-24 | **Production smoke tests are read-only**: sign in as the smoke user, load the dashboard and the properties list, sign out. They never create data, and the smoke role cannot write (§2). The smoke user's sign-in and sign-out are not written to the Activity log. If the smoke test fails after a deploy, the workflow redeploys the previous release image and fails the run. | All landlords see all data, so test records would appear in the real portfolio. The Activity log is reserved for real users. |
| D-25 | **Test clock and test-only routes** (`/api/test/*`, §14.2). The server and worker only enable them when **all** of these hold: `ENABLE_TEST_ROUTES=true`, `NODE_ENV=test`, `FLY_APP_NAME` unset, and the database name in `DATABASE_URL` ends in `_test`. If `ENABLE_TEST_ROUTES=true` but any other condition fails, the process **refuses to start**. The test clock is an offset stored in the database and applied to the **whole process clock** (every `Date`, including Better Auth token and session expiry, invitation expiry and pg-boss scheduling decisions) in both web and worker, so time-based behaviour can be tested deterministically. | Lets Playwright check date-based behaviour deterministically. Several independent checks make it impossible to enable the reset route against real data by mistake (e.g. a local `.env` pointing at production). |
| D-26 | Backups: in addition to whatever the Postgres provider offers, the worker runs a nightly `pg_dump` (02:00 New York) to the bucket under `backups/`, keeping 30 days. The `pg_dump` major version must match the server's; the job checks this and fails loudly otherwise. A failed backup emails the Admin. The restore procedure is documented in `docs/RESTORE.md`, built around `node dist/cli.js restore-backup --latest --target-url <url>`, and exercised in CI (§15.4, AC-PLAT-10). The Docker image includes `postgresql-client`. | Guarantees an off-database copy whatever the hosting setup behind `DATABASE_URL`. Using the same bucket and keys as the app is an accepted risk for now (Appendix C, #55). |
| D-27 | Audit logging is application-level: an `audit_log` row is written in the same transaction as each change, with field-level before/after values. Changes to a lease's child rows (tenants, rent steps) are summarised on the lease row, e.g. "Tenants: Ann Lee, Bo Diaz → Ann Lee, Cy Park". Password hashes, tokens and session IDs are never written to the audit log. | Reliable, and readable by a non-technical admin. |
| D-28 | Email: each message is sent through a pg-boss job (5 retries, exponential backoff) and recorded in `email_log`. Every message has plain-text and simple HTML versions. | Reliable delivery and traceability. |
| D-29 | Health check: `GET /api/health` returns 200 `{"status":"ok"}` when the database is reachable, otherwise 503. Fly checks it every 15 seconds. | Standard for Fly deploys. |
| D-30 | English only, US dollars, US date format on screen ("Jan 5, 2027"). Native `<input type="date">` is used for date entry. | Users are US landlords. Native date inputs are the most accessible option. |
| D-31 | **Lease versions.** Every saved change to a lease (its fields, tenants, rent steps, extensions, month-to-month, ending) creates a new numbered **lease version**: a full read-only snapshot stored in `LeaseRevision`. The lease row always holds the latest version. Past versions can be viewed but not edited or deleted (they are deleted only if the whole lease is deleted). | The owner asked that any change after creation produce a new version, so nothing is silently overwritten. |
| D-32 | **One implementation of derived values.** Lease status, rent on a date, current term, compliance status, occupancy and reminder thresholds are pure functions in `src/shared`, used by the API, dashboard, emails and PDF data alike. List filters on derived values (e.g. lease status) are applied in application code after loading candidate rows; at the stated scale (§16) this is fast enough. | Guarantees the dashboard, lists, emails and PDFs never disagree. |
| D-33 | **Acceptance tests are written first, independently, and then fixed.** The Playwright acceptance tests that implement §13 are written by a **separate test-authoring step** before any app code exists, in its own session with its own context, working only from this spec (§15.5). They are reviewed by a second fresh session and committed; the run loop then tags them `acceptance-locked`. From then on they are locked in two ways: a PreToolUse guard hook (`scripts/guard.sh`) blocks any edit to them, and the run loop restores `tests/acceptance/` from the latest acceptance tag (`acceptance-locked`, or a later `acceptance-locked-N` after a dispute) before every iteration. There is no pull-request or branch-protection step; Claude pushes directly to main. Implementation must change the app, never the tests, to make them pass. Test-only routes may only move the clock, trigger scheduled jobs, reset the database and force the next PDF or email to fail. They must never bypass permission, validation or business rules. A test believed to be wrong goes through the dispute step in §15.5, never through the build session. | The owner wants an autonomous build whose tests can't be shaped by, weakened by or worked around by the app's developer. |
| D-34 | **Exactly one machine per process** on Fly (`fly scale count web=1 worker=1`): web `shared-cpu-1x` 512 MB, worker `shared-cpu-1x` 1 GB (Chromium). Startup seeding (admin, smoke user, compliance catalog) is nevertheless idempotent and safe to run twice at once (unique constraints and insert-if-absent), and pg-boss schedules are singletons. | Fly creates two machines per process by default; one is enough (§16), and idempotent seeding protects against accidental scale-up. |

## 6. Data model

All tables have `id` (UUID), `createdAt` and `updatedAt`. Editable business tables also have `version` (int) and `createdById`/`updatedById` (user). Tables marked "archivable" have `archivedAt` (nullable). "Editors" means active Admin or Landlord users; the read-only Smoke user can read everything an editor can, but change nothing (§2).

### 6.1 User (Better Auth `user`, extended)
| Field | Type | Notes |
|---|---|---|
| name | text, required | |
| email | text, unique, required | lower-cased |
| emailVerified | boolean | |
| role | enum `admin` \| `landlord` \| `smoke` | exactly one `admin`, at most one `smoke` |
| status | enum `invited` \| `active` \| `deactivated` | `invited` until the invitation is accepted |
| lastSignInAt | timestamptz, nullable | |

Better Auth's own `session`, `account` and `verification` tables are used unchanged.
**Permissions:** Create: Admin (via invitation); startup (admin from `ADMIN_EMAIL`, smoke user). Read: every signed-in user can see the name and email of active Admin/Landlord users (for the responsible-landlord picker, filters and contact), via `GET /api/people`. Only the Admin sees the Users screen with statuses. Update: each editor edits their own name and password; the Admin changes status. Delete: never.

### 6.2 Invitation
| Field | Type | Notes |
|---|---|---|
| userId | user | the invited user row (D-07) |
| tokenHash | text | SHA-256 of the token |
| invitedById | user, nullable | null for the startup/CLI admin invitation ("system") |
| expiresAt | timestamptz | created + 7 days |
| acceptedAt, revokedAt | timestamptz, nullable | |

At most one unaccepted, unrevoked invitation exists per user: **Resend** revokes the previous one and creates a new one. **Revoke** leaves the user in status `invited` with no valid invitation (shown as "Invitation revoked"); the Admin can **Resend** later. Inviting an email that belongs to any existing user (any status) shows "A user with this email already exists."; the Admin uses Resend (invited users) or Reactivate (deactivated users) instead.
**Permissions:** Admin only (create, revoke, resend). Expired or revoked rows are purged after 30 days (the user row stays).

### 6.3 Owner (archivable)
| Field | Label | Type | Rules |
|---|---|---|---|
| name | Owner name | text | required, ≤ 200 |
| ownerType | Owner type | enum LLC, Corporation, Partnership, Trust, Individual, Other | required |
| addressLine1 | Mailing address line 1 | text | required |
| addressLine2 | Mailing address line 2 | text | optional |
| city | City | text | required |
| state | State | 2-letter code | required |
| zip | ZIP code | text | required, 5 or 9 digits |
| email | Email | text | optional, valid email |
| phone | Phone | text | optional |
| signatoryName | Signatory name | text | optional (printed on leases) |
| signatoryTitle | Signatory title | text | optional, e.g. "Managing Member" |
| notes | Notes | text | optional |

**Permissions:** Editors have full CRUD. Delete only if not referenced by any property or unit (archived or not). Archive only if no **non-archived** property uses it as owner and no non-archived unit uses it as an override; otherwise archiving is refused with "Change the owner on these properties before archiving this owner:" followed by links to them. Archived owners are not offered in owner selects.

### 6.4 Property (archivable)
| Field | Label | Type | Rules |
|---|---|---|---|
| name | Property name | text | required, unique among non-archived properties, e.g. "412 Court St" |
| street | Street address | text | required |
| city | City | text | required |
| state | State | 2-letter | required |
| zip | ZIP code | text | required |
| inNyc | Located in New York City | boolean | default true |
| bbl | Borough-Block-Lot (BBL) | text | optional, 10 digits |
| yearBuilt | Year built | int | optional, 1700–current year |
| ownerId | Owner | owner | required |
| responsibleUserIds | Responsible landlords | users (join table `PropertyResponsible`) | at least one. Defaults to the creator. Each must be an active Admin or Landlord. |
| purchasePrice | Purchase price | cents | optional, ≥ 0 |
| purchaseDate | Purchase date | date | optional |
| notes | Notes | text | optional |

Derived: `propertyType` (Residential / Commercial / Mixed, from non-archived units; "—" if none), current value (D-15).
**Permissions:** Editors have full CRUD.
- **Archive** always archives the property **and all its units and leases** in one step (they share an `archiveBatchId`). If any lease is not Ended, the confirmation dialog warns: "This property has {n} current lease(s). Archiving it also archives all its units and leases, removes them from the dashboard and stops their reminders." Archived properties are hidden from lists, the dashboard, statistics and reminders. **Restore** restores the property and the units and leases archived in the same batch (not ones archived separately earlier).
- **Delete** only if no unit has ever had a lease and there are no investment entries; otherwise only archive. Deleting removes the property with its units, values, tax years and its compliance items and their completions, and so stops its reminders. Compliance **item types** are never affected by deleting a property.

### 6.5 PropertyValue (value history)
| Field | Label | Type | Rules |
|---|---|---|---|
| propertyId | | property | required |
| valueDate | Date | date | required |
| kind | Value type | enum `market_estimate` (label "Market estimate"), `assessed` (label "Assessed value") | required |
| amount | Amount | cents | required, > 0 |
| source | Source / notes | text | optional |

**Permissions:** Editors have full CRUD (hard delete).

### 6.6 PropertyTax
| Field | Label | Type | Rules |
|---|---|---|---|
| propertyId | | property | required |
| taxYear | Tax year | int | required, unique per property, 1990–2100 |
| amount | Annual property tax | cents | required, ≥ 0 |

For NYC, the landlord enters the fiscal year's start year (FY 2025/26 → 2025). The label is shown as entered.
**Permissions:** Editors have full CRUD. Cannot delete a tax year used as a lease's base tax year.

### 6.7 Unit (archivable)
| Field | Label | Type | Rules |
|---|---|---|---|
| propertyId | | property | required |
| label | Unit label | text | required, unique within property, e.g. "2R", "Store", "Entire property" |
| use | Use | enum Residential, Commercial | required. **Cannot be changed after the unit is created**; to change use, archive the unit and create a new one. |
| bedrooms | Bedrooms | int | optional, 0–20 |
| bathrooms | Bathrooms | numeric(3,1) | optional |
| squareFeet | Square feet | int | optional |
| ownerOverrideId | Owner (if different from property) | owner | optional |
| notes | Notes | text | optional |

Derived: occupancy status, current lease, current rent, potential rent.
**Permissions:** Editors have full CRUD (except `use`, above). Delete only if it has no leases or investment entries; otherwise archive. A unit with a current (not Ended) lease **can** be archived: the dialog warns "This unit has a current lease. Archiving the unit also archives the lease, removes it from the dashboard and stops its reminders.", and archives the unit and its leases together (one `archiveBatchId`). Restoring the unit restores that batch. A unit cannot be restored while its property is archived.

### 6.8 Tenant (archivable)
| Field | Label | Type | Rules |
|---|---|---|---|
| tenantType | Tenant type | enum Individual, Business | required |
| firstName / lastName | First name / Last name | text | required if Individual |
| businessName | Business name | text | required if Business |
| contactPerson | Contact person | text | required if Business |
| email | Email | text | optional, valid email |
| phone | Phone | text | optional |
| notes | Notes | text | optional |

Display name: "First Last" or "Business name (Contact person)".
**Permissions:** Editors have full CRUD. Delete only if not on any lease or extension; otherwise archive. A tenant on a current lease can be archived (it stays on that lease); archived tenants are not offered when adding tenants to a lease or extension.

### 6.9 Lease (archivable, versioned — D-31)
| Field | Label | Type | Rules |
|---|---|---|---|
| unitId | | unit | required |
| startDate | Lease start date | date | required |
| endDate | Lease end date | date | required, > start |
| baseRent | Monthly rent | cents | required, > 0 |
| increaseType | Rent increases | enum `none`, `percent`, `schedule` | default `none` |
| increasePercent | Annual increase (%) | numeric | required if `percent`; 0 < x ≤ 50 |
| securityDeposit | Security deposit | cents | optional |
| rentDueDay | Rent due day | int 1–28 | default 1 |
| lateFee | Late fee | cents | optional |
| lateFeeGraceDays | Late fee grace period (days) | int 0–31 | optional |
| pets | Pets | text | optional |
| parking | Parking | text | optional, e.g. "Space #4" |
| parkingCharge | Parking charge (monthly) | cents | optional |
| childrenReside | Children reside in unit | boolean | required for Residential units, null for Commercial |
| breakClause | Break clause | text | optional |
| otherTerms | Other special terms | text | optional |
| baseTaxYear | Base tax year | int | Commercial only, optional; must match a PropertyTax year |
| taxSharePercent | Tenant's share of tax increase (%) | numeric | Commercial only; required if baseTaxYear is set; 0 < x ≤ 100 |
| monthToMonth | | boolean | default false |
| monthToMonthRent | Month-to-month monthly rent | cents | optional. If null, the last term rent applies. |
| moveOutDate | Move-out date | date | nullable. Any valid date (it may be before, during or after the term). |
| endReason | Reason | enum Tenant moved out, Not renewed, Terminated, Tenant broke lease, Replaced by new lease, Other | required with moveOutDate |
| archivedAt, archiveBatchId | | | set only when its unit or property is archived (§6.4, §6.7); a lease is never archived on its own |

The fields from `securityDeposit` to `taxSharePercent` above are the master term's **terms**. Extensions may change any of them (§6.10).
**LeaseTenant** (join table): `leaseId`, `tenantId`, `isPrimary`. At least one tenant per lease, and exactly one primary.
**RentStep** (for `schedule` on a lease or extension): `effectiveDate`, `amount` (cents). Dates fall strictly within the term, strictly increase, and come after the term start.
**Occupied period** of a lease (for overlap checks): from `startDate` to the move-out date if set; otherwise to the effective end date, unless it is month-to-month, in which case it is open-ended.
**Overlap rule:** a lease's occupied period must not overlap the occupied period of any other non-archived lease on the same unit. Older (historical) leases can therefore be entered at any time, as long as their dates don't clash. On a clash the error is "This unit already has a lease for those dates.", and:
- If the clash is only with the unit's **current** lease (Active, Month-to-month or Needs decision) and the new lease starts after that lease's start date, the wizard offers **Replace current lease**: on confirmation ("End the current lease on {new start − 1 day} and start this one?", with a **Reason** select defaulting to "Replaced by new lease"), saving the new lease also sets the current lease's move-out date to the day before the new start, in the same transaction. This covers a tenant breaking a lease early.
- Otherwise the user must change the dates.
**Validation on every save** (create or edit): all of the above, plus the extension chain (each extension starts on or after the previous effective end + 1 day), every extension keeping at least one master-lease tenant (§6.10), and rent steps within their terms. A change that would break any of these is rejected with the specific error.
**Permissions:** Editors have full CRUD. Every change creates a new lease version (D-31). Deleting a lease also deletes its versions, extensions, rent steps and generated PDFs (and their stored files), after confirmation. **LeaseRevision**: `leaseId`, `versionNumber`, `snapshot` (JSON of the lease with its tenants, rent steps and extensions), `changedById`, `changedAt`, `summary`.

### 6.10 LeaseExtension
| Field | Label | Type | Rules |
|---|---|---|---|
| leaseId | | lease | required |
| startDate | Extension start date | date | required. Defaults to previous effective end + 1 day. Must be ≥ that date; any gap is month-to-month. |
| endDate | Extension end date | date | required, > start |
| baseRent | Monthly rent | cents | required, > 0 |
| increaseType / increasePercent / rent steps | | | same as Lease |
| tenants | Tenants | ExtensionTenant join (`extensionId`, `tenantId`, `isPrimary`) | required. Pre-filled with the previous term's tenants. Tenants may be removed and new ones added, but **at least one tenant from the master lease must remain**, and exactly one is primary. If every master-lease tenant would be removed, saving is refused with "At least one tenant from the original lease must stay. To change all tenants, end this lease and create a new lease." |
| rentDueDay, lateFee, lateFeeGraceDays, securityDeposit | | | same rules as Lease; pre-filled from the previous term |
| parking, parkingCharge, baseTaxYear, taxSharePercent | | | same rules as Lease (tax fields Commercial only); pre-filled from the previous term |
| pets, childrenReside, breakClause, otherTerms | | | same rules as Lease; pre-filled from the previous term |
| notes | Notes | text | optional |

**An extension can change any lease value that has a placeholder key (§8.1)**: the tenant keys (via its tenant list) and every rent, deposit, due-day, late-fee, pets, parking, children, break-clause, other-terms and tax key. Keys that don't come from the lease can't be changed by an extension: owner, property and unit keys come from those records, `today` is the generation date, `lease_start_date`/`lease_end_date` are the master lease's dates, and the extension's own dates and rent come from its date and rent fields. Most extensions only change the dates and rent, so every value is pre-filled from the previous term and only edited when needed.
Each extension stores a **full copy** of the terms above. During an extension, and after it if it is the latest term, the lease's current tenants, rent, other income and special terms are the extension's (see "Current term", §3). Earlier terms keep their own values.
Creating an extension sets the lease's `monthToMonth` to false. Only the **latest** extension can be edited or deleted. Extensions cannot be added to an ended lease or one with a move-out date.
**Permissions:** Editors have full CRUD (latest only). Each change creates a new lease version.

### 6.11 Template (archivable)
| Field | Label | Type | Rules |
|---|---|---|---|
| name | Template name | text | required, unique among non-archived |
| kind | Template type | enum `master_lease` ("Master lease"), `extension` ("Lease extension") | required, not changeable after first save |
| content | | TipTap JSON | required, non-empty. Contains only the allowed content (§8.4) and no unrecognised placeholders. |

**Permissions:** Editors have full CRUD. Delete only if no generated PDF has used the template; otherwise archive (D-09). An archived template is not offered for new documents, except that the **Generate PDF** dialog for a lease also lists archived templates previously used for that lease, marked "(archived)", so that document can be regenerated.

### 6.12 GeneratedDocument
| Field | Type | Notes |
|---|---|---|
| leaseId | lease | required |
| extensionId | extension, nullable | set for extension documents |
| kind | `master_lease` \| `extension` | |
| templateId | template | (templates used by a document can't be deleted) |
| templateName | text | snapshot |
| leaseVersion | int | the lease version the data came from (D-31) |
| fileName | text | e.g. `Lease - 412 Court St 2R - 2026-11-01.pdf` (§8.2) |
| storageKey | text | `documents/{leaseId}/{id}.pdf` |
| htmlSnapshot | text | the rendered HTML, built when requested (D-18) |
| sha256 | text, nullable | hash of the stored PDF, set when ready |
| status | `generating` \| `ready` \| `failed` | |
| errorMessage | text, nullable | |
| generatedById | user | |

**Permissions:** Editors can create and delete (hard delete, including the stored object); all signed-in users can read (download). Never updated, except status on (re)render.

### 6.13 ComplianceItemType (archivable)
| Field | Label | Type | Rules |
|---|---|---|---|
| name | Name | text | required, unique |
| description | Description | text | optional |
| appliesTo | Applies to | enum All properties, Properties with residential units, Properties with commercial units | required |
| nycOnly | New York City properties only | boolean | |
| scheduleType | Schedule | enum `annual_date` ("Same date every year"), `interval` ("Every N months after completion"), `one_time` ("One time") | required |
| dueMonth / dueDay | Month / Day | int | required for `annual_date`; a valid date (Feb 29 not allowed) |
| intervalMonths | Repeat every (months) | int 1–120 | required for `interval` |
| isSeeded | | boolean | |

**Permissions:** Editors have full CRUD. Delete only if no property item has a completion; otherwise archive. Deleting a type removes its (completion-free) items from every property's list; the properties themselves are unaffected. Archived types stop generating reminders and are hidden from property lists.

### 6.14 PropertyComplianceItem
| Field | Type | Notes |
|---|---|---|
| propertyId, typeId | | unique pair |
| applicable | boolean | "Applies to this property" |
| applicableSetByUser | boolean | true once an editor toggles the switch; default false |
| nextDueDate | date, nullable | null = Not scheduled |
| notes | text | |

A pair is created for every property × non-archived type, when either is created. **Applicability is driven by units, not by property creation:** `applicable` is computed from the type's rules — `nycOnly` vs the property's `inNyc`, and `appliesTo` vs the uses of the property's **non-archived units** (a property with no units matches no rules, including "All properties"). It is recomputed whenever a unit is added, archived or restored, or the NYC flag changes, **unless** `applicableSetByUser` is true, in which case the editor's choice is kept. (Import creates units in the same transaction, so imported properties get correct items.)
For `annual_date` types, `nextDueDate` is set to the next occurrence of month/day on or after today when the item first becomes applicable, if it is still null. For `interval` and `one_time` types, it starts as null (Not scheduled).
**ComplianceCompletion**: `itemId`, `completedOn` (date), `notes`, `completedById`.
**Permissions:** Editors have full CRUD for completions (delete allowed). Items are only toggled or rescheduled, never deleted individually; they are deleted only with their property or their (completion-free) type.

### 6.15 InvestmentEntry
| Field | Label | Type | Rules |
|---|---|---|---|
| entryDate | Date | date | required |
| propertyId | Property | property | required |
| unitId | Unit | unit, nullable | must belong to the property; null = "Whole property" |
| category | Category | enum Renovation, Appliance, Repair, Other | required |
| description | Description | text | required, ≤ 500 |
| vendor | Vendor | text | optional |
| cost | Cost | cents | required, ≥ 0 |

**Permissions:** Editors have full CRUD (hard delete).

### 6.16 System tables
- **AuditLog**: `at`, `actorUserId` (nullable for system), `action` (create, update, delete, archive, restore, sign_in, sign_in_failed, sign_out, password_reset, password_changed, invite, invite_revoked, deactivate, reactivate, pdf_generate, pdf_download, pdf_delete, import, compliance_complete), `entityType`, `entityId`, `summary` (human-readable), `changes` (JSON `{field: [before, after]}`), `ip`. Read by Admin only. Rows are never edited or deleted, except that `ip` is cleared after 2 years. Actions by the smoke user (sign_in, sign_out) are not recorded; failed sign-ins for unknown emails are recorded without the typed email.
- **ReminderLog**: `kind` (compliance \| lease_end \| needs_decision), `subjectId`, `dueDate`, `threshold`, `recipientUserId`, `status` (pending \| sent), `sentOn`. Unique on (kind, subjectId, dueDate, threshold, recipientUserId). See §10.5 for how rows are written.
- **EmailLog**: `to`, `template`, `subject`, `status` (queued/sent/failed), `sentAt`, `error`.
- **ImportRun**: `uploadedById`, `fileName`, `file` (bytea, the uploaded file, cleared after commit), `status` (validated/committed/failed/expired), `counts` JSON, `errors` JSON. Uncommitted runs expire after 24 hours; runs and their error reports are purged after 30 days.
- **TestClock** (test environments only, D-25): a single row holding the clock offset.

### 6.17 Relationships summary
Owner 1—* Property; Owner 1—* Unit (override); Property 1—* Unit, PropertyValue, PropertyTax, PropertyComplianceItem, InvestmentEntry; Unit 1—* Lease, InvestmentEntry; Lease *—* Tenant (LeaseTenant); Lease 1—* LeaseExtension, GeneratedDocument, RentStep, LeaseRevision; LeaseExtension 1—* RentStep, GeneratedDocument; LeaseExtension *—* Tenant (ExtensionTenant); ComplianceItemType 1—* PropertyComplianceItem 1—* ComplianceCompletion; User *—* Property (PropertyResponsible); User 1—* Invitation.

## 7. Calculations

### 7.1 Rent in effect on date D for a term
- `none`: base rent.
- `percent`: let k = number of full years between the term start and D (anniversary rule D-12). Rent = base, compounded k times, rounded to the cent each year.
- `schedule`: the amount of the latest rent step with effectiveDate ≤ D; otherwise base rent.

### 7.2 Lease rent on date D
Use the term (master or extension) containing D. Between terms (gaps), or after the effective end with month-to-month set, use `monthToMonthRent` if set, otherwise the rent in effect on the last day of the preceding term. After the effective end **without** month-to-month (Needs decision, or a move-out date after the effective end), use the rent in effect on the effective end date (the last known rent). **Current rent** = lease rent on today.
**Last rent** of a lease (used for potential rent, D-16) = lease rent on its last occupied day: the move-out date if set, otherwise the effective end date.

### 7.3 Rent schedule display
For a term, list consecutive periods (Period start, Period end, Monthly rent) covering the whole term. One row per year for `percent`, one row per step for `schedule`.

### 7.4 Lease status (on today, New York time)
Apply the first rule that matches:
1. **Ended**: moveOutDate < today.
2. **Upcoming**: today < startDate.
3. **Active**: moveOutDate ≥ today, or today ≤ effective end date.
4. **Month-to-month**: today > effective end and monthToMonth is true.
5. **Ended (superseded)**: today > effective end, no move-out date, and another non-archived lease exists on the same unit with a later start date (of any status, including Upcoming). Entering the later lease counts as the decision to end this one at its effective end date; no move-out date is stored or required. Its last rent is the rent on its effective end date.
6. **Needs decision**: everything else (today > effective end, not month-to-month, no move-out date, no later lease). This applies whenever any term ends — master or extension — without a timely update (D-14).

A lease with moveOutDate ≥ today shows "Active · moving out {date}". Archived leases show their status with " · Archived" appended and are excluded from statistics, dashboard tables and reminders.
A unit is **Occupied** if it has a lease that is Active, Month-to-month or Needs decision. Otherwise it is **Vacant**, or "Vacant · leased from {date}" if it has an Upcoming lease. A Needs decision lease counts as occupied at its last known rent (§7.2) until the landlord resolves it.

### 7.5 Other income (monthly, per lease currently occupying a unit)
Parking charge + tax reimbursement (D-13), using the **current term's** values (an extension may change them). The tax reimbursement shows as "—" if the base tax year or share is missing, or if the property has no tax years.

### 7.6 Statistics (portfolio = all non-archived properties; per property = its non-archived units)
- **Units**: count. **Occupied**, **Vacant**: counts. **Occupancy** = occupied ÷ units, as a percentage with 1 decimal place ("—" if 0 units).
- **Monthly rent roll** = Σ current rent of occupied units. **Annual rent roll** = 12 × monthly.
- **Monthly other income** = Σ §7.5.
- **Vacancy loss (monthly)** = Σ potential rent of vacant units (D-16).
- **Value** = D-15 basis. **Portfolio value** = Σ of property values that exist.
- **Gross yield** = 12 × (monthly rent roll + monthly other income) ÷ value, as a percentage with 2 decimal places ("—" without a value). The portfolio yield counts only properties that have a value, and shows the note "Based on {n} of {m} properties with a value."

### 7.7 Date arithmetic
"Plus N months" and "plus N years" land on the same calendar day in the target month; if that day doesn't exist, use the last day of that month (Jan 31 + 1 month = Feb 28, or Feb 29 in a leap year; Feb 29 + 1 year = Feb 28). Whole months between two dates (e.g. `lease_term_months`) are counted from the start date to the **day after** the end date, ignoring any leftover days: 2026-11-01 to 2027-10-31 is 12 months; 2026-11-15 to 2027-11-30 is 12 months. All rounding to the cent is half up.

## 8. Lease templates and PDFs

### 8.1 Placeholders
Keys are inserted as chips or typed as `{{key}}`. Missing values render as `__________` (10 underscores).

| Key | Chip label | Value |
|---|---|---|
| today | Today's date | Generation date, "January 5, 2027" |
| owner_name | Owner name | Unit owner override, else property owner |
| owner_address | Owner address | One line |
| owner_signatory | Owner signatory | "Name, Title" |
| property_address | Property address | "street, city, state zip" |
| unit_label | Unit | |
| unit_use | Unit use | Residential / Commercial |
| tenant_names | Tenant names | All names joined with ", " and " and " |
| primary_tenant_name | Primary tenant name | |
| primary_tenant_email | Primary tenant email | |
| primary_tenant_phone | Primary tenant phone | |
| tenant_signature_blocks | Tenant signature blocks | One signature/date line per tenant |
| lease_start_date | Lease start date | |
| lease_end_date | Lease end date | Master lease end date |
| lease_term_months | Lease term (months) | Whole months, start to end (§7.7) |
| monthly_rent | Monthly rent | Base rent of the term, "$2,150.00" |
| monthly_rent_words | Monthly rent in words | "Two thousand one hundred fifty dollars and 00/100" |
| rent_schedule | Rent schedule | Table (§7.3) for the term |
| annual_increase_percent | Annual increase (%) | "3%" |
| security_deposit | Security deposit | |
| rent_due_day | Rent due day | "1st" |
| late_fee | Late fee | |
| late_fee_grace_days | Late fee grace period | "5 days" |
| pets | Pets | |
| parking | Parking | |
| parking_charge | Parking charge | |
| children_reside | Children reside in unit | Yes / No |
| break_clause | Break clause | |
| other_terms | Other special terms | Line breaks preserved |
| base_tax_year | Base tax year | |
| tax_share_percent | Tenant's tax share (%) | |
| previous_end_date | Previous end date | *Extension only.* Effective end before this extension |
| previous_monthly_rent | Previous monthly rent | *Extension only.* Rent on the previous end date |
| extension_start_date | Extension start date | *Extension only* |
| extension_end_date | Extension end date | *Extension only* |
| extension_monthly_rent | Extension monthly rent | *Extension only* |
| extension_rent_schedule | Extension rent schedule | *Extension only* |
| previous_tenant_names | Previous tenant names | *Extension only.* Tenants of the previous term |
| removed_tenant_names | Removed tenants | *Extension only.* Previous-term tenants not on this extension ("None" if none) |
| added_tenant_names | Added tenants | *Extension only.* Extension tenants not on the previous term ("None" if none) |

Extension-only keys are offered only in Lease extension templates. Which term the other keys describe:
- **Master lease templates**: the master term (its tenants, rent, schedule, other income and special terms).
- **Lease extension templates**: the **extension's** term. `tenant_names`, `primary_tenant_*`, `tenant_signature_blocks`, `monthly_rent`, `rent_schedule`, `annual_increase_percent`, deposit, due day, late fee, parking, tax and special-term keys all use the extension's values. `lease_start_date` and `lease_end_date` still refer to the master lease; `lease_term_months` refers to the extension.

### 8.2 PDF layout
- US Letter, 1-inch margins. Body: Tinos (bundled, metric-compatible with Times New Roman), 11 pt, line-height 1.35. Headings in bold, H1 16 pt, centered.
- Footer on every page, 8 pt: left "{property_address} · Unit {unit_label}", right "Page X of Y".
- Page breaks where the template has a Page break. Tables have 0.5 pt black borders.
- Document metadata title = file name without ".pdf".
- File name: `Lease - {Property name} {Unit} - {start date YYYY-MM-DD}.pdf` or `Lease extension - {Property name} {Unit} - {extension start}.pdf`. In the property name and unit label, the characters `/ \ : * ? " < > |` and control characters are replaced by "-", runs of spaces collapse to one, and the whole name is cut to 150 characters before ".pdf". Downloads set `Content-Disposition: attachment` with both `filename` (ASCII fallback) and `filename*` (UTF-8), via the signed URL's response-header parameters.
- Rendering is offline: Chromium runs with JavaScript disabled and **all network requests blocked** (fonts are inlined), so template content can never make the server fetch anything.

### 8.3 PDF types
| PDF | Trigger | Contents | Access | Retention |
|---|---|---|---|---|
| Master lease | "Save and generate PDF" in the New lease wizard, or "Generate PDF" on a lease | Master lease template with lease data | All signed-in users (signed URL, 5 min) | Until manually deleted |
| Lease extension | "Save and generate PDF" in the extension form, or "Generate PDF" on an extension | Extension template with lease + extension data | All signed-in users | Until manually deleted |
| Template preview | "Preview PDF" in the template editor | Template with fixed sample data (Appendix B) | The requesting user only (others get 404) | 24 hours |

### 8.4 Allowed template content and pasting
Templates contain **only text and valid placeholders**, with this formatting: paragraphs, Heading 1/2, bold, italic, underline, numbered and bulleted lists (nesting allowed), center alignment, simple tables (text cells only, no merged cells), and page breaks.
When content is pasted (from Word or anywhere else):
- Everything else is **stripped**: images, logos, shapes, text boxes, headers, footers, footnotes, comments, fonts, colours, sizes, hyperlinks (their text is kept), and tracked-change markup (the visible text is kept). Merged table cells are split. If anything was stripped, a status message says "Some content was removed: images, headers and other unsupported items aren't allowed in templates."
- `{{key}}` tokens are recognised even when Word has split them across formatting runs. Recognised keys become chips.
- An unknown key, or an extension-only key in a Master lease template, stays as plain text and is listed under "Unrecognised placeholders: …" (an extension-only key adds "(only available in Lease extension templates)").
- **Saving is blocked** while unrecognised placeholders remain: "Fix the unrecognised placeholders before saving."
The server re-validates the content on save (same rules) and rejects anything else with 422.

## 9. Compliance

### 9.1 Seeded catalog
| Name | Applies to | NYC only | Schedule |
|---|---|---|---|
| HPD Property Registration | Properties with residential units | Yes | Same date every year: Sep 1 |
| Bed Bug Annual Filing | Properties with residential units | Yes | Dec 31 |
| Window Guard Annual Notice | Properties with residential units | Yes | Jan 15 |
| Lead-Based Paint Annual Notice | Properties with residential units | Yes | Jan 15 |
| Stove Knob Cover Annual Notice | Properties with residential units | Yes | Jan 15 |
| Smoke and CO Detector Check | Properties with residential units | No | Every 12 months |
| Storefront Registry Filing | Properties with commercial units | Yes | Jun 1 |
| Boiler Inspection | All properties | Yes | Every 12 months |
| Gas Piping Inspection (Local Law 152) | All properties | Yes | Every 48 months |

The Compliance item types screen shows the notice: "Default dates are starting points. Check current requirements with the relevant agency; RentNerd does not provide legal advice."

### 9.2 Item status
Apply the first rule that matches:
1. **Not applicable**: applicable is false.
2. **Completed**: a one-time item with at least one completion and nextDueDate null.
3. **Not scheduled**: nextDueDate is null.
4. **Overdue**: due before today.
5. **Due soon**: due today or within the next 30 days.
6. **Upcoming**: otherwise.

### 9.3 Mark done
Records a completion. It suggests the next due date as follows:
- `annual_date`: current nextDueDate + 1 year, repeated until the result is after the completion date (so a long-overdue item gets a future date); or, if the item is unscheduled, the next occurrence of the type's month/day after the completion date.
- `interval`: completion date + N months (§7.7).
- `one_time`: none.

The user can edit the suggestion before saving. Not-applicable items can also be marked done (e.g. to record history); they stay Not applicable and remain hidden from the due list defaults, dashboard and emails.

## 10. Email

All emails are from `MAIL_FROM` (domain mail.rentnerd.xyz). Links are absolute, using the app URL (https://rentnerd-app.fly.dev in production). Each email has a plain-text and an HTML version, and the footer "RentNerd · private landlord tools".

| # | Email | Trigger | Recipient | Subject | Content |
|---|---|---|---|---|---|
| 10.1 | Invitation | Admin sends or resends an invitation; startup admin creation or `resend-admin-invite` CLI | Invitee | You're invited to RentNerd | "{Inviter name} has invited you to RentNerd, the shared tool for managing your properties." (For the admin invitation: "You've been set up as the administrator of RentNerd, the shared tool for managing your properties.") Button/link "Set your password". "This link expires on {date}. If you weren't expecting this, you can ignore this email." |
| 10.2 | Password reset | Forgot password form | User, if the account exists, is active and its email is verified (invited users get nothing) | Reset your RentNerd password | Link "Reset password". "This link expires in 1 hour. If you didn't ask for this, ignore this email; your password won't change." |
| 10.3 | *(removed in v1.1)* | Email verification happens by accepting the invitation (D-07). | | | |
| 10.4 | Password changed | Password changed in Account settings, or by reset | User | Your RentNerd password was changed | "Your password was changed on {date time ET}. If this wasn't you, reset your password now: {link to /forgot-password}." |
| 10.5 | Daily summary | Daily 08:00 America/New_York | Each active Admin/Landlord who is a responsible landlord of a property with ≥ 1 item | RentNerd: {N} item(s) need attention – {Mon D, YYYY} | N = number of lines. Grouped by property name, then sections in this order: "Overdue compliance", "Compliance due soon", "Leases needing a decision", "Leases ending soon". Each line links to the item's screen: compliance lines to `/properties/{id}?tab=compliance`, lease lines to `/leases/{id}`. Final link: "Open dashboard". |
| 10.6 | Backup failed | Nightly backup job fails after retries | Admin | RentNerd backup failed – {Mon D, YYYY} | The error message and "Check the worker logs and docs/RESTORE.md." |

**Daily summary inclusion rules** (thresholds are relative to the due or end date):
- Compliance (applicable, scheduled, type not archived, property not archived): thresholds 30 days before, 7 days before, the due date, and every 7 days overdue (7, 14, 21…). Line: "{Item name} – due {date}" or "{Item name} – overdue since {date}".
- Lease ending: leases that are Active, not month-to-month, with no move-out date and no later lease on the unit (a later lease is already the decision, §7.4). Thresholds 90, 60 and 30 days before the effective end date. Line: "Unit {label} – {tenant names} – lease ends {date} ({n} days)".
- Needs decision: thresholds 1 day after the effective end, then every 7 days. Line: "Unit {label} – {tenant names} – lease ended {date}; extend, mark month-to-month, or end the lease".
- Items on archived properties, archived units or archived leases are never included.
- **Catch-up:** an item is included for a recipient if its **latest reached threshold** (the most recent threshold on or before today) has no ReminderLog row for that recipient. So if the job doesn't run on a threshold day, the item is sent on the next day the job runs. Once a threshold has been sent, the item isn't sent again until the next threshold is reached. Each item appears at most once per email. "({n} days)" in lease lines is the actual number of days left on the day of sending.
- **Multiple responsible landlords:** each responsible landlord gets their own digest containing all items of their properties, logged separately per recipient.
- **No duplicates:** in one transaction, the digest job inserts ReminderLog rows with status `pending` and enqueues one email job per recipient with a pg-boss singleton key of (recipient, date). Pending rows count as logged, so a second run on the same day sends nothing. The email job marks its rows `sent` after the SMTP send succeeds. If the email permanently fails (after 5 retries), its pending rows are deleted so the next day's run includes those items again.
- Completing, rescheduling, extending or ending an item removes it from future emails, because its due or end date or status changes.

## 11. Screens

Global layout for signed-in users: a "Skip to main content" link, then a header with "RentNerd" (home link) and a user menu button showing the user's name, containing "Account settings" and "Sign out". The left navigation (a top menu button "Menu" on narrow screens) has: **Dashboard, Properties, Tenants, Owners, Leases, Compliance, Investments, Templates, Import**, and for the Admin only **Users, Activity log**. Each page has a unique `<title>` "{Page} – RentNerd" and one `<h1>`.

Shared conventions:
- Required fields are marked "(required)" in the label.
- Validation errors appear under the field and in an error summary at the top, "There is a problem", which links to each field.
- Save success shows a status message "{Thing} saved."
- A version conflict shows the alert "Someone else changed this record. Reload to see the latest version." with button "Reload".
- Unexpected errors show "Something went wrong. Please try again."
- Destructive actions open a confirmation dialog with a "Cancel" button.
- Money inputs accept "2150", "2,150" or "2150.00" and display "$2,150.00".
- Lists show 50 rows per page, with "Previous" and "Next" buttons and "Page X of Y".
- Unknown routes show "Page not found" with link "Go to dashboard". Admin-only routes for a Landlord show "You don't have access to this page." For the Smoke user, all create/edit/delete/archive/generate/import controls are hidden, and editing routes (e.g. `/properties/new`) show "You don't have access to this page."
- A button that is unavailable (e.g. **Delete owner** when the owner is in use) stays focusable and uses `aria-disabled="true"` with its explanation as the accessible description, so keyboard and screen-reader users can discover why. Activating it does nothing.
- An action that needs a newly opened tab (e.g. **Preview PDF**) opens the tab immediately on click, showing "Preparing your PDF…", and loads the PDF into it when ready, so browsers don't block it as a pop-up.
- All dates and times are shown in New York time.

### 11.1 Sign in — `/login`
Fields: **Email**, **Password**. Button **Sign in**. Link **Forgot password?**
Errors:
- "Incorrect email or password." (also used for deactivated accounts and invited users who haven't accepted)
- "Too many attempts. Try again in a few minutes." (counted per typed email, whether or not an account exists, so it doesn't reveal which emails have accounts)

Successful sign-in goes to `/` (Dashboard), or to the page originally requested.

### 11.2 Forgot password — `/forgot-password`
Field **Email**; button **Send reset link**; link **Back to sign in**. After submitting, it always shows: "If an account exists for that email, we've sent a reset link."

### 11.3 Reset password — `/reset-password?token=…`
Fields **New password**, **Confirm new password**; button **Reset password**. Success: all of the user's sessions are signed out, then redirect to `/login` with the message "Your password has been reset. Please sign in." An invalid or expired token shows "This reset link is invalid or has expired." with link **Request a new link**.

### 11.4 Accept invitation — `/accept-invite?token=…`
Shows "You're joining RentNerd as {email}." Fields **Your name** (prefilled), **Password**, **Confirm password**; button **Create account**. Success signs the user in and opens the Dashboard. An invalid, expired, revoked or used token shows "This invitation is invalid or has expired. Ask the administrator to send a new one."

### 11.5 *(removed in v1.1)*
There is no separate verify-email page; accepting the invitation verifies the email (D-07). `/verify-email` shows "Page not found".

### 11.6 Dashboard — `/`
`<h1>` Dashboard.
- **Portfolio summary** (definition list): Units, Occupied, Vacant, Occupancy, Monthly rent roll, Annual rent roll, Monthly other income, Vacancy loss (monthly), Portfolio value, Gross yield.
- Table **By property**: columns Property, Type, Units, Occupied, Occupancy, Monthly rent, Other income (monthly), Value, Gross yield. The property name links to the property.
- Table **Leases needing a decision**: Property, Unit, Tenants, Ended on, Current rent. Empty state: "None."
- Table **Leases ending in the next 90 days**: Property, Unit, Tenants, End date, Days left, Current rent. Includes Active leases whose end falls within today … today + 90 days, where the end is the move-out date if set, otherwise the effective end date. Excludes Month-to-month and Upcoming leases. (The daily email's "Leases ending soon" is narrower: it skips leases that already have a move-out date, since no decision is needed.)
- Table **Overdue compliance**: Property, Item, Due date, Responsible landlords.
- Table **Compliance due in the next 30 days**: same columns.

### 11.7 Properties — `/properties`
Search field **Search properties** (name, address). Checkbox **Show archived**. Button **Add property**. Columns: Property, Address, Owner, Type, Units, Occupied, Responsible landlords. Empty state: "No properties yet. Add a property or import a spreadsheet."

### 11.8 Add / Edit property — `/properties/new`, `/properties/:id/edit`
Fields: **Property name**, **Street address**, **City**, **State**, **ZIP code**, **Located in New York City**, **Borough-Block-Lot (BBL)**, **Year built**, **Owner** (select of non-archived owners, plus link **Add owner** opening the owner form in a dialog), **Responsible landlords** (multi-select of active Admin/Landlord users showing name and email; at least one: "Choose at least one responsible landlord."), **Purchase price**, **Purchase date**, **Notes**.
On *Add* only: checkbox **Single-unit property**. When checked, it shows **Use** (Residential/Commercial) and on save creates a unit labelled "Entire property".
Buttons **Save property**, **Cancel**.

### 11.9 Property detail — `/properties/:id`
`<h1>` = property name. Summary shows: address, Type, Owner, Responsible landlords (name and email), Located in New York City (Yes/No), BBL, Year built, Purchase price, Purchase date, Current value (with basis "Market estimate {date}" or "Purchase price"), Monthly rent roll, Gross yield, Total invested.
Buttons: **Edit property**, **Archive property** / **Restore property**, **Delete property** (enabled only when deletable; otherwise its accessible description is "Properties with lease or investment history can only be archived"). **Archive property** opens a confirmation dialog: "Archive {property name}? All its units and leases will also be archived, removed from the dashboard and their reminders stopped." When it has current leases, the warning from §6.4 is shown first. Button **Archive property**.
Tabs: **Units**, **Values**, **Property taxes**, **Compliance**, **Investments**.
- **Units**: columns Unit, Use, Status, Tenants, Current rent, Lease end. Button **Add unit**. Checkbox **Show archived**.
- **Values**: current value summary; table Date, Value type, Amount, Source / notes, plus row actions **Edit**, **Delete**. Button **Add value** opens a dialog with **Date**, **Value type**, **Amount**, **Source / notes**, and buttons **Save value**, **Cancel**.
- **Property taxes**: table Tax year, Annual property tax, plus **Edit**, **Delete**. Button **Add tax year** opens a dialog with **Tax year**, **Annual property tax**, and button **Save tax year**.
- **Compliance**: table Item, Applies to this property (switch), Status, Due date, Last completed, plus actions **Mark done**, **Set due date**, **History**.
- **Investments**: same as §11.21, filtered to this property, with **Add entry**.

### 11.10 Add / Edit unit — `/properties/:id/units/new`, `/units/:id/edit`
Fields **Unit label**, **Use** (on edit, shown read-only with the hint "Use can't be changed. To change it, archive this unit and add a new one."), **Bedrooms**, **Bathrooms**, **Square feet**, **Owner (if different from property)**, **Notes**. Buttons **Save unit**, **Cancel**.

### 11.11 Unit detail — `/units/:id`
`<h1>` "{Property name} – Unit {label}". Summary: Use, Bedrooms, Bathrooms, Square feet, Owner, Status, Current rent, Potential rent (if vacant).
Card **Current lease**: tenants, term, status, link **View lease**. If none: "No current lease."
Table **Lease history**: Start, End, Tenants, Status, Rent at end.
Buttons **New lease**, **Edit unit**, **Archive unit** / **Restore unit**, **Delete unit**. **Archive unit** opens a confirmation dialog; if the unit has a current lease it shows the warning from §6.7.

### 11.12 New lease wizard — `/units/:id/leases/new`
A step indicator reads "Step X of 4". Each step has **Back** (except step 1) and **Next** (except step 4). Leaving the wizard with unsaved data prompts "Discard this lease? Your changes will be lost." with buttons **Discard**, **Keep editing**.
1. **Tenants**: combobox **Add existing tenant** (search by name/email); button **Add new tenant** (inline tenant form, §11.15 fields, button **Add tenant**; new tenants are only saved when the lease is saved). Archived tenants are not offered. A table of added tenants has a radio **Primary contact** and a button **Remove** per row. Validation: "Add at least one tenant." / "Choose a primary contact."
2. **Term and rent**: **Lease start date**, **Lease end date**, **Monthly rent**, **Security deposit**, **Rent due day**, **Late fee**, **Late fee grace period (days)**. Radio group **Rent increases**: "None", "Fixed percentage each year", "Custom schedule". Percentage shows **Annual increase (%)**. Custom schedule shows rows of **Effective date** and **Monthly rent**, with buttons **Add row** and **Remove**. A live preview table **Rent schedule** has columns Period start, Period end, Monthly rent. When the Lease end date is before today, the optional fields **Move-out date** and **Reason** are also shown (for entering past leases). If the dates clash with the unit's current lease, the **Replace current lease** option from §6.9 is offered.
3. **Special terms**: **Pets**, **Parking**, **Parking charge (monthly)**, **Children reside in unit** (Yes/No, Residential only), **Break clause**, **Other special terms**. Commercial only: **Base tax year** (select of the property's tax years; if none, the hint "Add tax years on the property's Property taxes tab to calculate tax reimbursement.") and **Tenant's share of tax increase (%)**. A read-only line **Tax reimbursement (monthly)** shows the computed value.
4. **Review**: a summary of all values, then select **Lease template** (non-archived Master lease templates; optional). If a template is selected and any placeholder it uses has no value, it warns "These items are empty and will print as blank lines:" followed by the chip labels. Buttons **Save lease**, **Save and generate PDF** (enabled only with a template).

Saving opens the Lease detail page. Lease, new tenants, rent steps and (if chosen) the replaced lease's move-out are saved in one transaction.

### 11.13 Lease detail — `/leases/:id`
`<h1>` "Lease – {Property name} Unit {label}". A status badge shows text (§7.4).
Sections:
- **Tenants** (current term, §3): name, email, phone, "Primary contact" marker.
- **Term and rent**: Lease start date, Lease end date, Effective end date, Current monthly rent, Security deposit, Rent due day, Late fee, Late fee grace period. A **Rent schedule** table covers the master term and all extensions (Period start, Period end, Monthly rent, Term).
- **Special terms** (current term): all special-term fields.
- **Other income** (current term): Parking charge (monthly), Tax reimbursement (monthly) with the explanation "{share}% × ({latest year} tax {amount} − {base year} tax {amount}) ÷ 12".
- **Extensions**: table Start, End, Tenants, Monthly rent, Notes, with actions **Edit**/**Delete** on the latest only. Button **Add extension**.
- **Versions**: table Version, Changed on, Changed by, Summary; each row links to a read-only view of that version (`/leases/:id/versions/:n`). Documents show which version they were generated from.
- **Documents**: table Name, Template, Generated by, Generated on, Status (Generating… / Ready / Failed), with actions **Download** (Ready), **Try again** (Failed) and **Delete**. Button **Generate PDF**.

Action buttons:
- **Edit lease**: the wizard fields (tenants, term and rent, special terms) on one page, button **Save lease**. Saving creates a new version (D-31) after re-checking every rule in §6.9.
- **Mark month-to-month**: visible when Active or Needs decision and not month-to-month. Dialog: "Mark this lease month-to-month after {effective end date}?", field **Month-to-month monthly rent** (prefilled with the last rent), button **Mark month-to-month**.
- **End lease**: visible unless Ended or Upcoming. Dialog fields **Move-out date**, **Reason**, button **End lease**.
- **Delete lease**: dialog "Delete this lease, its extensions and all generated PDFs? This cannot be undone.", button **Delete lease**.

**Generate PDF** dialog: radio **Document** (Master lease / Extension starting {date}, one option per extension), select **Template** (non-archived templates of the matching kind, plus archived ones previously used for this lease marked "(archived)"), the empty-placeholder warning as in §11.12, and button **Generate**.
**Delete document** dialog: "Delete this PDF permanently? This cannot be undone.", button **Delete PDF**.

### 11.14 Add / Edit extension — `/leases/:id/extensions/new`, `/extensions/:id/edit`
Fields **Extension start date**, **Extension end date**, **Monthly rent**, **Rent increases** (as §11.12); section **Tenants** (as wizard step 1, pre-filled with the previous term's tenants; at least one master-lease tenant must remain); a collapsed section **Change other terms (optional)**, closed by default and labelled "Everything else stays the same unless you change it here", containing **Rent terms** (Security deposit, Rent due day, Late fee, Late fee grace period), **Other income** (Parking, Parking charge, and for Commercial units Base tax year and Tenant's share) and **Special terms** (as wizard step 3), all pre-filled from the previous term (§6.10). When an extension template is selected, each field whose key the template uses is marked "Used in this template", so the landlord can see which changes will print. **Notes**; select **Extension template** (optional). Buttons **Save extension**, **Save and generate PDF**, **Cancel**.

### 11.15 Tenants — `/tenants`, `/tenants/new`, `/tenants/:id`, `/tenants/:id/edit`
List: search **Search tenants**, checkbox **Show archived**, button **Add tenant**; columns Name, Contact person, Email, Phone, Current unit(s).
Form: radio **Tenant type** (Individual / Business); **First name**, **Last name** (Individual) or **Business name**, **Contact person** (Business); **Email**, **Phone**, **Notes**; buttons **Save tenant**, **Cancel**.
Detail: contact details; table **Leases** (Property, Unit, Start, End, Status, Primary contact); buttons **Edit tenant**, **Archive tenant** / **Restore tenant**, **Delete tenant**.

### 11.16 Owners — `/owners`, `/owners/new`, `/owners/:id`, `/owners/:id/edit`
List: **Search owners**, **Show archived**, **Add owner**; columns Owner name, Owner type, City, Properties.
Form: the §6.3 labels; buttons **Save owner**, **Cancel**.
Detail: fields; table **Properties**; buttons **Edit owner**, **Archive owner** / **Restore owner**, **Delete owner**. If the owner is used by a non-archived property or unit, **Archive owner** shows the message from §6.3 listing those properties instead of archiving.

### 11.17 Leases — `/leases`
Filters: **Status** (a group of checkboxes: Upcoming, Active, Month-to-month, Needs decision, Ended; by default all are checked except Ended), checkbox **Show archived** (off by default), **Property**. Columns: Property, Unit, Tenants, Start, Effective end, Current rent, Status.

### 11.18 Compliance — `/compliance`
Tabs **Due list** and **Item types**.
- **Due list**: filters **Property**, **Status** (Overdue, Due soon, Upcoming, Not scheduled, Not applicable, Completed; default the first three), **Responsible landlord** (shows items for properties where that user is one of the responsible landlords). Columns Property, Item, Due date, Status, Last completed, Responsible landlords; actions **Mark done**, **Set due date**.
  - **Mark done** dialog: **Completed on** (default today), **Notes**, **Next due date** (prefilled per §9.3), button **Save**.
  - **Set due date** dialog: **Next due date**, button **Save**.
  - **History** dialog (from the property tab): table Completed on, Notes, Completed by, action **Delete**.
- **Item types**: the notice from §9.1; button **Add item type**; columns Name, Applies to, NYC only, Schedule; actions **Edit**, **Archive** / **Restore**, **Delete**.
  - Form: **Name**, **Description**, **Applies to**, **New York City properties only**, **Schedule**, then **Month** + **Day**, or **Repeat every (months)**. Buttons **Save item type**, **Cancel**.

### 11.19 Templates — `/templates`
Button **New template**; checkbox **Show archived**; columns Name, Type, Last updated, Updated by.

### 11.20 Template editor — `/templates/new`, `/templates/:id`
Fields **Template name**, **Template type**.
Toolbar (each control has an accessible name equal to its label): **Heading 1**, **Heading 2**, **Bold**, **Italic**, **Underline**, **Numbered list**, **Bulleted list**, **Align center**, **Page break**, **Insert table**, **Insert placeholder**. **Insert placeholder** opens a searchable list of the chip labels valid for the type.
The editor area has the accessible name "Template content". Chips display as "[Chip label]". Pasting and placeholder rules are in §8.4: unsupported content is stripped, and an unknown `{{key}}` stays as plain text, is listed under the warning "Unrecognised placeholders: …", and blocks saving until fixed.
Buttons **Preview PDF** (opens a new tab at once and shows the preview in it when ready; see §11 conventions), **Save template**, **Archive template** / **Restore template**, **Delete template**. A link **How to convert a Word lease** opens Appendix A as an in-app help page `/help/templates`.

### 11.21 Investments — `/investments`
Filters **Property**, **Category**, **From**, **To**. Button **Add entry**. Columns Date, Property, Unit, Category, Description, Vendor, Cost; actions **Edit**, **Delete**. The footer row "Total" sums Cost for the current filter (across all pages).
Form (dialog): **Date**, **Property**, **Unit** (first option "Whole property"), **Category**, **Description**, **Vendor**, **Cost**; buttons **Save entry**, **Cancel**.

### 11.22 Import — `/import`
Instructions text; button **Download template** (`rentnerd-import-template.xlsx`); file input **Spreadsheet file** (.xlsx, ≤ 5 MB); button **Check file**.
- Errors: heading "We found {n} problems. Fix them in the spreadsheet and check the file again."; table Sheet, Row, Column, Problem.
- Valid: "Ready to import: {a} owners, {b} properties, {c} units, {d} tenants, {e} leases." with buttons **Import** and **Cancel**.
- After import: "Import complete." with links to Properties.

The template has sheets **Owners**, **Properties**, **Units**, **Tenants**, **Leases**, and an **Instructions** sheet. Each sheet has **one column per field in the data model (§6.3, §6.4, §6.7, §6.8, §6.9), headed with the field's label, with the same required/optional rules and validation**, plus these import-only columns:
- Reference keys chosen by the user: **Owner key** (Owners), **Property key** and **Owner key** (Properties), **Unit key**, **Property key** and **Owner override key** (Units), **Tenant key** (Tenants), **Unit key** and **Tenant 1 key** … **Tenant 4 key** (Leases; Tenant 1 = primary).
- **Responsible landlord emails** (Properties): one or more emails of active Admin/Landlord users, separated by ";". Empty = the importing user.
- **Single-unit property** is not a column; add a Units row instead.
Formats: dates as real Excel dates or `YYYY-MM-DD` text; money as numbers or text like "2,150.00"; percentages as numbers (3 = 3%); yes/no fields as "Yes"/"No"; enums as their labels. Leases support increase type "None" or "Percent" only; each row is the master term, with optional Month-to-month, Month-to-month monthly rent, Move-out date and Reason columns; extensions are not imported.
Rules: all of §6's rules apply (including uniqueness against existing records, e.g. property names, and the lease overlap rule against existing leases). Import only creates new records; owners and tenants with the same names as existing ones are created as separate records. The uploaded file is kept on the ImportRun; **Import** re-validates it against the current data in the same transaction as the insert, and shows the problems table instead if anything has changed. Files over 5 MB, with more than 50 MB uncompressed content, or more than 5,000 rows in a sheet are rejected before parsing ("The file must be 5 MB or smaller." / "This file is too large to import.").

### 11.23 Users (Admin) — `/users`
Button **Invite landlord** opens a dialog with **Name**, **Email** and button **Send invitation**. Table: Name, Email, Role (Admin / Landlord / Smoke test (read-only)), Status (Active / Invited / Invitation expired / Invitation revoked / Deactivated), Last sign-in. Invited users appear here as soon as they are invited (D-07). Row actions:
- **Resend invitation** (invited users, any invitation state), **Revoke invitation** (invited users with a valid invitation)
- **Deactivate** (active landlords; dialog "Deactivate {name}? They will be signed out and can't sign in. They'll be removed as a responsible landlord; properties left with no responsible landlord will be assigned to you.", button **Deactivate**)
- **Reactivate**

The Admin row and the Smoke row have no actions. Inviting an email that already belongs to a user (any status) shows "A user with this email already exists."

### 11.24 Activity log (Admin) — `/activity`
Filters **User**, **Record type**, **From**, **To**. Columns When (ET), User, Action, Record, Changes (expandable "Show changes": a field/before/after list).

### 11.25 Account settings — `/account`
Section **Profile**: **Name**, button **Save name**; email shown read-only.
Section **Change password**: **Current password**, **New password**, **Confirm new password**; button **Change password**. Success: "Password changed." Other sessions are revoked. (Not available to the Smoke user.)

## 12. User stories

Each story is "As a landlord" unless marked Admin. ACs are in §13.

**Access**
- US-01 As the Admin, I invite a landlord by name and email so they can join.
- US-02 As an invitee, I set my password from the email link and land in the app.
- US-03 I sign in and out; I reset a forgotten password.
- US-04 As the Admin, I deactivate and reactivate landlords and revoke or resend invitations.
- US-05 I change my name and password.
- US-06 As the Admin, I review who changed what in the Activity log.

**Portfolio records**
- US-07 I add, edit, archive, restore and delete owners.
- US-08 I add, edit, archive, restore and delete properties, including single-unit properties, and assign an owner and one or more responsible landlords.
- US-09 I record purchase price and date, and keep a history of market estimates and assessed values.
- US-10 I record annual property tax by tax year.
- US-11 I add, edit, archive and delete units with a residential/commercial use and optional owner override.
- US-12 I add, edit, archive and delete tenants (individuals or businesses with a contact person), with optional phone and email.
- US-13 I import my existing portfolio from a spreadsheet.

**Leases**
- US-14 I create a lease for a unit with one or more tenants, one primary contact, term, rent, deposit, due day, late fee, special terms, and a percentage or custom rent-increase schedule.
- US-15 I see the current rent update automatically on scheduled increase dates.
- US-16 I add an extension with new dates and rent or rent schedule, and optionally change tenants (keeping at least one from the master lease) and any other lease value that has a placeholder key.
- US-17 I resolve an expired lease by extending it, marking it month-to-month, or ending it.
- US-18 I end a lease with a move-out date and reason, and the unit becomes vacant afterwards.
- US-19 I see commercial tax reimbursement calculated from the base tax year and the tenant's share.
- US-20 I delete a lease entered by mistake.
- US-30 I enter older, already-finished leases for a unit, and replace a current lease with a new one when a tenant leaves early.
- US-31 I see every earlier version of a lease and who changed it.

**Documents**
- US-21 I create and edit named lease and extension templates with placeholders, shared with all landlords.
- US-22 I preview a template as a PDF with sample data.
- US-23 I generate a lease or extension PDF from a template, download it, print it and sign it offline.
- US-24 I review previously generated PDFs and delete ones I no longer need.

**Compliance and reminders**
- US-25 I see each property's compliance items, switch off those that don't apply, set due dates, and mark items done.
- US-26 I add and edit compliance item types.
- US-27 As one of a property's responsible landlords, I get one daily email listing upcoming and overdue compliance, leases ending soon, and leases needing a decision.

**Insight**
- US-28 I see portfolio and per-property occupancy, rent roll, other income, vacancy loss, value and gross yield.
- US-29 I log renovation, appliance and repair investments and see totals.

## 13. Acceptance criteria

Each criterion is observable through the browser, the Mailpit API, the storage (MinIO) API, or the HTTP API, and is implemented as automated tests in `tests/acceptance/`, which are locked (D-33). Criteria marked **(manual)** are checked by a person before the first release. Unless stated otherwise, the time in tests is fixed with the test clock (D-25), which moves the whole app clock (dates, token expiry, session expiry). The acceptance suite runs serially against one test database, resetting it before each test file, because the clock is shared. Test data, including the Dashboard fixture below and the scale fixture of §16, is created by the tests themselves through the normal API (§14) and UI, never by app-provided fixture code, so the app can't shape its own test data. How the tests start and reach the app is fixed by the harness contract in §15.5.

### Platform (PLAT)
- **AC-PLAT-01** `GET /api/health` returns 200 with body `{"status":"ok"}` when the database is up.
- **AC-PLAT-02** After the app starts with `SMOKE_USER_EMAIL`/`SMOKE_USER_PASSWORD` set and no such user exists, signing in with those credentials at `/login` succeeds and shows the Dashboard, with no verification prompt.
- **AC-PLAT-03** When the smoke user is signed in, the navigation has no "Users" or "Activity log" links, visiting `/users` or `/properties/new` shows "You don't have access to this page.", no **Add property** button is shown, and `POST /api/properties` returns 403 with `error.code` "FORBIDDEN".
- **AC-PLAT-04** Restarting the app when the smoke user already exists doesn't create a duplicate: the Users list shows the smoke email exactly once, and the password still works. After changing `SMOKE_USER_PASSWORD` and restarting, the new password works and the old one fails.
- **AC-PLAT-05** With `ENABLE_TEST_ROUTES` unset, `POST /api/test/clock` returns 404.
- **AC-PLAT-06** Requesting `/properties` directly (deep link) while signed in renders the Properties page (SPA fallback).
- **AC-PLAT-07** Starting the web or worker process with `ENABLE_TEST_ROUTES=true` exits with a non-zero code and an explanatory error when any of these holds: `NODE_ENV` isn't `test`, `FLY_APP_NAME` is set, or the database name doesn't end in `_test`.
- **AC-PLAT-08** First start with `ADMIN_EMAIL=admin@example.test` and no admin: the Users list shows that email with Role "Admin" and Status "Invited", and Mailpit receives one "You're invited to RentNerd" with the administrator wording. Restarting sends no second email. Restarting with a different `ADMIN_EMAIL` creates no second admin. After the invitation expires, `node dist/cli.js resend-admin-invite` sends a new working link.
- **AC-PLAT-09** Smoke user sign-in and sign-out create no Activity log rows.
- **AC-PLAT-10** Triggering the backup job (`POST /api/test/jobs/backup`) creates an object under `backups/` in storage. Running `node dist/cli.js restore-backup --latest --target-url <empty database URL>` (the command `docs/RESTORE.md` documents) restores it, and the row counts of every application table match the source.
- **AC-PLAT-11** With the scale fixture loaded (§16), `GET /api/dashboard` responds in under 1 s, and each list endpoint's 95th-percentile response time over 20 requests is under 500 ms, measured in the full local test run (`VERIFY_ALL=1`, §15.4).
- **AC-PLAT-12** **(manual)** If the post-deploy production smoke test fails, the workflow redeploys the previous release and the run is marked failed. Checked once before the first release by a manually triggered workflow run with a deliberately failing smoke step.

### Authentication (AUTH)
- **AC-AUTH-01** Visiting `/` while signed out redirects to `/login`. After signing in, the user lands on the originally requested page.
- **AC-AUTH-02** A wrong password shows "Incorrect email or password." and stays on `/login`.
- **AC-AUTH-03** A deactivated user's correct credentials show "Incorrect email or password."
- **AC-AUTH-04** After 5 failed attempts for one email within 15 minutes (from any IP), the 6th attempt (even with the correct password) shows "Too many attempts. Try again in a few minutes." The same happens for an email that has no account.
- **AC-AUTH-05** Submitting **Send reset link** for any email shows "If an account exists for that email, we've sent a reset link." Mailpit receives "Reset your RentNerd password" only for an existing, active, verified user, and at most 3 such emails per email address per hour.
- **AC-AUTH-06** Following the reset link, setting a new password and signing in with it succeeds. The old password then fails, a second browser session of that user is signed out (redirected to `/login` on its next page load), and Mailpit receives "Your RentNerd password was changed".
- **AC-AUTH-07** A reset link used twice, or used more than 1 hour after issue (test clock moved forward 61 minutes), shows "This reset link is invalid or has expired."
- **AC-AUTH-08** New-password fields reject passwords shorter than 12 characters with "Password must be at least 12 characters." and mismatched confirmation with "Passwords don't match."
- **AC-AUTH-09** **Sign out** returns to `/login`. Pressing Back afterwards and reloading doesn't show protected data (it redirects to `/login`).
- **AC-AUTH-10** The session cookie is HttpOnly, Secure (in production) and SameSite=Lax, and its expiry is 7 days (± 1 hour) after sign-in.
- **AC-AUTH-11** An invited user who hasn't accepted their invitation sees "Incorrect email or password." when signing in, and requesting a password reset for their email sends no email. `/verify-email` shows "Page not found".
- **AC-AUTH-12** There is no sign-up link on `/login`, and `POST /api/auth/sign-up/email` returns an error (sign-up disabled).

### Users and invitations (USR)
- **AC-USR-01** The Admin invites "Pat Lee" / pat@example.com. The Users table immediately shows Pat with Role "Landlord" and Status "Invited", and Mailpit receives "You're invited to RentNerd" at that address with a "Set your password" link.
- **AC-USR-02** Opening the invitation link shows "You're joining RentNerd as pat@example.com." Submitting a valid password signs Pat in to the Dashboard, and the Users table shows Pat as "Active".
- **AC-USR-03** The same invitation link opened again shows "This invitation is invalid or has expired. Ask the administrator to send a new one."
- **AC-USR-04** With the test clock moved 8 days after sending, the invitation link shows the invalid/expired message, and the Users table shows "Invitation expired".
- **AC-USR-05** After **Revoke invitation**, the link shows the invalid/expired message and the Users table shows "Invitation revoked". **Resend invitation** then sends a new email whose link works; resending again invalidates the previous link.
- **AC-USR-06** Inviting an existing user's email shows "A user with this email already exists."
- **AC-USR-07** After the Admin deactivates a landlord, that landlord's open browser session is redirected to `/login` on its next page load or next request to the server, and their sign-in fails.
- **AC-USR-08** Deactivating landlord L: property P, whose only responsible landlord was L, now lists the Admin; property Q, which listed L and M, now lists only M.
- **AC-USR-09** **Reactivate** restores sign-in with the landlord's previous password.
- **AC-USR-10** The Admin's own row in Users has no Deactivate action, and `POST /api/users/{adminId}/deactivate` returns 403.
- **AC-USR-11** A landlord who visits `/users` or `/activity` sees "You don't have access to this page." As a landlord, `GET /api/users`, `POST /api/invitations`, `POST /api/invitations/{id}/resend` and `POST /api/invitations/{id}/revoke` each return 403 with `error.code` "FORBIDDEN".
- **AC-USR-12** In Account settings, changing Name and clicking **Save name** shows "Name saved." and the new name appears in the user menu.
- **AC-USR-13** Changing password with a wrong **Current password** shows "Current password is incorrect."
- **AC-USR-14** A landlord sees each responsible landlord's name and email on the property detail page. `GET /api/people` returns active Admin and Landlord users with name and email, and excludes invited, deactivated and smoke users.

### Owners (OWN)
- **AC-OWN-01** Creating an owner with all required fields shows "Owner saved." and the owner appears in `/owners`.
- **AC-OWN-02** Submitting the owner form empty shows "There is a problem" with links to Owner name, Owner type, Mailing address line 1, City, State and ZIP code.
- **AC-OWN-03** **Delete owner** for an owner used by a property is unavailable (aria-disabled) with the description "Owners used by properties or units can only be archived". **Archive owner** while a non-archived property uses it shows "Change the owner on these properties before archiving this owner:" with a link to that property, and the owner stays active. Once no non-archived property or unit uses it, **Archive owner** hides it from the list until **Show archived** is checked.
- **AC-OWN-04** An archived owner doesn't appear in the property form's Owner select.

### Properties, values and taxes (PROP)
- **AC-PROP-01** Adding a property with **Single-unit property** checked and Use "Commercial" creates the property and a unit "Entire property". The property's Type shows "Commercial".
- **AC-PROP-02** A property with one Residential and one Commercial unit shows Type "Mixed" in the list and detail page.
- **AC-PROP-03** A duplicate Property name among non-archived properties shows "A property with this name already exists."
- **AC-PROP-04** Responsible landlords defaults to the signed-in user on Add property. Choosing two landlords saves both, and both appear on the property detail page.
- **AC-PROP-05** Adding a Market estimate of $900,000 dated 2026-01-01, then one of $950,000 dated 2026-06-01, shows Current value "$950,000.00" with basis "Market estimate Jun 1, 2026". Both rows remain in the Values table.
- **AC-PROP-06** With no market estimate and Purchase price $700,000, Current value shows "$700,000.00" with basis "Purchase price". Adding an Assessed value doesn't change Current value.
- **AC-PROP-07** Adding tax year 2025 twice for one property shows "This tax year already exists for this property."
- **AC-PROP-08** **Archive property** on a property with an Active lease shows the warning that all units and leases will be archived. After confirming, the property leaves the Properties list and the Dashboard totals, its units and lease are archived (the lease shows "· Archived" and is hidden from `/leases` by default), and the daily job sends no reminders for it. **Restore property** brings back the property, units and lease with their previous statuses.
- **AC-PROP-09** A property with a leased unit has **Delete property** unavailable (aria-disabled, with its description). A property with only never-leased units and no investments can be deleted after confirmation, and then returns "Page not found" at its URL.
- **AC-PROP-10** Searching "Court" in **Search properties** lists only properties whose name or address contains "Court".
- **AC-PROP-11** Deleting a deletable property removes its items from the Compliance Due list; the Item types tab still lists the same item types.

### Units (UNIT)
- **AC-UNIT-01** Adding unit "2R" Residential to a property shows it in the Units tab with Status "Vacant".
- **AC-UNIT-02** A duplicate Unit label within the same property shows "A unit with this label already exists in this property."
- **AC-UNIT-03** **Archive unit** on a unit with an Active lease shows "This unit has a current lease. Archiving the unit also archives the lease, removes it from the dashboard and stops its reminders." After confirming, the unit's rent leaves the Dashboard totals. **Restore unit** brings the lease back as Active.
- **AC-UNIT-04** Setting **Owner (if different from property)** makes the unit detail Owner show the override. A generated lease for that unit shows the override owner's name for `owner_name`.
- **AC-UNIT-05** On Edit unit, Use is shown read-only with the hint about creating a new unit, and `PATCH /api/units/{id}` with a different `use` returns 422.

### Tenants (TEN)
- **AC-TEN-01** An Individual tenant can be saved with only First name and Last name (no email or phone).
- **AC-TEN-02** Choosing Business requires Business name and Contact person. Saving without Contact person shows "Enter a contact person."
- **AC-TEN-03** An invalid email shows "Enter a valid email address."
- **AC-TEN-04** The tenant detail page lists every lease the tenant is on, with a Primary contact indicator.
- **AC-TEN-05** A tenant on any lease can't be deleted (**Delete tenant** is aria-disabled), but can be archived. An archived tenant isn't offered in the wizard's **Add existing tenant**.

### Leases (LEASE)
- **AC-LEASE-01** Completing the wizard with two tenants (one primary), start 2026-11-01, end 2027-10-31 and rent $2,150 opens the Lease detail with status "Upcoming" (today 2026-10-12), both tenants listed, and "Primary contact" on the chosen one.
- **AC-LEASE-02** Clicking **Next** on step 1 with no tenants shows "Add at least one tenant."
- **AC-LEASE-03** An end date on or before the start date shows "Lease end date must be after the start date."
- **AC-LEASE-04** For a Residential unit, step 3 requires **Children reside in unit**. For a Commercial unit the field isn't shown, while **Base tax year** and **Tenant's share of tax increase (%)** are.
- **AC-LEASE-05** With today set to 2026-11-15, the lease from AC-LEASE-01 shows status "Active", the unit shows "Occupied", and Current monthly rent shows "$2,150.00".
- **AC-LEASE-06** "Fixed percentage each year" at 3% on $2,000 from 2026-01-01 to 2028-12-31 shows a Rent schedule of $2,000.00 (2026), $2,060.00 (2027) and $2,121.80 (2028). With today 2027-01-01, Current monthly rent shows "$2,060.00".
- **AC-LEASE-07** A custom schedule with rows 2027-01-01 $2,100 and 2028-01-01 $2,200 shows Current monthly rent "$2,100.00" when today is 2027-06-01, and "$2,200.00" when today is 2028-01-01.
- **AC-LEASE-08** A custom schedule row dated outside the term shows "Effective date must fall within the lease term."
- **AC-LEASE-09** Creating a lease whose dates overlap the unit's current Active lease shows "This unit already has a lease for those dates." and offers **Replace current lease**.
- **AC-LEASE-10** With today one day after the effective end, and no extension, month-to-month or move-out, the lease shows status "Needs decision". It appears in the Dashboard table "Leases needing a decision", and the unit is still "Occupied".
- **AC-LEASE-11** **Mark month-to-month** on a Needs decision lease, with Month-to-month monthly rent $2,300, changes the status to "Month-to-month" and Current monthly rent to "$2,300.00". The lease leaves "Leases needing a decision".
- **AC-LEASE-12** **End lease** with Move-out date 2026-12-31 and Reason "Tenant moved out": on 2026-12-31 the status reads "Active · moving out Dec 31, 2026". On 2027-01-01 the status is "Ended" and the unit shows "Vacant" with Potential rent equal to the last rent.
- **AC-LEASE-13** **Delete lease** confirmed: the lease no longer appears in the unit's Lease history, and its generated PDFs' download endpoints return 404.
- **AC-LEASE-14** Commercial lease: property taxes 2020 $40,000 and 2025 $52,000, base tax year 2020, share 25%. Tax reimbursement (monthly) shows "$250.00" with the explanation "25% × (2025 tax $52,000.00 − 2020 tax $40,000.00) ÷ 12".
- **AC-LEASE-15** If the latest tax amount is lower than the base year's, Tax reimbursement (monthly) shows "$0.00".
- **AC-LEASE-16** Two users open the same lease edit form; the first saves; the second's save shows "Someone else changed this record. Reload to see the latest version." with button **Reload**.
- **AC-LEASE-17** Leaving the wizard mid-way with entered data prompts "Discard this lease? Your changes will be lost."
- **AC-LEASE-18** The `/leases` default filter hides Ended leases. Checking Status "Ended" shows them.
- **AC-LEASE-19** Replace: the unit's current lease runs 2026-11-01 to 2027-10-31. With today 2027-03-01, a new lease starting 2027-04-01 is saved with **Replace current lease** and Reason "Tenant broke lease". The old lease shows "Active · moving out Mar 31, 2027" and the new one "Upcoming". With today 2027-04-01, the old lease is "Ended" and the new one "Active".
- **AC-LEASE-20** Older lease: on a unit whose current lease starts 2026-11-01, a lease 2024-11-01 to 2025-10-31 with no move-out date saves, shows "Ended" (with no move-out date stored), appears in Lease history, and never appears under "Leases needing a decision" or in emails. A lease 2025-06-01 to 2026-12-31 on the same unit shows the overlap error with no Replace option.
- **AC-LEASE-21** Changing a lease's Monthly rent from $2,150 to $2,200 adds Version 2 to the Versions table with the summary "Monthly rent: $2,150.00 → $2,200.00", and the Version 1 view still shows $2,150.00.
- **AC-LEASE-22** A lease with an extension ending 2028-10-31 shows "Needs decision" with today 2028-11-01; the unit is "Occupied" and Current monthly rent equals the extension's rent on 2028-10-31.
- **AC-LEASE-23** **End lease** accepts any valid move-out date, including one before the lease start date.
- **AC-LEASE-24** A lease created with end date 2025-12-31 (today 2026-10-12) shows the optional Move-out date and Reason fields in step 2; leaving them empty saves a lease with status "Needs decision".
- **AC-LEASE-25** A lease ends 2027-10-31. On 2027-09-01 a new lease for the same unit starting 2027-12-01 is saved. From then on the old lease gets no "Leases ending soon" emails; on 2027-11-15 it shows "Ended" (not "Needs decision"), has no move-out date, and the unit shows "Vacant · leased from Dec 1, 2027".

### Extensions (EXT)
- **AC-EXT-01** **Add extension** on a lease ending 2027-10-31 pre-fills Extension start date 2027-11-01.
- **AC-EXT-02** Saving an extension to 2028-10-31 at $2,250 makes the Effective end date show "Oct 31, 2028". The Rent schedule includes the extension period at $2,250.00, and with today 2027-11-15 Current monthly rent is "$2,250.00".
- **AC-EXT-03** An extension start date earlier than the previous effective end + 1 day shows "Extension must start on or after Nov 1, 2027."
- **AC-EXT-04** Adding an extension to a Month-to-month lease sets its status to "Active" (when today is within the extension).
- **AC-EXT-05** Only the latest extension has **Edit** and **Delete** actions.
- **AC-EXT-06** **Add extension** isn't shown on an Ended lease, or on one with a move-out date.
- **AC-EXT-07** An extension that removes one of two tenants and adds a new tenant saves; with today inside the extension, the lease detail Tenants section shows the extension's tenants. An extension that keeps only tenants who weren't on the master lease shows "At least one tenant from the original lease must stay. To change all tenants, end this lease and create a new lease." and isn't saved.
- **AC-EXT-08** A lease with parking charge $100 gets an extension with parking charge $150. With today inside the master term, Other income shows $100.00; with today inside the extension, $150.00.
- **AC-EXT-09** Adding an extension by changing only the end date and Monthly rent (leaving **Change other terms** closed) saves an extension whose tenants, deposit, due day, late fee, parking, tax and special terms equal the previous term's. An extension PDF from a template using `{{pets}}` prints the extension's Pets value when it was changed in the extension.

### Templates (TPL)
- **AC-TPL-01** Creating a template "Standard residential lease" of type Master lease with text and an inserted [Tenant names] chip shows "Template saved." It appears in `/templates` for every landlord.
- **AC-TPL-02** Pasting text containing `{{monthly_rent}}` into the editor converts it into a [Monthly rent] chip.
- **AC-TPL-03** Pasting `{{not_a_key}}` leaves it as text and shows "Unrecognised placeholders: {{not_a_key}}". **Save template** then shows "Fix the unrecognised placeholders before saving." and nothing is saved. Pasting `{{extension_start_date}}` into a Master lease template is listed the same way, with "(only available in Lease extension templates)".
- **AC-TPL-04** In a Master lease template, **Insert placeholder** doesn't list "Extension start date". In a Lease extension template, it does.
- **AC-TPL-05** **Preview PDF** opens a new tab, which then loads a PDF; the test reads the PDF from the tab's URL and its text includes the sample tenant names from Appendix B.
- **AC-TPL-06** Saving a template with an empty name shows "Enter a template name."; a duplicate name shows "A template with this name already exists."
- **AC-TPL-07** An archived template isn't offered in the wizard's **Lease template** select, or in **Generate PDF** on a lease that never used it.
- **AC-TPL-08** Every toolbar control is reachable by Tab and operable with Enter/Space, and has the accessible name listed in §11.20.
- **AC-TPL-09** Pasting the clipboard HTML fixture `tests/acceptance/fixtures/word-lease.html` leaves no image, header or link in the editor, shows "Some content was removed: …", keeps the table, and turns a `{{tenant_names}}` key split across formatting runs into a [Tenant names] chip. The fixture is written by the test-authoring step to match the HTML that Microsoft Word puts on the clipboard (Office HTML with `mso-` styles, `<o:p>` elements, conditional comments, an image, a header, a table, a hyperlink and a split key). The owner may replace it with a real Word copy later (§15.5).
- **AC-TPL-10** After a PDF is generated from template T, **Delete template** on T is unavailable with the description "Templates used for generated PDFs can only be archived". After archiving T, the Generate PDF dialog lists "T (archived)" on that lease but not on other leases.
- **AC-TPL-11** A preview requested by one landlord returns 404 from `GET /api/previews/{id}` for another landlord.

### Generated documents (DOC)
- **AC-DOC-01** **Save and generate PDF** with a template adds a Documents row with status "Generating…", which becomes "Ready" within 60 seconds without reloading the page.
- **AC-DOC-02** **Download** on a Ready row downloads a file whose name (as suggested by the browser) is `Lease - {Property name} {Unit} - {start}.pdf`. Its text contains the tenant names, "$2,150.00", the property address, and the footer "Page 1 of".
- **AC-DOC-03** `GET /api/documents/{id}/download` returns `expiresAt` 5 minutes after the request, and the URL's expiry parameter is 300 seconds. A slow test waits 5 minutes 10 seconds of real time and then gets 403 from storage for that URL.
- **AC-DOC-04** After editing the template text and the lease rent, the earlier PDF downloads with the same SHA-256 hash and the same extracted text as before.
- **AC-DOC-05** When the selected template uses a placeholder with no value (e.g. Pets is empty), the dialog lists "Pets" under "These items are empty and will print as blank lines:", and the PDF contains "__________" in its place.
- **AC-DOC-06** Generating from an extension produces `Lease extension - … .pdf` whose text includes the extension start date, end date and new monthly rent.
- **AC-DOC-07** **Delete** then **Delete PDF** removes the row, and `GET /api/documents/{id}/download` returns 404.
- **AC-DOC-08** A signed-out request to `GET /api/documents/{id}/download` returns 401.
- **AC-DOC-09** A forced rendering failure (`POST /api/test/fail-next-pdf`) shows status "Failed" with a **Try again** button. Clicking it returns the row to "Generating…" and then "Ready", and the PDF reflects the data at the time of the original request even if the lease was edited in between.
- **AC-DOC-10** For a property named `12/14 Main St`, the master lease PDF for unit 2R starting 2026-11-01 downloads as `Lease - 12-14 Main St 2R - 2026-11-01.pdf`.
- **AC-DOC-11** An extension PDF from a template containing `{{tenant_names}}`, `{{removed_tenant_names}}` and `{{added_tenant_names}}` prints the extension's tenants, the removed tenant and the added tenant respectively.

### Compliance (CMP)
- **AC-CMP-01** A fresh install lists the nine seeded item types from §9.1 on the Item types tab, with the notice text.
- **AC-CMP-02** An NYC property created without units shows "HPD Property Registration" as "Not applicable". After adding a Residential unit, it becomes applicable with a due date of the next Sep 1. A non-NYC property with only Commercial units shows both HPD and "Storefront Registry Filing" as "Not applicable".
- **AC-CMP-03** With today 2026-10-12, a new NYC residential property shows "Bed Bug Annual Filing" due "Dec 31, 2026", status "Upcoming". "Smoke and CO Detector Check" shows "Not scheduled".
- **AC-CMP-04** Turning off **Applies to this property** hides the item from the default Due list, and from Dashboard compliance tables and emails.
- **AC-CMP-05** **Mark done** on Bed Bug Annual Filing (due 2026-12-31) on 2026-12-15 suggests Next due date 2027-12-31. After saving, Last completed shows "Dec 15, 2026" and the History dialog lists the completion.
- **AC-CMP-06** **Mark done** on an every-12-months item on 2026-10-12 suggests 2027-10-12.
- **AC-CMP-07** An item due 2026-10-01 with today 2026-10-12 shows status "Overdue" and appears in the Dashboard's "Overdue compliance" table.
- **AC-CMP-08** Creating item type "Elevator inspection" (All properties, not NYC only, every 12 months) adds it to every property's Compliance tab, as applicable and "Not scheduled" for properties with at least one unit, and "Not applicable" for properties with no units.
- **AC-CMP-09** Item type Schedule "Same date every year" without Month and Day shows "Choose a month and day."
- **AC-CMP-10** Filtering the Due list by Responsible landlord shows only items for properties where that landlord is one of the responsible landlords.
- **AC-CMP-11** After an editor switches HPD off for an NYC residential property, adding another Residential unit leaves it switched off.
- **AC-CMP-12** **Mark done** on 2026-10-12 for an annual item last due 2024-09-01 suggests 2027-09-01.
- **AC-CMP-13** **Mark done** on 2027-01-31 for an every-1-month item suggests 2027-02-28.
- **AC-CMP-14** Deleting an item type with no completions removes it from every property's Compliance tab; the properties are otherwise unchanged.
- **AC-CMP-15** A one-time item with a completion and no next due date shows "Completed" (not "Not scheduled").

### Email reminders (EML)
- **AC-EML-01** With today set 30 days before a compliance item's due date, running the daily job sends the property's responsible landlord one email with subject "RentNerd: 1 item(s) need attention – {date}". Its body contains the property name, "Compliance due soon" and "{Item name} – due {date}".
- **AC-EML-02** Running the daily job twice on the same day sends no second email.
- **AC-EML-03** With the job run once on each day in sequence: at 30 days before due the item is sent; at 29 days before due (the next day) the job sends nothing for that item; at 7 days before due it is included again.
- **AC-EML-04** An item 14 days overdue appears under "Overdue compliance" as "{Item name} – overdue since {date}".
- **AC-EML-05** With the job run once on each day in sequence: a lease whose effective end is 90 days away appears under "Leases ending soon" with "(90 days)"; on the next day (89 days) it isn't included.
- **AC-EML-06** A Needs decision lease appears under "Leases needing a decision" 1 day after the end, then again 8 days after the end.
- **AC-EML-07** When the job doesn't run on the 30-day threshold day but runs the next day, that next day's email includes the item with its actual days left.
- **AC-EML-08** A landlord responsible for nothing due receives no email. Items for two properties assigned to two different landlords produce two separate emails, each containing only that landlord's properties. A property with two responsible landlords appears in both landlords' emails.
- **AC-EML-09** Items for a property whose only responsible landlord was deactivated go to the Admin (by reassignment).
- **AC-EML-10** Archived properties, units and leases, archived item types and not-applicable items never appear in emails.
- **AC-EML-11** Every email's From address uses the domain mail.rentnerd.xyz (the `MAIL_FROM` value), and each message has both text/plain and text/html parts.
- **AC-EML-12** Each lease line in the daily email links to that lease's page, and each compliance line to its property's Compliance tab; opening a link while signed in shows that page (signed out: after sign-in).
- **AC-EML-13** If the digest email fails permanently (`POST /api/test/fail-next-email`, failing all retries), the next day's run includes the same items.
- **AC-EML-14** The smoke user can't be made a responsible landlord: `PATCH /api/properties/{id}` with the smoke user in `responsibleUserIds` returns 422.

### Dashboard and statistics (DASH)
Fixture: property A (NYC; market estimate $1,000,000), units A1 occupied at $2,000 with parking $100, A2 occupied at $3,000, A3 vacant with last rent $1,500. Property B (no value), unit B1 occupied at $1,000.
- **AC-DASH-01** The Portfolio summary shows Units 4, Occupied 3, Vacant 1, Occupancy "75.0%", Monthly rent roll "$6,000.00", Annual rent roll "$72,000.00", Monthly other income "$100.00", Vacancy loss (monthly) "$1,500.00", Portfolio value "$1,000,000.00".
- **AC-DASH-02** In the By property table, A's Gross yield is "6.12%" (12 × 5,100 ÷ 1,000,000), and B's Gross yield is "—".
- **AC-DASH-03** The portfolio Gross yield is "6.12%", with the note "Based on 1 of 2 properties with a value."
- **AC-DASH-04** A lease ending in 45 days appears in "Leases ending in the next 90 days" with Days left 45, and a lease with a move-out date 30 days away appears with Days left 30. A lease ending in 120 days, a Month-to-month lease and an Upcoming lease don't appear.
- **AC-DASH-05** A Month-to-month lease counts as occupied and doesn't appear in "Leases needing a decision".
- **AC-DASH-06** An Upcoming lease's unit counts as vacant, and the Units tab shows "Vacant · leased from {date}".
- **AC-DASH-07** A Needs decision lease counts as occupied, and its last known rent is included in the monthly rent roll.

### Investments (INV)
- **AC-INV-01** Adding an entry (Date 2026-09-01, Property A, Unit "Whole property", Category Appliance, Description "Replace fridge", Vendor "AJ Madison", Cost $1,250) shows "Entry saved." and the row appears in `/investments`.
- **AC-INV-02** Filtering by Property A and Category Appliance updates the Total to the sum of the matching rows.
- **AC-INV-03** Property detail shows Total invested equal to the sum of that property's entries.
- **AC-INV-04** Choosing a property limits the Unit select to that property's units.
- **AC-INV-05** **Delete** with confirmation removes the entry, and the totals update.

### Import (IMP)
- **AC-IMP-01** **Download template** downloads `rentnerd-import-template.xlsx` containing the sheets Instructions, Owners, Properties, Units, Tenants and Leases.
- **AC-IMP-02** Uploading a valid template with 1 owner, 1 property, 2 units, 2 tenants and 1 lease and clicking **Check file** shows "Ready to import: 1 owners, 1 properties, 2 units, 2 tenants, 1 leases."
- **AC-IMP-03** Clicking **Import** shows "Import complete." The new property, units, tenants and lease appear in their lists, and the property has its applicable compliance items.
- **AC-IMP-04** A file where a Units row references an unknown Property key lists the problem with Sheet "Units", the row number, Column "Property key" and Problem "No property with key 'X' in the Properties sheet." No data is imported.
- **AC-IMP-05** A file with any error imports nothing, even if other rows are valid (counts on the list screens are unchanged).
- **AC-IMP-06** A non-.xlsx file shows "Choose an .xlsx file." A file over 5 MB shows "The file must be 5 MB or smaller."
- **AC-IMP-07** A Properties row whose name matches an existing non-archived property is listed as "A property with this name already exists."
- **AC-IMP-08** A Leases row for a Residential unit without "Children reside in unit" is listed with that column and the field's normal error message.
- **AC-IMP-09** If, between **Check file** and **Import**, someone creates a property with the same name as one in the file, **Import** shows the problems table and imports nothing.

### Audit (AUD)
- **AC-AUD-01** After a landlord changes a lease's Monthly rent from $2,150 to $2,200, the Admin's Activity log shows a row with that landlord's name, Action "Updated", Record "Lease – {property} Unit {label}", and Show changes listing "Monthly rent: $2,150.00 → $2,200.00".
- **AC-AUD-02** Sign-in success and failure, invitation, deactivation, PDF generation, PDF download, PDF deletion and import each produce an Activity log row.
- **AC-AUD-03** Filtering the Activity log by User shows only that user's actions.
- **AC-AUD-04** There is no UI or API to edit or delete audit rows. `DELETE /api/audit-log/{id}` returns 404 or 405.
- **AC-AUD-05** No audit row's `changes` contains a password, password hash, token or session ID (checked after the password change, reset and invitation tests).

### API (API)
- **AC-API-01** Any `/api/*` request other than `/api/health`, `/api/auth/*` and the public invitation routes (`/api/invitations/lookup`, `/api/invitations/accept`), made without a session, returns 401 with body `{"error":{"code":"UNAUTHENTICATED","message":…}}`.
- **AC-API-02** `POST /api/properties` with a missing name returns 422 with `error.code` "VALIDATION_ERROR" and `error.fields.name` present.
- **AC-API-03** `GET /api/tenants?page=2&pageSize=10` returns `{data:[…≤10], page:2, pageSize:10, total:N}`. A pageSize over 200 returns 422.
- **AC-API-04** `PATCH` with a stale `version` returns 409 with `error.code` "CONFLICT".
- **AC-API-05** `GET /api/properties/{random uuid}` returns 404 with `error.code` "NOT_FOUND".
- **AC-API-06** State-changing requests (POST/PATCH/PUT/DELETE) with a foreign `Origin` header, or with no `Origin` header, are rejected with 403.

### Accessibility (A11Y)
- **AC-A11Y-01** An axe-core scan (WCAG 2.0/2.1/2.2 A and AA rules) reports zero violations for every route in §11, loaded with the Dashboard fixture, plus every form after an empty submit and every dialog open; the tests list these states from the spec. A crawl that follows every in-app link reachable from the Dashboard fixture (as Admin) fails if it reaches a page whose path doesn't match a §11 route.
- **AC-A11Y-02** For every screen, an automated keyboard-only test completes its main task (save the form, or open, confirm and close its dialogs) using only Tab, Shift+Tab, Enter, Space, Escape and arrow keys. Every focusable element shows a focus indicator at least 2 px thick whose colour has at least 3:1 contrast with the adjacent background (computed from styles).
- **AC-A11Y-03** The first Tab on any page focuses "Skip to main content", and activating it moves focus to `<main>`.
- **AC-A11Y-04** Opening a dialog moves focus into it, Escape closes it, and focus returns to the control that opened it.
- **AC-A11Y-05** After a failed submit, focus moves to the "There is a problem" summary, and each field error is linked via `aria-describedby`.
- **AC-A11Y-06** Status messages ("… saved.", PDF status changes) are inserted into an `aria-live="polite"` region (checked in the page, not with a screen reader).
- **AC-A11Y-07** At a 320 CSS px viewport width, no page needs horizontal scrolling except data tables, which scroll inside their own region (WCAG 1.4.10).
- **AC-A11Y-08** Buttons, form controls, navigation links and table action links are at least 24×24 CSS px (WCAG 2.5.8; links inside sentences are exempt, as the standard allows).
- **AC-A11Y-09** Status badges convey status with text, not color alone.
- **AC-A11Y-10** Each page has a unique title of the form "{Page} – RentNerd", and exactly one `<h1>`.
- **AC-A11Y-11** **(manual)** Before the first release, a person completes the lease wizard and the template editor using only the keyboard and with a screen reader (VoiceOver on Safari, NVDA on Edge), on the latest Safari and Edge.

## 14. API

### 14.1 Conventions
- Base path `/api`, JSON only (`Content-Type: application/json`) except the import upload (multipart) and auth routes.
- **Auth**: Better Auth at `/api/auth/*` (sign-up disabled). Every other route requires a valid session cookie, except `GET /api/health`. Deactivated and invited users are rejected as 401. Admin-only routes return 403 to landlords. Every POST/PATCH/PUT/DELETE by the Smoke user returns 403 (except sign-out). POST/PATCH/PUT/DELETE requests whose `Origin` header is missing or isn't the app URL return 403.
- **Client IP** (rate limits and the Activity log) is taken from Fly's `Fly-Client-IP` header in production and from the socket address elsewhere; `X-Forwarded-For` is ignored.
- **IDs**: UUID. **Money**: integer cents in fields suffixed `Cents`. **Percent**: decimal string, e.g. `"3.0000"`. **Dates**: `YYYY-MM-DD`. **Timestamps**: ISO 8601 UTC.
- **Pagination** on list endpoints: `?page` (default 1) and `?pageSize` (default 50, max 200). Response: `{ "data": [...], "page": 1, "pageSize": 50, "total": 123 }`. Sorting: `?sort=<field>&order=asc|desc`. Filters are documented per endpoint as query params. `?archived=true` includes archived records.
- **Updates**: `PATCH` with partial body plus the required `version`. Responses return the full updated record.
- **Errors**: `{ "error": { "code": "<CODE>", "message": "<human readable>", "fields": { "<field>": "<message>" } } }` (`fields` is present only for validation errors).

| HTTP | code |
|---|---|
| 400 | BAD_REQUEST |
| 401 | UNAUTHENTICATED |
| 403 | FORBIDDEN |
| 404 | NOT_FOUND |
| 409 | CONFLICT (version mismatch, or a uniqueness or state rule) |
| 413 | PAYLOAD_TOO_LARGE |
| 422 | VALIDATION_ERROR |
| 429 | RATE_LIMITED |
| 500 | INTERNAL |

### 14.2 Resources
| Resource | Endpoints |
|---|---|
| Health | `GET /health` |
| Me | `GET /me`, `PATCH /me` (name) |
| Users (Admin) | `GET /users`, `POST /users/{id}/deactivate`, `POST /users/{id}/reactivate` |
| People | `GET /people` (all signed-in users): active Admin/Landlord users' id, name, email |
| Invitations | `GET /invitations` (Admin), `POST /invitations` (Admin), `POST /invitations/{id}/resend` (Admin), `POST /invitations/{id}/revoke` (Admin), `GET /invitations/lookup?token=` (public, rate-limited), `POST /invitations/accept` (public, rate-limited: token, name, password) |
| Owners | `GET/POST /owners`, `GET/PATCH/DELETE /owners/{id}`, `POST /owners/{id}/archive`, `/restore` |
| Properties | `GET/POST /properties`, `GET/PATCH/DELETE /properties/{id}`, `/archive`, `/restore`; `GET/POST /properties/{id}/values`, `PATCH/DELETE /property-values/{id}`; `GET/POST /properties/{id}/taxes`, `PATCH/DELETE /property-taxes/{id}`; `GET /properties/{id}/compliance` |
| Units | `GET/POST /properties/{id}/units`, `GET/PATCH/DELETE /units/{id}`, `/archive`, `/restore` |
| Tenants | `GET/POST /tenants`, `GET/PATCH/DELETE /tenants/{id}`, `/archive`, `/restore` |
| Leases | `GET /leases` (filters: status (repeatable), propertyId, unitId, tenantId, archived), `POST /units/{id}/leases` (body may include `replaceCurrentLease: {endReason}`), `GET/PATCH/DELETE /leases/{id}`, `POST /leases/{id}/month-to-month`, `POST /leases/{id}/end`, `GET /leases/{id}/rent-schedule`, `GET /leases/{id}/versions`, `GET /leases/{id}/versions/{n}` |
| Extensions | `POST /leases/{id}/extensions`, `PATCH/DELETE /extensions/{id}` |
| Documents | `GET /leases/{id}/documents`, `POST /leases/{id}/documents` (`{templateId, extensionId?}`), `GET /documents/{id}` (status), `POST /documents/{id}/retry`, `GET /documents/{id}/download` → `{url, expiresAt}`, `DELETE /documents/{id}` |
| Templates | `GET/POST /templates`, `GET/PATCH/DELETE /templates/{id}`, `/archive`, `/restore`, `POST /templates/{id}/preview` → document-like status resource at `GET /previews/{id}` (404 for anyone but the requester) |
| Placeholders | `GET /placeholders?kind=` |
| Compliance | `GET/POST /compliance/types`, `PATCH/DELETE /compliance/types/{id}`, `/archive`, `/restore`; `GET /compliance/items` (filters: propertyId, status, responsibleUserId), `PATCH /compliance/items/{id}` (applicable, nextDueDate, notes); `POST /compliance/items/{id}/completions`, `GET /compliance/items/{id}/completions`, `DELETE /compliance/completions/{id}` |
| Investments | `GET/POST /investments` (filters: propertyId, category, from, to; response adds `totalCents`), `PATCH/DELETE /investments/{id}` |
| Dashboard | `GET /dashboard` |
| Import | `GET /import/template`, `POST /import/validate` (multipart) → `{importRunId, errors[], counts}`, `POST /import/{importRunId}/commit` |
| Audit (Admin) | `GET /audit-log` (filters: userId, entityType, from, to) |
| Test-only (D-25, D-33) | `POST /test/clock` (set or clear the offset), `POST /test/jobs/daily-digest`, `POST /test/jobs/backup`, `POST /test/jobs/cleanup`, `POST /test/reset`, `POST /test/fail-next-pdf`, `POST /test/fail-next-email` |

## 15. Operations

### 15.1 Processes and jobs
- **web**: Hono API + static SPA, on port 8080. On boot it ensures, idempotently (D-34): the Admin exists (D-05); the smoke user exists with role `smoke`, verified, and its password matches `SMOKE_USER_PASSWORD`; and the seeded compliance catalog exists (inserting only missing seeded types).
- **worker**: pg-boss queues `email.send`, `pdf.render`, `preview.render`. Schedules, **all in America/New_York**:
  - `digest.daily` at 08:00
  - `backup.nightly` at 02:00
  - `cleanup.daily` at 03:00: purges previews > 24 h, expired invitations and verification rows > 30 days, expired sessions, backups > 30 days, expired import files and import runs > 30 days, email and reminder logs > 2 years, and clears audit IPs > 2 years
- The worker starts Chromium once and reuses it, with one page per job and a concurrency of 2. It restarts Chromium after 100 jobs or any crash.

### 15.2 Environment variables
The production secrets listed in §4. Plus one new production secret, set once by the owner before the first deploy: `fly secrets set ADMIN_EMAIL=<owner's email> -a rentnerd-app` (in addition to the §4 list). Non-secret values in `fly.toml`: `APP_URL=https://rentnerd-app.fly.dev`, `NODE_ENV=production`, `TZ=UTC`. In production the web process refuses to start without `ADMIN_EMAIL`. Tests use `ADMIN_EMAIL=admin@example.test`, `NODE_ENV=test`, a database whose name ends in `_test`, and `ENABLE_TEST_ROUTES=true`. Locally, `.env` points to Docker Compose Postgres, Mailpit (SMTP 1025, UI 8025) and MinIO.

### 15.3 Bootstrapping the admin (automatic)
Before the first deploy, the owner sets the `ADMIN_EMAIL` secret (§15.2). On the first deploy, the web process creates the Admin from it and emails the invitation (§10.1, D-05). The admin opens the link, chooses a name and password, and is signed in. If the link expires (7 days) before it is used: `fly ssh console -a rentnerd-app -C "node dist/cli.js resend-admin-invite"`. The CLI does nothing once the admin is active.

### 15.4 CI/CD
GitHub Actions on every push to main runs: typecheck, lint, Vitest unit tests (rent, tax, status, date arithmetic and reminder-threshold calculations), then the Playwright acceptance suite (§13) against Docker Compose services with `ENABLE_TEST_ROUTES=true`, **in Chromium only and without the tests tagged `@slow`** (tests expected to take over a minute: the 5-minute signed-URL wait, the scale/performance check and the permanent email-failure retry), including the axe scans and the backup restore drill. This keeps the private repository within its free Actions minutes. The **full run** — every test, including `@slow`, in Chromium, Firefox and WebKit — happens only locally with `VERIFY_ALL=1 ./scripts/verify.sh`, at least once before the first release (task plan) and whenever a build session works on a task whose own tests are `@slow`. There is no pull-request workflow: Claude pushes directly to main. When all jobs pass, it runs `flyctl deploy`. After deploy, the read-only production smoke test (D-24) runs against https://rentnerd-app.fly.dev using the `SMOKE_USER_EMAIL` and `SMOKE_USER_PASSWORD` GitHub secrets; if it fails, the previous release is redeployed and the run fails.

### 15.5 Independent acceptance tests (build order)
The build runs autonomously in these steps. Each **session** is a separate Claude Code session started fresh by the run loop, with no conversation history from any other session.

1. **Test authoring** (one session, before any app code exists). Inputs: this spec only. Outputs, all under `tests/acceptance/` (so they are locked and restored with the tests):
   - one or more Playwright tests per AC in §13 (except **(manual)** ones), each test's title starting with its AC id (e.g. `AC-LEASE-19 …`);
   - the production smoke test (D-24) as `tests/acceptance/smoke.prod.spec.ts`, run only after deploy;
   - its own `playwright.config.ts`, helpers (API client, Mailpit and MinIO clients, PDF text extraction, test-clock helper, data builders for every fixture) and `COVERAGE.md` (a table mapping every AC to its tests);
   - `tests/acceptance/fixtures/word-lease.html` (AC-TPL-09) and the xlsx files for the IMP criteria.
   Rules for the tests:
   - They may depend only on what this spec states: routes, page titles, headings, labels, button names, messages, API paths and bodies, email subjects and contents, file names. Elements are found by accessible role, label or visible text (`getByRole`, `getByLabel`, `getByText`); no CSS classes, `data-testid`s or DOM structure the spec doesn't define.
   - They never import or read app source code (`src/`), and never touch the database directly; data is created through the API or UI.
   - Where the spec allows several behaviours, the test accepts all of them; it never asserts anything the spec doesn't require.
   - They must typecheck and list cleanly (`npx playwright test --list`), although they can't pass until the app exists.
2. **Test review** (a second fresh session). Inputs: this spec and the tests (no author notes). It checks that every non-manual AC is covered, that no test is weaker or stricter than its AC, and that the rules above are followed; it fixes problems directly and records what it changed at the end of `COVERAGE.md`. Then it commits and pushes the tests and writes `READY` to `tests/acceptance/REVIEW_STATUS`. The **run loop** (not a Claude session) then creates the git tag `acceptance-locked` on that commit and pushes it. Sessions never create or move acceptance tags; the guard hook blocks any command that mentions them.
3. **Build** (the run loop's repeating sessions). Builds the app to this spec. Build sessions may read and run the tests but never change them (D-33). Their Vitest unit tests live under `src/` and are theirs to write.
4. **Dispute** (only when needed). If a build session believes a locked test contradicts the spec, it records the test, the failure output and its reasoning in `PROGRESS.md` under "Disputed tests", marks that work blocked, and carries on with other work. The run loop then starts a fresh **adjudicator** session with this spec, the disputed test and the failure output. If the test contradicts the spec, the adjudicator fixes only that test, logs the change in `tests/acceptance/CHANGELOG.md`, commits and pushes; the run loop then re-locks the tests with a new tag (lock mechanics below). If the app is wrong, it says so in `PROGRESS.md`. If the spec is genuinely ambiguous, it picks the reading closest to the owner's decisions in Appendix C and records it in Appendix D for the owner to review later.

**Lock mechanics.** The run loop doesn't exist yet; the owner will create it, and update the guard hook, at a later stage, before the autonomous build starts. Until then, steps 1–4 can't run as described. Agreed requirements:
- **Current guard (in place now):** `scripts/guard.sh` blocks every edit to `tests/acceptance/`, and any command that mentions `acceptance-locked`, for all sessions.
- **Run loop (to be created by the owner):** it starts each session fresh with an environment variable `RENTNERD_ROLE` set to `test-author`, `test-reviewer`, `builder` or `adjudicator`. Sessions can't change it, because hooks run in the run loop's environment, not the session's shell. It runs the steps in order, and it alone creates the acceptance tags (sessions can't, because of the guard). Each re-lock gets a new tag rather than moving the old one: `acceptance-locked` first, then `acceptance-locked-2`, `acceptance-locked-3`, …. Before every build iteration it restores `tests/acceptance/` from the highest-numbered tag.
- **Guard update (to be made by the owner with the run loop):** allow edits under `tests/acceptance/` only when `RENTNERD_ROLE` is `test-author`, `test-reviewer` or `adjudicator`. For every role, also block edits to `scripts/guard.sh`, `.claude/settings.json` and the run-loop script, so no session can switch the lock off. Keep blocking commands that mention acceptance tags.

**Harness contract** (shared by the tests and the app, so neither depends on the other's internals):
- The app is built with `npm ci && npm run build`. The tests start and stop the processes themselves: web `node dist/server.js` on `http://localhost:8080`, worker `node dist/worker.js`, and the CLI `node dist/cli.js`, using the environment in `tests/acceptance/test.env`.
- Docker Compose (`docker compose up -d`) provides Postgres on `localhost:5432` (user `rentnerd`, password `rentnerd`, test database `rentnerd_test`), Mailpit (SMTP `localhost:1025`, API `http://localhost:8025`) and MinIO (`http://localhost:9000`, user `minio`, password `minio12345`, bucket `rentnerd-test`). The build step writes `docker-compose.yml` to match.
- `tests/acceptance/test.env` (written by the test-authoring step) sets `NODE_ENV=test`, `ENABLE_TEST_ROUTES=true`, `APP_URL=http://localhost:8080`, `ADMIN_EMAIL=admin@example.test`, `SMOKE_USER_EMAIL=smoke@example.test`, `SMOKE_USER_PASSWORD`, `DATABASE_URL`, the `AWS_*` and `BUCKET_NAME` values for MinIO, `SMTP_HOST`/`SMTP_PORT` for Mailpit and `MAIL_FROM=RentNerd <noreply@mail.rentnerd.xyz>`. Tests that need other values (AC-PLAT-04/07/08) override them when starting the processes.
- The app creates its schema with `node dist/migrate.js`, which the tests run before starting the web process.

## 16. Non-functional requirements

- **Scale**: ≤ 25 users, ≤ 100 properties, ≤ 400 units, ≤ 5,000 leases, ≤ 10,000 generated PDFs. A single shared-CPU web machine and a single worker machine are sufficient.
- **Performance**: API p95 < 500 ms at this scale. Dashboard < 1 s. PDF ready < 30 s typical (60 s max under test).
- **Accessibility**: WCAG 2.2 Level AA across all screens (see the A11Y criteria). Generated PDFs are print documents and are exempt from PDF/UA tagging, but each has a document title set.
- **Browsers**: latest two versions of Chrome, Edge, Firefox and Safari; responsive down to 320 px wide. CI runs the suite in Chromium; the full local run (`VERIFY_ALL=1`, §15.4) adds Firefox and WebKit; Edge and Safari themselves are checked manually before the first release (AC-A11Y-11).
- **Scale fixture**: 25 users, 100 properties, 400 units and 5,000 leases, created by the acceptance tests through the normal API, used by AC-PLAT-11. (Generated documents are left out because rendering 10,000 PDFs would make the suite too slow; document lists are paginated and per-lease, so they don't affect the measured endpoints.)
- **Security**: HTTPS only (Fly). Security headers: CSP `default-src 'self'`, `X-Content-Type-Options`, `Referrer-Policy: same-origin`, `frame-ancestors 'none'`. Passwords are hashed by Better Auth (scrypt). Roles are enforced server-side. Template HTML is generated from TipTap JSON (no raw HTML input), limited to §8.4 content, and sanitised before rendering; PDF rendering has no network access (§8.2). Bucket objects are private.
- **Rate limits** (429 `RATE_LIMITED`; the UI shows "Too many attempts. Try again in a few minutes."): sign-in as D-08; forgot-password: at most 3 emails per address per hour and 20 requests per IP per hour (the on-screen message never changes); reset-password and invitation lookup/accept: 20 requests per IP per 15 minutes; import validation: 10 per user per hour.
- **Audit logging**: as in §6.16. Audit rows are retained indefinitely.
- **Backups**: nightly `pg_dump` to the bucket, kept 30 days (D-26), plus provider backups if any. Generated PDFs are not separately backed up (they can be regenerated from snapshots).
- **Data retention**:
  - Business records are kept indefinitely (archived, not deleted).
  - Generated PDFs are kept until manually deleted.
  - Previews: 24 h.
  - Invitations and verification tokens: purged 30 days after expiry.
  - Sessions: purged after expiry.
  - Email log and reminder log: 2 years.
  - Audit log: indefinite (IP addresses cleared after 2 years).
  - Import runs (including uploaded files and error reports): file cleared at commit or after 24 h; run purged after 30 days.
  - Deactivated users: kept indefinitely.
- **Time zone**: all date logic in America/New_York, with timestamps displayed as ET.
- **Reliability**: jobs are retried (emails 5×, PDFs 3×). The daily digest is idempotent and catches up after missed runs.

## 17. Out of scope

- Tenant accounts, tenant portal, or emailing documents to tenants.
- Rent collection, online payments, rent ledger, arrears tracking, late-fee calculation.
- Expense tracking and accounting beyond the investment log; accounting/bank integrations; tax reports.
- File uploads (receipts, photos, scanned signed leases).
- Electronic signatures.
- Charts and graphs; any PDF or export other than leases and extensions; CSV/Excel export.
- Rent stabilization / rent-regulation rules.
- Per-landlord or per-property permissions; multiple organisations; public sign-up; billing.
- Changing a user's email address; two-factor authentication; single sign-on (sign in with Google is a candidate for a later version).
- Per-landlord data restrictions, a second admin, or transferring the admin role (accepted for now; Appendix C, #50, #52).
- Erasing a tenant's personal data (tenants are archived, never deleted, once on a lease).
- Warranty tracking.
- SMS or push notifications; per-item reminder emails; configurable reminder schedules (they are fixed in §10.5).
- Importing extensions, rent-step schedules, values, taxes or compliance history from spreadsheets; updating existing records via import.
- Legal accuracy of the compliance catalog (it's informational only).
- Languages other than English; currencies other than USD.
- Mobile apps (the web app is responsive).

---

## Appendix A — Converting a Word lease into a RentNerd template (offline steps)

1. Open your existing lease in Microsoft Word. (If you only have a PDF, open the PDF in Word first: **File → Open**, choose the PDF, and accept the conversion. Check the result for errors.)
2. Remove anything that varies per tenant, and type the matching `{{key}}` from §8.1 in its place. For example, replace "John and Jane Smith" with `{{tenant_names}}`, and "$2,150" with `{{monthly_rent}}`. Keep a printed copy of the key list beside you.
3. Signature lines: replace the tenant signature area with `{{tenant_signature_blocks}}`, and type the owner block as normal text using `{{owner_name}}` and `{{owner_signatory}}`.
4. Remove headers, footers, logos, images and page numbers. (RentNerd strips them anyway when you paste, and adds its own footer with page numbers.)
5. In Word press **Ctrl+A** (Mac: **⌘A**) then **Ctrl+C** (**⌘C**).
6. In RentNerd go to **Templates → New template**. Enter a **Template name**, choose the **Template type**, click in the editor and paste (**Ctrl+V** / **⌘V**).
7. Check the warning "Unrecognised placeholders" and fix any misspelled keys, either by retyping or with **Insert placeholder**. You can't save until every placeholder is recognised.
8. Fix headings, bold text and numbered clauses with the toolbar if the paste lost them. Insert **Page break** where you want a new page.
9. Click **Preview PDF** and compare it with your original. Repeat until it's right, then **Save template**.
10. Create a separate **Lease extension** template the same way, using the extension keys (`{{extension_start_date}}`, `{{extension_end_date}}`, `{{extension_monthly_rent}}`, `{{previous_end_date}}`, `{{previous_monthly_rent}}`, `{{previous_tenant_names}}`, `{{removed_tenant_names}}`, `{{added_tenant_names}}`). In an extension template, the ordinary keys such as `{{tenant_names}}` and `{{monthly_rent}}` print the extension's values (§8.1).

## Appendix B — Template preview sample data
Owner "Sample Holdings LLC", 100 Example Ave, Brooklyn, NY 11201, signatory "Alex Owner, Managing Member". Property "100 Example Ave", Unit "2R" (Residential). Tenants "Jordan Sample" (primary, jordan@example.com, 555-0100) and "Casey Sample". Lease 2027-01-01 to 2027-12-31, monthly rent $2,500.00, 3% annual increase, deposit $2,500.00, due day 1, late fee $50.00 after 5 days, pets "One cat", parking "Space #4", parking charge $150.00, children reside "No", break clause "None", other terms "Tenant pays electricity." Extension 2028-01-01 to 2028-12-31 at $2,600.00. Commercial fields: base tax year 2024, share 25%.

## Appendix C — Owner decisions from the 2026-10-12 review

Answers given by the owner to the review of v1.0, plus follow-up answers for v1.2, v1.3 and v1.4 (marked "Owner (v1.2)", "(v1.3)" or "(v1.4)"), with where each is applied. Numbers match the review list. Where the owner said "use your best judgement", the chosen resolution is noted.

| # | Topic | Owner decision / note | Applied in |
|---|---|---|---|
| 1 | Deleting templates | Once a template has been used, archive instead of delete, so the document can be regenerated. | D-09, §6.11, §11.13, AC-TPL-10 |
| 2 | Compliance applicability | Apply HPD (and all) rules when units are created, not when the property is created. *Judgement:* recompute on unit add/archive/restore and NYC change, but keep a user's manual switch. | §6.14, AC-CMP-02, AC-CMP-11 |
| 3 | Archiving units / properties | Units with running leases can be archived. Archiving a property archives all its units. | §6.4, §6.7, AC-UNIT-03, AC-PROP-08 |
| 4 | Deleting properties / item types | Deleting a property stops its compliance reminders and doesn't change the item-type catalog. Deleting an item type doesn't affect properties. | §6.4, §6.13, AC-PROP-11, AC-CMP-14 |
| 5 | Sign-in lockout | Per email. *Judgement:* plus a per-IP limit across emails. | D-08, AC-AUTH-04 |
| 6 | Needs decision | Any term ending without a timely update enters Needs decision, with or without extensions. | D-14, §7.4, AC-LEASE-22 |
| 7 | Compliance status overlap | *Judgement:* explicit precedence; Completed beats Not scheduled. | §9.2, AC-CMP-15 |
| 8 | Older leases / replacing | Older leases can be created; a current lease can be replaced by a new one (e.g. tenant breaks early). | §6.9, §7.4, §11.12, AC-LEASE-19/20 |
| 9 | Missed reminder days | Catch up the next day. | §10.5, AC-EML-03/05/07 |
| 10 | Admin and invitees | Invited users are created as users and visible to the Admin. Admin is the owner's email. Owner (v1.2): use a Fly secret, so the email is set as `ADMIN_EMAIL` and not stored in the repo. *Judgement:* created automatically at startup, CLI only to resend. | §2, D-05, D-07, §6.1, §6.2, §15.3, AC-PLAT-08 |
| 11 | Verification | Smoke user pre-verified; invited users unverified until they accept. *Judgement:* separate verification email removed. | D-07, §10.3, §11.5, AC-AUTH-11 |
| 12 | Smoke entries in logs | Don't fill logs with smoke entries; keep logs for real users. | §2, D-24, §6.16, AC-PLAT-09 |
| 13 | Revoke / resend | Both Admin-only. | §6.2, §14.2, AC-USR-11 |
| 14 | Time zones and minor contradictions | Always New York time. Others resolved by judgement. | §11 conventions, §15.1, §16 |
| 15 | Rent while Needs decision | Counts as occupied at the last known rent. | §7.2, §7.4, AC-DASH-07 |
| 16 | Lease term months | 365-day lease = 12 months. | §7.7 |
| 17 | Extensions | Extensions set new rent or schedule, and can remove/replace some (not all) tenants, change rent terms, parking and tax, and special terms. Owner (v1.2): "original tenants" means the **master lease's** tenants; if all of them would be removed, a new master lease must be started. An extension can change any lease value that has a `{{key}}`; most extensions only change term and amount. *Judgement:* extension templates' ordinary keys use the extension's values; the other-terms section is collapsed by default. | §3, §6.10, §8.1, §11.14, AC-EXT-07/08/09, AC-DOC-11 |
| 18 | Lease edits | Every change after creation creates a new version. | D-31, §6.9, §11.13, AC-LEASE-21 |
| 19 | Move-out dates | Any valid date. Upcoming leases: delete only. Past leases: optional move-out date. Owner (v1.2): a past lease with no move-out date and no later lease being "Needs decision" is fine; if a later lease exists, that is the decision to end the prior lease, with no move-out date. | §6.9, §7.4, §10.5, §11.12, AC-LEASE-20/23/24/25 |
| 20 | Archiving with active leases; owners | Warn, then archive units and leases, remove from dashboard, stop reminders. Owners in use by active properties can't be archived; tell the user to change the owner first. | §6.3, §6.4, §11.9, §11.16, AC-OWN-03, AC-PROP-08 |
| 21 | Unit use | Use can't change; create a new unit instead. | §6.7, §11.10, AC-UNIT-05 |
| 22 | Import columns | Same fields as the data model; revisit later if needed. | §11.22, AC-IMP-07/08/09 |
| 23 | Responsible landlords | Landlords can see responsible landlords and their emails. Multiple responsible landlords per property, all receiving reminders. | §3, §6.1, §6.4, §10.5, AC-USR-14, AC-EML-08 |
| 24 | Invitation edge cases | *Judgement:* one live invitation per user; existing emails use Resend/Reactivate; admin invite resent by CLI. | §6.2, D-05 |
| 25 | Password reset | Signs out other sessions; doesn't work until the email is confirmed. | §10.2, §11.3, AC-AUTH-06, AC-AUTH-11 |
| 26 | Tests can't be gamed | *Judgement:* acceptance tests locked; test routes can't bypass rules; smoke password follows the secret. Owner (v1.2): no pull-request workflow or branch protection — Claude pushes directly to main; the tests are protected by the PreToolUse guard hook and by the run loop restoring them from the `acceptance-locked` tag before every iteration. | D-33, §15.4, AC-PLAT-04 |
| 27 | New tenants in wizard | Saved when the lease is saved. | §11.12 |
| 28 | Retrying failed PDFs | *Judgement:* retry re-renders the original snapshot. | D-18, D-19, AC-DOC-09 |
| 29 | Word pasting | Only text and valid keys; strip images, logos, headers etc. *Judgement:* strip with a notice; block saving with unrecognised keys. | §8.4, AC-TPL-03, AC-TPL-09 |
| 30 | Dashboard "ending soon" | Exclude month-to-month and new (upcoming) leases; include tenants moving out within 90 days. | §11.6, AC-DASH-04 |
| 31 | Date arithmetic; N/A items | +1 month/+1 year = same date next period (last day of month if missing). Not-applicable items can be marked done and stay hidden. | §7.7, §9.3, AC-CMP-12/13 |
| 32a | Independent tests (v1.3) | Owner: the build is autonomous, so a separate first step writes the tests, independently of app development, e.g. in a separate session with separate context. *Judgement:* a test-authoring session working only from the spec, a fresh review session, then tagging; tests use only spec-visible behaviour and build their own data through the API; a fixed harness contract; a fresh-session dispute step. App-provided fixture sets were removed for independence. Owner (v1.3): the run loop and the matching guard-hook update will be created later by the owner; only the spec changes for now. Because the current guard blocks any command mentioning `acceptance-locked`, the run loop, not a session, creates the tags. | D-33, §13 intro, §15.5, AC-PLAT-10, AC-PLAT-12, AC-TPL-09, AC-A11Y-01, Appendix D |
| 32 | Fake clocks | Use fake clocks to test time-based features. *Judgement:* whole-process clock offset in web and worker. | D-25, §13 intro |
| 33–49 | Spec gaps and testability | Resolved by judgement: Leases status checkboxes; aria-disabled buttons; Origin required; file-name rules; machine sizes; concrete keyboard, axe and target-size checks; time-based tests via the test clock; real-wait signed-URL test; Word paste fixture; new-tab preview; PDF hash comparison; email link targets; backup, performance and rollback checks; manual Safari/Edge check. | §8.2, §11, D-34, §13, §15.4, §16 |
| 50 | Everyone sees/changes everything | OK for now. Sign in with Google would be a good later feature. | §2, §17 |
| 51 | Smoke account | Make it read-only as suggested. Owner (v1.2): confirmed this is compatible with §4's "no special privileges". | §2, §6.1, AC-PLAT-03, AC-EML-14 |
| 52 | Single permanent admin | OK for now. | §17 |
| 53 | Resend invitation | Admin-only. | §14.2 |
| 54 | Test routes vs production data | *Judgement:* four independent checks; refuse to start otherwise. | D-25, AC-PLAT-07 |
| 55 | Backups in the app bucket | OK for now. | D-26 |
| 56–75 | Remaining security and difficulty items | Resolved by judgement: rate limits; trusted client IP; reset revokes sessions; no account-existence leaks; offline PDF rendering; secrets kept out of audit; preview access; import size limits; one-machine Fly scale with idempotent seeding; single shared calculation code; pending/sent reminder log; lease-level version covering child rows; backup version check and failure email; serial acceptance suite. | D-08, D-10, D-26, D-27, D-32, D-34, §8.2, §10.5, §14.1, §16 |
| 76 | CI minutes (v1.4) | Owner (v1.4): the private repository has limited free Actions minutes, so GitHub Actions runs the acceptance suite in Chromium only and skips tests tagged `@slow` (over a minute each, including the 5-minute signed-URL test). The three-browser run with `@slow` tests happens only locally with `VERIFY_ALL=1`. | §13 AC-PLAT-11, §15.4, §16 |
| 77 | Test review decisions (v1.4) | Owner (v1.4) accepted the test review's readings: the Admin's "Invited" state is checked by a failing sign-in; `Secure` is checked only by the production smoke test; AC-A11Y-02 drives one main task per screen; AC-PLAT-10 alone reads the database; AC-PLAT-11 runs only in the full local run; a task's own `@slow` tests always run for that task; the accessibility scans stay in CI; a WAI-ARIA toolbar (one Tab stop, arrow keys) satisfies AC-TPL-08; tests pick the primary contact when none is preselected; a forced PDF failure fails every retry; every link in a table cell must be 24×24 px; the hand-written Word paste fixture stays. The production backup/restore drill is an owner checklist item, not a build task. | §13, §15.4, tests/acceptance/COVERAGE.md, docs/tasks.json T104 |

## Appendix D — Decisions made during the build

Spec ambiguities resolved by an adjudicator session during the autonomous build (§15.5, step 4), for the owner to review. Each entry: date, spec section, the question, the reading chosen and why, and any test changed. Empty until the build starts.
