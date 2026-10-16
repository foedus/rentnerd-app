import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb } from "../db/client";
import { createApp } from "./app";
import { addDays, todayNy } from "../shared/dates";
import { createAuth } from "./auth";

const url = "postgres://rentnerd:rentnerd@localhost:5432/rentnerd_test";
const { pool, db } = createDb(url);
const env = { AUTH_SECRET: "integration-test-secret-0123456789abcdef0123456789", APP_URL: "http://localhost:8080" };
const auth = createAuth(db, env);
const PASSWORD = "Correct-horse-1234";
const app = createApp(pool, "dist/client", auth, { testRoutesEnabled: false }, env.APP_URL, db, async () => undefined);
const UUID = "00000000-0000-4000-8000-000000000000";
const OVERLAP = "This unit already has a lease for those dates.";
const today = todayNy();
const day = (n: number) => addDays(today, n);

beforeAll(() => {
  execFileSync("npm", ["run", "build"], { stdio: "pipe" });
  execFileSync("node", ["dist/migrate.js"], { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
});
beforeEach(async () => {
  await pool.query('truncate "user", owner, property, unit, tenant, lease, audit_log cascade');
});
afterAll(() => pool.end());

async function makeUser(email: string, role: "admin" | "landlord" | "smoke") {
  const ctx = await auth.$context;
  const [u] = (await pool.query(`insert into "user" (name, email, role, status, email_verified) values ($2,$1,$3,'active',true) returning id`, [email, `Name of ${email}`, role])).rows;
  await pool.query(`insert into account (user_id, provider_id, account_id, password) values ($1::uuid,'credential',$1::text,$2)`, [u.id, await ctx.password.hash(PASSWORD)]);
  const res = await app.request("/api/auth/sign-in/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: env.APP_URL },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  return { id: u.id as string, cookie: res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ") };
}
const call = (cookie: string, method: string, path: string, body?: unknown) =>
  app.request(path, { method, headers: { cookie, origin: env.APP_URL, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

type Fx = { cookie: string; propertyId: string; res: string; com: string; t1: string; t2: string };
const json = async <T>(r: Response) => (await r.json()) as T;

async function fixture(): Promise<Fx> {
  const { cookie } = await makeUser("admin@example.com", "admin");
  const o = await json<{ id: string }>(await call(cookie, "POST", "/api/owners", { name: "Acme LLC", ownerType: "LLC", addressLine1: "1 A St", city: "Brooklyn", state: "NY", zip: "11201" }));
  const p = await json<{ id: string }>(await call(cookie, "POST", "/api/properties", { name: "412 Court St", street: "412 Court St", city: "Brooklyn", state: "NY", zip: "11231", ownerId: o.id }));
  const unit = async (label: string, use: string) => (await json<{ id: string }>(await call(cookie, "POST", `/api/properties/${p.id}/units`, { label, use }))).id;
  const tenant = async (firstName: string) => (await json<{ id: string }>(await call(cookie, "POST", "/api/tenants", { tenantType: "Individual", firstName, lastName: "Lee" }))).id;
  return { cookie, propertyId: p.id, res: await unit("2R", "Residential"), com: await unit("Store", "Commercial"), t1: await tenant("Ann"), t2: await tenant("Bo") };
}
const body = (f: Fx, over: Record<string, unknown> = {}) => ({
  startDate: "2026-01-01", endDate: "2026-12-31", baseRentCents: 250000, rentDueDay: 1, childrenReside: false,
  tenants: [{ tenantId: f.t1, isPrimary: true }], ...over,
});
const post = (f: Fx, unitId: string, over: Record<string, unknown> = {}) => call(f.cookie, "POST", `/api/units/${unitId}/leases`, body(f, over));
const fieldsOf = async (r: Response) => (await json<{ error: { fields?: Record<string, string> } }>(r)).error.fields ?? {};
type Lease = { id: string; version: number; moveOutDate: string | null; endReason: string | null; tenants: { tenantId: string; isPrimary: boolean }[]; rentSteps: unknown[]; increasePercent: number | null };
const patch = (f: Fx, id: string, over: Record<string, unknown>, version = 1) => call(f.cookie, "PATCH", `/api/leases/${id}`, { version, ...over });
const count = async (sql: string) => Number((await pool.query(sql)).rows[0].n);


const versionsOf = async (f: Fx, id: string) =>
  (await json<{ data: { versionNumber: number; summary: string }[] }>(await call(f.cookie, "GET", `/api/leases/${id}/versions`))).data.map((v) => ({ versionNumber: v.versionNumber, summary: v.summary }));
/** An Active lease for unit `unitId` unless the dates say otherwise. */
const lease = async (f: Fx, unitId = f.res, over: Record<string, unknown> = {}) =>
  json<Lease & { version: number; baseRentCents: number }>(await post(f, unitId, { startDate: day(-30), endDate: day(300), ...over }));
const addExtension = async (leaseId: string, tenantId: string, start: string, end: string) => {
  const [e] = (await pool.query("insert into lease_extension (lease_id, start_date, end_date, base_rent_cents) values ($1,$2,$3,260000) returning id", [leaseId, start, end])).rows;
  await pool.query("insert into extension_tenant (extension_id, tenant_id, is_primary) values ($1,$2,true)", [e.id, tenantId]);
};

describe("PATCH /api/leases/{id}", () => {
  it("needs a session and is refused to the Smoke user; unknown leases are 404", async () => {
    const f = await fixture();
    const l = await lease(f);
    const bare = (method: string, path: string) => app.request(path, { method, headers: { origin: env.APP_URL, "content-type": "application/json" }, body: JSON.stringify({ version: 1 }) });
    expect((await bare("PATCH", `/api/leases/${l.id}`)).status).toBe(401);
    expect((await bare("DELETE", `/api/leases/${l.id}`)).status).toBe(401);
    const smoke = await makeUser("smoke@example.com", "smoke");
    for (const [method, path] of [["PATCH", ""], ["DELETE", ""], ["POST", "/end"], ["POST", "/month-to-month"]] as const) {
      expect((await call(smoke.cookie, method, `/api/leases/${l.id}${path}`, { version: 1 })).status).toBe(403);
    }
    expect((await patch(f, UUID, { pets: "Cat" })).status).toBe(404);
    expect((await patch(f, "nope", { pets: "Cat" })).status).toBe(404);
  });

  it("saves a new version with a readable summary, keeps version 1, and writes an audit row", async () => {
    const f = await fixture();
    const l = await lease(f, f.res, { baseRentCents: 215000 });
    const res = await patch(f, l.id, { baseRentCents: 220000 });
    expect(res.status).toBe(200);
    expect(await json<Lease & { baseRentCents: number }>(res)).toMatchObject({ version: 2, baseRentCents: 220000, tenants: [{ tenantId: f.t1, isPrimary: true }], rentDueDay: 1 });
    expect(await versionsOf(f, l.id)).toEqual([{ versionNumber: 2, summary: "Monthly rent: $2,150.00 → $2,200.00" }, { versionNumber: 1, summary: "Lease created" }]);
    const v1 = await json<{ snapshot: { baseRentCents: number } }>(await call(f.cookie, "GET", `/api/leases/${l.id}/versions/1`));
    expect(v1.snapshot.baseRentCents).toBe(215000);
    const audit = (await pool.query("select changes from audit_log where entity_type = 'lease' and entity_id = $1 and action = 'update'", [l.id])).rows;
    expect(audit).toHaveLength(1);
    expect(audit[0].changes).toEqual({ "Monthly rent": ["$2,150.00", "$2,200.00"] });
  });

  it("names the lease's tenants in the detail and in a version view", async () => {
    const f = await fixture();
    const l = await lease(f, f.res, { tenants: [{ tenantId: f.t1, isPrimary: false }, { tenantId: f.t2, isPrimary: true }] });
    const detail = await json<{ masterTenants: { tenantId: string; isPrimary: boolean; displayName: string }[] }>(await call(f.cookie, "GET", `/api/leases/${l.id}`));
    expect(detail.masterTenants).toEqual(expect.arrayContaining([{ tenantId: f.t1, isPrimary: false, displayName: "Ann Lee" }, { tenantId: f.t2, isPrimary: true, displayName: "Bo Lee" }]));
    const v1 = await json<{ snapshotTenants: { tenantId: string; displayName: string }[] }>(await call(f.cookie, "GET", `/api/leases/${l.id}/versions/1`));
    expect(v1.snapshotTenants.map((t) => t.displayName).sort()).toEqual(["Ann Lee", "Bo Lee"]);
    expect((await call(f.cookie, "GET", `/api/leases/${l.id}/versions/99999999999999999999`)).status).toBe(404);
  });

  it("is refused with 409 for a stale version and changes nothing", async () => {
    const f = await fixture();
    const l = await lease(f);
    expect((await patch(f, l.id, { pets: "Cat" })).status).toBe(200);
    const stale = await patch(f, l.id, { pets: "Dog" }, 1);
    expect(stale.status).toBe(409);
    expect((await json<{ error: { message: string } }>(stale)).error.message).toMatch(/changed by someone else/);
    expect((await patch(f, l.id, { pets: "Dog" }, 0)).status).toBe(422);
    expect((await call(f.cookie, "PATCH", `/api/leases/${l.id}`, { pets: "Dog" })).status).toBe(422);
    expect(await versionsOf(f, l.id)).toHaveLength(2);
  });

  it("does not bump the version when nothing changes", async () => {
    const f = await fixture();
    const l = await lease(f);
    const res = await patch(f, l.id, { baseRentCents: l.baseRentCents, tenants: [{ tenantId: f.t1, isPrimary: true }] });
    expect(res.status).toBe(200);
    expect((await json<Lease>(res)).version).toBe(1);
    expect(await versionsOf(f, l.id)).toHaveLength(1);
  });

  it("re-validates the §6.9 rules on the merged lease", async () => {
    const f = await fixture();
    const l = await lease(f);
    expect(await fieldsOf(await patch(f, l.id, { endDate: day(-31) }))).toHaveProperty("endDate");
    expect(await fieldsOf(await patch(f, l.id, { baseRentCents: 0 }))).toHaveProperty("baseRentCents");
    expect(await fieldsOf(await patch(f, l.id, { increaseType: "percent" }))).toHaveProperty("increasePercent");
    expect(await fieldsOf(await patch(f, l.id, { increaseType: "schedule", rentSteps: [{ effectiveDate: day(-40), amountCents: 260000 }] }))).toHaveProperty("rentSteps");
    expect(await fieldsOf(await patch(f, l.id, { tenants: [{ tenantId: f.t1, isPrimary: false }] }))).toHaveProperty("tenants");
    expect(await fieldsOf(await patch(f, l.id, { childrenReside: null }))).toHaveProperty("childrenReside");
    expect(await fieldsOf(await patch(f, l.id, { baseTaxYear: 2024, taxSharePercent: 10 }))).toHaveProperty("baseTaxYear");
    expect(await fieldsOf(await patch(f, l.id, { moveOutDate: day(5) }))).toHaveProperty("endReason");
    expect(await fieldsOf(await patch(f, l.id, { endReason: "Other" }))).toHaveProperty("moveOutDate");
    expect(await versionsOf(f, l.id)).toHaveLength(1);
  });

  it("checks tenants and base tax years that are newly chosen", async () => {
    const f = await fixture();
    const l = await lease(f);
    expect(await fieldsOf(await patch(f, l.id, { tenants: [{ tenantId: UUID, isPrimary: true }] }))).toHaveProperty("tenants");
    const t = await json<{ version: number }>(await call(f.cookie, "GET", `/api/tenants/${f.t2}`));
    await call(f.cookie, "POST", `/api/tenants/${f.t2}/archive`, { version: t.version });
    expect(await fieldsOf(await patch(f, l.id, { tenants: [{ tenantId: f.t2, isPrimary: true }] }))).toMatchObject({ tenants: "Choose tenants that aren't archived." });
    const c = await lease(f, f.com, { childrenReside: undefined });
    expect(await fieldsOf(await patch(f, c.id, { baseTaxYear: 2024, taxSharePercent: 25 }))).toHaveProperty("baseTaxYear");
    await call(f.cookie, "POST", `/api/properties/${f.propertyId}/taxes`, { taxYear: 2024, amountCents: 1200000 });
    expect((await patch(f, c.id, { baseTaxYear: 2024, taxSharePercent: 25 })).status).toBe(200);
    // An archived tenant who is already on the lease stays on it.
    await call(f.cookie, "POST", `/api/tenants/${f.t1}/archive`, { version: 1 });
    expect((await patch(f, l.id, { pets: "Cat" })).status).toBe(200);
  });

  it("replaces tenants and rent steps, and clears steps and percent when the choice changes", async () => {
    const f = await fixture();
    const l = await lease(f, f.res, { increaseType: "schedule", rentSteps: [{ effectiveDate: day(10), amountCents: 260000 }] });
    const swapped = await json<Lease>(await patch(f, l.id, { tenants: [{ tenantId: f.t1, isPrimary: false }, { tenantId: f.t2, isPrimary: true }], rentSteps: [{ effectiveDate: day(20), amountCents: 270000 }] }));
    expect(swapped.tenants.find((t) => t.isPrimary)?.tenantId).toBe(f.t2);
    expect(swapped.rentSteps).toEqual([{ effectiveDate: day(20), amountCents: 270000 }]);
    const summary = (await versionsOf(f, l.id))[0]!.summary;
    expect(summary).toContain("Tenants: Ann Lee (primary) → Ann Lee, Bo Lee (primary)");
    const percent = await json<Lease>(await patch(f, l.id, { increaseType: "percent", increasePercent: 3 }, 2));
    expect(percent).toMatchObject({ increasePercent: 3, rentSteps: [], version: 3 });
    const none = await json<Lease>(await patch(f, l.id, { increaseType: "none" }, 3));
    expect(none).toMatchObject({ increasePercent: null, rentSteps: [] });
  });

  it("applies the overlap rule against other leases on the unit but not itself", async () => {
    const f = await fixture();
    const older = await lease(f, f.res, { startDate: day(-400), endDate: day(-100) });
    const current = await lease(f, f.res);
    expect((await patch(f, current.id, { startDate: day(-31) })).status).toBe(200);
    const clash = await patch(f, current.id, { startDate: day(-150) }, 2);
    expect(clash.status).toBe(409);
    expect((await json<{ error: { message: string } }>(clash)).error.message).toBe(OVERLAP);
    expect((await patch(f, older.id, { endDate: day(-31) })).status).toBe(409);
    expect((await patch(f, older.id, { endDate: day(-32) })).status).toBe(200);
  });

  it("keeps the extension chain valid", async () => {
    const f = await fixture();
    const l = await lease(f);
    await addExtension(l.id, f.t2, day(301), day(600));
    expect(await fieldsOf(await patch(f, l.id, { endDate: day(301) }))).toHaveProperty("endDate");
    expect((await patch(f, l.id, { tenants: [{ tenantId: f.t1, isPrimary: true }, { tenantId: f.t2, isPrimary: false }] })).status).toBe(200);
    expect(await fieldsOf(await patch(f, l.id, { tenants: [{ tenantId: f.t1, isPrimary: true }] }, 2))).toHaveProperty("tenants");
    expect((await patch(f, l.id, { endDate: day(250) }, 2)).status).toBe(200);
  });

  it("edits the move-out date and reason together, and clears them together", async () => {
    const f = await fixture();
    const l = await lease(f);
    const set = await json<Lease>(await patch(f, l.id, { moveOutDate: day(40), endReason: "Terminated" }));
    expect(set).toMatchObject({ moveOutDate: day(40), endReason: "Terminated" });
    const cleared = await json<Lease>(await patch(f, l.id, { moveOutDate: null }, 2));
    expect(cleared).toMatchObject({ moveOutDate: null, endReason: null });
  });

  it("refuses to change an archived lease", async () => {
    const f = await fixture();
    const l = await lease(f);
    await pool.query("update lease set archived_at = now() where id = $1", [l.id]);
    expect((await patch(f, l.id, { pets: "Cat" })).status).toBe(409);
  });
});

describe("POST /api/leases/{id}/month-to-month", () => {
  const post2 = (f: Fx, id: string, body: Record<string, unknown>, action = "month-to-month") => call(f.cookie, "POST", `/api/leases/${id}/${action}`, body);

  it("marks a Needs decision lease month-to-month at the given rent, with a version and audit row", async () => {
    const f = await fixture();
    const l = await lease(f, f.res, { startDate: day(-400), endDate: day(-10) });
    const res = await post2(f, l.id, { version: 1, monthToMonthRentCents: 230000 });
    expect(res.status).toBe(200);
    expect(await json<Lease>(res)).toMatchObject({ monthToMonth: true, monthToMonthRentCents: 230000, version: 2 });
    expect(await json<{ status: string; currentRentCents: number }>(await call(f.cookie, "GET", `/api/leases/${l.id}`))).toMatchObject({ status: "month_to_month", currentRentCents: 230000 });
    expect((await versionsOf(f, l.id))[0]!.summary).toBe("Marked month-to-month at $2,300.00");
    expect(await count(`select count(*) n from audit_log where entity_id = '${l.id}' and action = 'update'`)).toBe(1);
  });

  it("works without a rent (the last rent applies) and on an Active lease", async () => {
    const f = await fixture();
    const l = await lease(f);
    const res = await json<Lease & { monthToMonth: boolean }>(await post2(f, l.id, { version: 1 }));
    expect(res).toMatchObject({ monthToMonth: true, monthToMonthRentCents: null });
    expect((await versionsOf(f, l.id))[0]!.summary).toBe("Marked month-to-month");
  });

  it("is refused when already month-to-month, upcoming or ended, and for a stale version", async () => {
    const f = await fixture();
    const l = await lease(f);
    expect((await post2(f, l.id, { version: 5 })).status).toBe(409);
    expect((await post2(f, l.id, { version: 1 })).status).toBe(200);
    expect((await post2(f, l.id, { version: 2 })).status).toBe(409);
    const upcoming = await lease(f, f.com, { startDate: day(30), endDate: day(400), childrenReside: undefined });
    expect((await post2(f, upcoming.id, { version: 1 })).status).toBe(409);
    const ended = await lease(f, f.com, { startDate: day(-400), endDate: day(-100), childrenReside: undefined });
    expect((await post2(f, ended.id, { version: 1 })).status).toBe(409);
    expect((await post2(f, l.id, { monthToMonthRentCents: 0, version: 3 })).status).toBe(422);
    expect((await post2(f, UUID, { version: 1 })).status).toBe(404);
  });
});

describe("month-to-month and later leases", () => {
  it("refuses month-to-month when a later lease on the unit would clash with the open-ended stay", async () => {
    const f = await fixture();
    const l = await lease(f, f.res, { startDate: day(-30), endDate: day(100) });
    await lease(f, f.res, { startDate: day(101), endDate: day(400) });
    const res = await call(f.cookie, "POST", `/api/leases/${l.id}/month-to-month`, { version: 1 });
    expect(res.status).toBe(409);
    expect((await json<{ error: { message: string } }>(res)).error.message).toBe(OVERLAP);
    expect(await versionsOf(f, l.id)).toHaveLength(1);
  });
});

describe("POST /api/leases/{id}/end", () => {
  const end = (f: Fx, id: string, body: Record<string, unknown>) => call(f.cookie, "POST", `/api/leases/${id}/end`, body);

  it("sets the move-out date and reason, including a date before the lease start", async () => {
    const f = await fixture();
    const l = await lease(f);
    const res = await end(f, l.id, { version: 1, moveOutDate: day(-45), endReason: "Other" });
    expect(res.status).toBe(200);
    expect(await json<Lease>(res)).toMatchObject({ moveOutDate: day(-45), endReason: "Other", version: 2 });
    expect((await versionsOf(f, l.id))[0]!.summary).toMatch(/^Ended on .* \(Other\)$/);
    expect(await count(`select count(*) n from audit_log where entity_id = '${l.id}' and action = 'update'`)).toBe(1);
  });

  it("ends a Needs decision lease and lets an Active one change its move-out date", async () => {
    const f = await fixture();
    const nd = await lease(f, f.res, { startDate: day(-400), endDate: day(-10) });
    expect((await end(f, nd.id, { version: 1, moveOutDate: day(-10), endReason: "Not renewed" })).status).toBe(200);
    const active = await lease(f, f.com, { childrenReside: undefined });
    expect((await end(f, active.id, { version: 1, moveOutDate: day(20), endReason: "Terminated" })).status).toBe(200);
    expect((await end(f, active.id, { version: 2, moveOutDate: day(25), endReason: "Terminated" })).status).toBe(200);
  });

  it("validates input, refuses upcoming, ended and stale leases", async () => {
    const f = await fixture();
    const l = await lease(f);
    expect(await fieldsOf(await end(f, l.id, { version: 1, moveOutDate: "2026-02-30", endReason: "Other" }))).toHaveProperty("moveOutDate");
    expect(await fieldsOf(await end(f, l.id, { version: 1, moveOutDate: day(5) }))).toHaveProperty("endReason");
    expect((await end(f, l.id, { version: 9, moveOutDate: day(5), endReason: "Other" })).status).toBe(409);
    const upcoming = await lease(f, f.com, { startDate: day(30), endDate: day(400), childrenReside: undefined });
    expect((await end(f, upcoming.id, { version: 1, moveOutDate: day(40), endReason: "Other" })).status).toBe(409);
    expect((await end(f, l.id, { version: 1, moveOutDate: day(-5), endReason: "Other" })).status).toBe(200);
    expect((await end(f, l.id, { version: 2, moveOutDate: day(-4), endReason: "Other" })).status).toBe(409);
    expect((await end(f, UUID, { version: 1, moveOutDate: day(5), endReason: "Other" })).status).toBe(404);
  });

  it("refuses a move-out date that would clash with a later lease on the unit", async () => {
    const f = await fixture();
    const l = await lease(f, f.res, { startDate: day(-30), endDate: day(100) });
    await lease(f, f.res, { startDate: day(101), endDate: day(400) });
    const res = await end(f, l.id, { version: 1, moveOutDate: day(150), endReason: "Other" });
    expect(res.status).toBe(409);
    expect((await json<{ error: { message: string } }>(res)).error.message).toBe(OVERLAP);
  });
});

describe("DELETE /api/leases/{id}", () => {
  it("removes the lease with its versions, tenants, extensions and rent steps, and writes an audit row", async () => {
    const f = await fixture();
    const l = await lease(f, f.res, { increaseType: "schedule", rentSteps: [{ effectiveDate: day(10), amountCents: 260000 }] });
    await patch(f, l.id, { pets: "Cat" });
    await addExtension(l.id, f.t1, day(301), day(600));
    const res = await call(f.cookie, "DELETE", `/api/leases/${l.id}`);
    expect(res.status).toBe(204);
    for (const table of ["lease", "lease_revision", "lease_tenant", "lease_extension", "extension_tenant", "rent_step"]) {
      expect(await count(`select count(*) n from ${table}`)).toBe(0);
    }
    expect(await count(`select count(*) n from audit_log where entity_type = 'lease' and entity_id = '${l.id}' and action = 'delete'`)).toBe(1);
    expect((await call(f.cookie, "GET", `/api/leases/${l.id}`)).status).toBe(404);
    expect((await call(f.cookie, "DELETE", `/api/leases/${l.id}`)).status).toBe(404);
    expect((await call(f.cookie, "GET", `/api/tenants/${f.t1}`)).status).toBe(200);
    // The tenant is no longer on a lease, so it can be deleted again.
    expect((await call(f.cookie, "DELETE", `/api/tenants/${f.t1}`)).status).toBe(204);
  });

  it("can delete an upcoming lease and an archived one", async () => {
    const f = await fixture();
    const up = await lease(f, f.res, { startDate: day(30), endDate: day(400) });
    expect((await call(f.cookie, "DELETE", `/api/leases/${up.id}`)).status).toBe(204);
    const l = await lease(f);
    await pool.query("update lease set archived_at = now() where id = $1", [l.id]);
    expect((await call(f.cookie, "DELETE", `/api/leases/${l.id}`)).status).toBe(204);
  });
});
