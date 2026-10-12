# Acceptance test coverage

Every acceptance criterion in SPEC.md §13 has at least one Playwright test whose title starts
with the criterion ID. The two **(manual)** criteria are checked by a person before the first
release and have no automated test. "Task" is the task in `docs/tasks.json` after which the
test is expected to pass; `scripts/verify.sh` runs a criterion's tests once its task is "done".

Smoke tests (`smoke.prod.spec.ts`, tag `@smoke`) run read-only against production after each
deploy (`scripts/smoke-prod.sh`). They reuse the IDs AC-PLAT-01/02/03 and AC-AUTH-10.

| Criterion | Test file(s) | Task |
|---|---|---|
| AC-PLAT-01 | `plat.spec.ts`, `smoke.prod.spec.ts` | T005 |
| AC-PLAT-02 | `plat.spec.ts`, `smoke.prod.spec.ts` | T019 |
| AC-PLAT-03 | `plat.spec.ts`, `smoke.prod.spec.ts` | T034 |
| AC-PLAT-04 | `plat.spec.ts` | T025 |
| AC-PLAT-05 | `plat.spec.ts` | T010 |
| AC-PLAT-06 | `plat.spec.ts` | T019 |
| AC-PLAT-07 | `plat.spec.ts` | T010 |
| AC-PLAT-08 | `plat.spec.ts` | T025 |
| AC-PLAT-09 | `plat.spec.ts` | T080 |
| AC-PLAT-10 | `plat.spec.ts` | T097 |
| AC-PLAT-11 | `plat.spec.ts` | T101 |
| AC-PLAT-12 | — (manual) | T008 |
| AC-AUTH-01 | `auth.spec.ts` | T019 |
| AC-AUTH-02 | `auth.spec.ts` | T019 |
| AC-AUTH-03 | `auth.spec.ts` | T019 |
| AC-AUTH-04 | `auth.spec.ts` | T020 |
| AC-AUTH-05 | `auth.spec.ts` | T021 |
| AC-AUTH-06 | `auth.spec.ts` | T021 |
| AC-AUTH-07 | `auth.spec.ts` | T021 |
| AC-AUTH-08 | `auth.spec.ts` | T027 |
| AC-AUTH-09 | `auth.spec.ts` | T019 |
| AC-AUTH-10 | `auth.spec.ts`, `smoke.prod.spec.ts` | T019 |
| AC-AUTH-11 | `auth.spec.ts` | T021 |
| AC-AUTH-12 | `auth.spec.ts` | T019 |
| AC-USR-01 | `users.spec.ts` | T025 |
| AC-USR-02 | `users.spec.ts` | T025 |
| AC-USR-03 | `users.spec.ts` | T022 |
| AC-USR-04 | `users.spec.ts` | T025 |
| AC-USR-05 | `users.spec.ts` | T026 |
| AC-USR-06 | `users.spec.ts` | T025 |
| AC-USR-07 | `users.spec.ts` | T026 |
| AC-USR-08 | `users.spec.ts` | T041 |
| AC-USR-09 | `users.spec.ts` | T026 |
| AC-USR-10 | `users.spec.ts` | T026 |
| AC-USR-11 | `users.spec.ts` | T026 |
| AC-USR-12 | `users.spec.ts` | T027 |
| AC-USR-13 | `users.spec.ts` | T027 |
| AC-USR-14 | `users.spec.ts` | T035 |
| AC-OWN-01 | `records.spec.ts` | T030 |
| AC-OWN-02 | `records.spec.ts` | T030 |
| AC-OWN-03 | `records.spec.ts` | T075 |
| AC-OWN-04 | `records.spec.ts` | T034 |
| AC-PROP-01 | `records.spec.ts` | T035 |
| AC-PROP-02 | `records.spec.ts` | T035 |
| AC-PROP-03 | `records.spec.ts` | T034 |
| AC-PROP-04 | `records.spec.ts` | T035 |
| AC-PROP-05 | `records.spec.ts` | T037 |
| AC-PROP-06 | `records.spec.ts` | T037 |
| AC-PROP-07 | `records.spec.ts` | T038 |
| AC-PROP-08 | `records.spec.ts` | T078 |
| AC-PROP-09 | `records.spec.ts` | T074 |
| AC-PROP-10 | `records.spec.ts` | T033 |
| AC-PROP-11 | `records.spec.ts` | T074 |
| AC-UNIT-01 | `records.spec.ts` | T036 |
| AC-UNIT-02 | `records.spec.ts` | T036 |
| AC-UNIT-03 | `records.spec.ts` | T074 |
| AC-UNIT-04 | `records.spec.ts` | T088 |
| AC-UNIT-05 | `records.spec.ts` | T036 |
| AC-TEN-01 | `records.spec.ts` | T040 |
| AC-TEN-02 | `records.spec.ts` | T040 |
| AC-TEN-03 | `records.spec.ts` | T040 |
| AC-TEN-04 | `records.spec.ts` | T059 |
| AC-TEN-05 | `records.spec.ts` | T059 |
| AC-LEASE-01 | `leases.spec.ts` | T053 |
| AC-LEASE-02 | `leases.spec.ts` | T050 |
| AC-LEASE-03 | `leases.spec.ts` | T051 |
| AC-LEASE-04 | `leases.spec.ts` | T052 |
| AC-LEASE-05 | `leases.spec.ts` | T054 |
| AC-LEASE-06 | `leases.spec.ts` | T053 |
| AC-LEASE-07 | `leases.spec.ts` | T053 |
| AC-LEASE-08 | `leases.spec.ts` | T051 |
| AC-LEASE-09 | `leases.spec.ts` | T057 |
| AC-LEASE-10 | `leases.spec.ts` | T064 |
| AC-LEASE-11 | `leases.spec.ts` | T064 |
| AC-LEASE-12 | `leases.spec.ts` | T056 |
| AC-LEASE-13 | `leases.spec.ts` | T088 |
| AC-LEASE-14 | `leases.spec.ts` | T053 |
| AC-LEASE-15 | `leases.spec.ts` | T053 |
| AC-LEASE-16 | `leases.spec.ts` | T055 |
| AC-LEASE-17 | `leases.spec.ts` | T050 |
| AC-LEASE-18 | `leases.spec.ts` | T058 |
| AC-LEASE-19 | `leases.spec.ts` | T057 |
| AC-LEASE-20 | `leases.spec.ts` | T078 |
| AC-LEASE-21 | `leases.spec.ts` | T055 |
| AC-LEASE-22 | `leases.spec.ts` | T060 |
| AC-LEASE-23 | `leases.spec.ts` | T056 |
| AC-LEASE-24 | `leases.spec.ts` | T053 |
| AC-LEASE-25 | `leases.spec.ts` | T078 |
| AC-EXT-01 | `leases.spec.ts` | T060 |
| AC-EXT-02 | `leases.spec.ts` | T060 |
| AC-EXT-03 | `leases.spec.ts` | T060 |
| AC-EXT-04 | `leases.spec.ts` | T060 |
| AC-EXT-05 | `leases.spec.ts` | T060 |
| AC-EXT-06 | `leases.spec.ts` | T060 |
| AC-EXT-07 | `leases.spec.ts` | T061 |
| AC-EXT-08 | `leases.spec.ts` | T061 |
| AC-EXT-09 | `leases.spec.ts` | T090 |
| AC-TPL-01 | `documents.spec.ts` | T083 |
| AC-TPL-02 | `documents.spec.ts` | T083 |
| AC-TPL-03 | `documents.spec.ts` | T083 |
| AC-TPL-04 | `documents.spec.ts` | T083 |
| AC-TPL-05 | `documents.spec.ts` | T091 |
| AC-TPL-06 | `documents.spec.ts` | T082 |
| AC-TPL-07 | `documents.spec.ts` | T090 |
| AC-TPL-08 | `documents.spec.ts` | T082 |
| AC-TPL-09 | `documents.spec.ts` | T084 |
| AC-TPL-10 | `documents.spec.ts` | T089 |
| AC-TPL-11 | `documents.spec.ts` | T091 |
| AC-DOC-01 | `documents.spec.ts` | T090 |
| AC-DOC-02 | `documents.spec.ts` | T088 |
| AC-DOC-03 | `documents.spec.ts` | T087 |
| AC-DOC-04 | `documents.spec.ts` | T088 |
| AC-DOC-05 | `documents.spec.ts` | T089 |
| AC-DOC-06 | `documents.spec.ts` | T090 |
| AC-DOC-07 | `documents.spec.ts` | T088 |
| AC-DOC-08 | `documents.spec.ts` | T087 |
| AC-DOC-09 | `documents.spec.ts` | T089 |
| AC-DOC-10 | `documents.spec.ts` | T088 |
| AC-DOC-11 | `documents.spec.ts` | T090 |
| AC-CMP-01 | `compliance.spec.ts` | T070 |
| AC-CMP-02 | `compliance.spec.ts` | T068 |
| AC-CMP-03 | `compliance.spec.ts` | T068 |
| AC-CMP-04 | `compliance.spec.ts` | T078 |
| AC-CMP-05 | `compliance.spec.ts` | T068 |
| AC-CMP-06 | `compliance.spec.ts` | T068 |
| AC-CMP-07 | `compliance.spec.ts` | T071 |
| AC-CMP-08 | `compliance.spec.ts` | T070 |
| AC-CMP-09 | `compliance.spec.ts` | T070 |
| AC-CMP-10 | `compliance.spec.ts` | T069 |
| AC-CMP-11 | `compliance.spec.ts` | T068 |
| AC-CMP-12 | `compliance.spec.ts` | T068 |
| AC-CMP-13 | `compliance.spec.ts` | T070 |
| AC-CMP-14 | `compliance.spec.ts` | T070 |
| AC-CMP-15 | `compliance.spec.ts` | T070 |
| AC-EML-01 | `email.spec.ts` | T077 |
| AC-EML-02 | `email.spec.ts` | T077 |
| AC-EML-03 | `email.spec.ts` | T077 |
| AC-EML-04 | `email.spec.ts` | T077 |
| AC-EML-05 | `email.spec.ts` | T077 |
| AC-EML-06 | `email.spec.ts` | T077 |
| AC-EML-07 | `email.spec.ts` | T077 |
| AC-EML-08 | `email.spec.ts` | T077 |
| AC-EML-09 | `email.spec.ts` | T078 |
| AC-EML-10 | `email.spec.ts` | T078 |
| AC-EML-11 | `email.spec.ts` | T077 |
| AC-EML-12 | `email.spec.ts` | T077 |
| AC-EML-13 | `email.spec.ts` | T078 |
| AC-EML-14 | `email.spec.ts` | T031 |
| AC-DASH-01 | `insight.spec.ts` | T063 |
| AC-DASH-02 | `insight.spec.ts` | T063 |
| AC-DASH-03 | `insight.spec.ts` | T063 |
| AC-DASH-04 | `insight.spec.ts` | T064 |
| AC-DASH-05 | `insight.spec.ts` | T063 |
| AC-DASH-06 | `insight.spec.ts` | T063 |
| AC-DASH-07 | `insight.spec.ts` | T063 |
| AC-INV-01 | `insight.spec.ts` | T073 |
| AC-INV-02 | `insight.spec.ts` | T073 |
| AC-INV-03 | `insight.spec.ts` | T073 |
| AC-INV-04 | `insight.spec.ts` | T073 |
| AC-INV-05 | `insight.spec.ts` | T073 |
| AC-IMP-01 | `import.spec.ts` | T093 |
| AC-IMP-02 | `import.spec.ts` | T094 |
| AC-IMP-03 | `import.spec.ts` | T096 |
| AC-IMP-04 | `import.spec.ts` | T095 |
| AC-IMP-05 | `import.spec.ts` | T095 |
| AC-IMP-06 | `import.spec.ts` | T094 |
| AC-IMP-07 | `import.spec.ts` | T095 |
| AC-IMP-08 | `import.spec.ts` | T095 |
| AC-IMP-09 | `import.spec.ts` | T096 |
| AC-AUD-01 | `audit.spec.ts` | T080 |
| AC-AUD-02 | `audit.spec.ts` | T096 |
| AC-AUD-03 | `audit.spec.ts` | T080 |
| AC-AUD-04 | `audit.spec.ts` | T080 |
| AC-AUD-05 | `audit.spec.ts` | T080 |
| AC-API-01 | `api.spec.ts` | T016 |
| AC-API-02 | `api.spec.ts` | T031 |
| AC-API-03 | `api.spec.ts` | T039 |
| AC-API-04 | `api.spec.ts` | T029 |
| AC-API-05 | `api.spec.ts` | T031 |
| AC-API-06 | `api.spec.ts` | T029 |
| AC-A11Y-01 | `a11y.spec.ts` | T099 |
| AC-A11Y-02 | `a11y.spec.ts` | T100 |
| AC-A11Y-03 | `a11y.spec.ts` | T098 |
| AC-A11Y-04 | `a11y.spec.ts` | T100 |
| AC-A11Y-05 | `a11y.spec.ts` | T100 |
| AC-A11Y-06 | `a11y.spec.ts` | T100 |
| AC-A11Y-07 | `a11y.spec.ts` | T098 |
| AC-A11Y-08 | `a11y.spec.ts` | T098 |
| AC-A11Y-09 | `a11y.spec.ts` | T098 |
| AC-A11Y-10 | `a11y.spec.ts` | T098 |
| AC-A11Y-11 | — (manual) | T100 |

## Contract and interpretations

These are the places where the spec leaves a detail open and the tests pick a reading.
The app must follow them (they are repeated in CLAUDE.md).

1. **Test routes** need no session. `POST /api/test/clock` takes `{"now": "<ISO timestamp>"}`
   and `{"now": null}` clears it. `POST /api/test/reset` empties the app data; the tests then
   restart web and worker so normal startup seeding (§15.1) runs, and the Admin accepts the
   startup invitation from Mailpit.
2. **Clock.** Tests set the app clock to noon New York time and also fix the browser's
   JavaScript clock to the same instant. The CLI honours the test clock like web and worker
   (AC-PLAT-08 runs `resend-admin-invite` 8 days ahead). Session cookies must use `Max-Age`
   because the browser's real clock differs from the app clock. S3 request signing must use
   real time; `expiresAt` uses the app clock.
3. **Request bodies** use §6 field names. Money fields take the `Cents` suffix (§14.1), e.g.
   `baseRentCents`, `parkingChargeCents`, `purchasePriceCents`, `amountCents`, `costCents`.
   Enum values are the §6 codes in backticks (`market_estimate`, `percent`, `master_lease`,
   `interval`) and otherwise the label text (`"LLC"`, `"Residential"`, `"Tenant moved out"`,
   `"All properties"`). Lease and extension tenants are `tenants: [{tenantId, isPrimary}]`,
   rent steps `rentSteps: [{effectiveDate, amountCents}]`. Actions (`/archive`, `/restore`,
   `/end`, `/month-to-month`, extensions) receive the record's `version` too.
   `POST /api/leases/{id}/extensions` copies any omitted term from the previous term.
4. **Responses.** Single records are returned unwrapped with `id` and `version`; lists are
   `{data, page, pageSize, total}`. `GET /api/leases/{id}` includes `moveOutDate`, `tenants`
   and `extensions` (each with its own `id`, `tenants` and term fields). Audit rows include
   `action` (the §6.16 codes) and `changes`. `POST /api/templates/{id}/preview` returns `{id}`.
5. **Named tables.** Every table that §11 names (By property, Leases needing a decision,
   Leases ending in the next 90 days, Overdue compliance, Compliance due in the next 30 days,
   Rent schedule, Extensions, Versions, Documents, Lease history) has that accessible name.
   The Dashboard Portfolio summary is a `<dl>`.
6. **Widgets.** Selects may be native `<select>`, radio groups or listbox comboboxes; the
   helpers accept each. Confirmation dialogs are optional where the spec doesn't require one.
7. **AC-PLAT-08**: only the Admin can open the Users list, so the "Invited" badge can't be seen
   before the Admin accepts. The test checks the invited state through a failing sign-in, and
   Role "Admin" after acceptance.
8. **AC-AUTH-10**: `Secure` is checked by the production smoke test; locally (http) it isn't.
9. **AC-A11Y-02** drives a representative main task per screen with the keyboard only (sign
   in, owner, tenant, unit, value dialog, lease dialogs, investment, Mark done, template,
   account, invite); the focus-indicator check runs on every element tabbed through.
10. **AC-PLAT-10** is the only test that reads the database directly (row counts through `psql`
    in the Compose `postgres` service), because the criterion compares two databases.
11. **AC-PLAT-11** uses API timings measured from the test process. **AC-DOC-03** waits 5
    minutes 10 seconds of real time. Both are tagged `@slow`.
12. **AC-IMP-***: the spreadsheets are built at run time from the app's own downloadable
    template (`helpers/xlsx.ts`), writing values under the column headings.

## Review log

(Test review and adjudicator changes are recorded here and in CHANGELOG.md.)
