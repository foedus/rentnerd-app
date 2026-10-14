import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb } from "../db/client";
import { createApp } from "./app";
import { createAuth } from "./auth";

const url = "postgres://rentnerd:rentnerd@localhost:5432/rentnerd_test";
const { pool, db } = createDb(url);
const env = { AUTH_SECRET: "integration-test-secret-0123456789abcdef0123456789", APP_URL: "http://localhost:8080" };
const auth = createAuth(db, env);
const PASSWORD = "Correct-horse-1234";
const app = createApp(pool, "dist/client", auth, { testRoutesEnabled: false }, env.APP_URL, db, async () => undefined);
const UUID = "00000000-0000-4000-8000-000000000000";
const OVERLAP = "This unit already has a lease for those dates.";

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
const count = async (sql: string) => Number((await pool.query(sql)).rows[0].n);

describe("POST /api/units/{id}/leases", () => {
  it("needs a session; the Smoke user cannot write; unknown units are 404", async () => {
    const f = await fixture();
    const noSession = await app.request(`/api/units/${f.res}/leases`, { method: "POST", headers: { origin: env.APP_URL, "content-type": "application/json" }, body: JSON.stringify(body(f)) });
    expect(noSession.status).toBe(401);
    const smoke = await makeUser("smoke@example.com", "smoke");
    expect((await call(smoke.cookie, "POST", `/api/units/${f.res}/leases`, body(f))).status).toBe(403);
    expect((await post(f, UUID)).status).toBe(404);
    expect((await post(f, "nope")).status).toBe(404);
  });

  it("creates a lease with tenants, rent steps, version 1 revision and an audit row", async () => {
    const f = await fixture();
    const res = await post(f, f.res, {
      tenants: [{ tenantId: f.t1, isPrimary: false }, { tenantId: f.t2, isPrimary: true }],
      increaseType: "schedule",
      rentSteps: [{ effectiveDate: "2026-07-01", amountCents: 260000 }],
      securityDepositCents: 250000,
    });
    expect(res.status).toBe(201);
    const created = await json<Lease & { unitId: string; baseRentCents: number }>(res);
    expect(created).toMatchObject({ unitId: f.res, baseRentCents: 250000, version: 1, rentSteps: [{ effectiveDate: "2026-07-01", amountCents: 260000 }] });
    expect(created.tenants).toHaveLength(2);
    expect(created.tenants.find((t) => t.isPrimary)?.tenantId).toBe(f.t2);
    const rev = (await pool.query("select version_number, summary, snapshot from lease_revision where lease_id = $1", [created.id])).rows;
    expect(rev).toHaveLength(1);
    expect(rev[0]).toMatchObject({ version_number: 1, summary: "Lease created" });
    expect(rev[0].snapshot).toMatchObject({ id: created.id, tenants: expect.any(Array), rentSteps: expect.any(Array) });
    expect(await count(`select count(*) n from audit_log where entity_type = 'lease' and entity_id = '${created.id}' and action = 'create'`)).toBe(1);
  });

  it("returns percentages as numbers", async () => {
    const f = await fixture();
    const res = await post(f, f.res, { increaseType: "percent", increasePercent: 3.5 });
    expect((await json<Lease>(res)).increasePercent).toBe(3.5);
  });

  it("validates dates, rent, primary tenant, rent steps and the percent", async () => {
    const f = await fixture();
    expect(await fieldsOf(await post(f, f.res, { endDate: "2026-01-01" }))).toMatchObject({ endDate: expect.any(String) });
    expect(await fieldsOf(await post(f, f.res, { baseRentCents: 0 }))).toHaveProperty("baseRentCents");
    expect(await fieldsOf(await post(f, f.res, { startDate: "2026-02-30" }))).toHaveProperty("startDate");
    expect(await fieldsOf(await post(f, f.res, { tenants: [] }))).toHaveProperty("tenants");
    expect(await fieldsOf(await post(f, f.res, { tenants: [{ tenantId: f.t1, isPrimary: false }] }))).toHaveProperty("tenants");
    expect(await fieldsOf(await post(f, f.res, { tenants: [{ tenantId: f.t1, isPrimary: true }, { tenantId: f.t2, isPrimary: true }] }))).toHaveProperty("tenants");
    expect(await fieldsOf(await post(f, f.res, { increaseType: "percent", increasePercent: 60 }))).toMatchObject({ increasePercent: "Enter a percentage above 0 and up to 50." });
    expect(await fieldsOf(await post(f, f.res, { increaseType: "percent" }))).toHaveProperty("increasePercent");
    expect(await fieldsOf(await post(f, f.res, { rentDueDay: 29 }))).toHaveProperty("rentDueDay");
    const step = (effectiveDate: string) => ({ effectiveDate, amountCents: 260000 });
    for (const rentSteps of [[], [step("2026-01-01")], [step("2026-12-31")], [step("2027-03-01")], [step("2026-08-01"), step("2026-06-01")]]) {
      expect(await fieldsOf(await post(f, f.res, { increaseType: "schedule", rentSteps }))).toHaveProperty("rentSteps");
    }
    expect(await count("select count(*) n from lease")).toBe(0);
  });

  it("applies residential and commercial field rules", async () => {
    const f = await fixture();
    expect(await fieldsOf(await post(f, f.res, { childrenReside: undefined }))).toHaveProperty("childrenReside");
    expect(await fieldsOf(await post(f, f.res, { baseTaxYear: 2024, taxSharePercent: 10 }))).toHaveProperty("baseTaxYear");
    expect(await fieldsOf(await post(f, f.com, { childrenReside: false }))).toHaveProperty("childrenReside");
    expect(await fieldsOf(await post(f, f.com, { childrenReside: undefined, baseTaxYear: 2024 }))).toHaveProperty("taxSharePercent");
    expect(await fieldsOf(await post(f, f.com, { childrenReside: undefined, taxSharePercent: 10 }))).toHaveProperty("baseTaxYear");
    expect((await post(f, f.com, { childrenReside: undefined })).status).toBe(201);
  });

  it("requires the base tax year to exist for the property", async () => {
    const f = await fixture();
    const commercial = { childrenReside: undefined, baseTaxYear: 2024, taxSharePercent: 25 };
    expect(await fieldsOf(await post(f, f.com, commercial))).toHaveProperty("baseTaxYear");
    expect((await call(f.cookie, "POST", `/api/properties/${f.propertyId}/taxes`, { taxYear: 2024, amountCents: 1200000 })).status).toBe(201);
    expect((await post(f, f.com, commercial)).status).toBe(201);
  });

  it("refuses unknown and archived tenants", async () => {
    const f = await fixture();
    expect(await fieldsOf(await post(f, f.res, { tenants: [{ tenantId: UUID, isPrimary: true }] }))).toHaveProperty("tenants");
    const t = await json<{ id: string; version: number }>(await call(f.cookie, "GET", `/api/tenants/${f.t1}`));
    expect((await call(f.cookie, "POST", `/api/tenants/${f.t1}/archive`, { version: t.version })).status).toBe(200);
    expect(await fieldsOf(await post(f, f.res))).toMatchObject({ tenants: "Choose tenants that aren't archived." });
  });

  it("needs a move-out date and reason together", async () => {
    const f = await fixture();
    expect(await fieldsOf(await post(f, f.res, { moveOutDate: "2026-05-01" }))).toHaveProperty("endReason");
    expect(await fieldsOf(await post(f, f.res, { endReason: "Other" }))).toHaveProperty("moveOutDate");
    expect((await post(f, f.res, { moveOutDate: "2026-05-01", endReason: "Tenant moved out" })).status).toBe(201);
  });

  it("rejects overlapping dates but allows adjacent and historical leases", async () => {
    const f = await fixture();
    expect((await post(f, f.res)).status).toBe(201);
    const clash = await post(f, f.res, { startDate: "2026-12-31", endDate: "2027-12-30" });
    expect(clash.status).toBe(409);
    expect(await fieldsOf(clash)).toEqual({ startDate: OVERLAP });
    expect((await post(f, f.res, { startDate: "2027-01-01", endDate: "2027-12-31" })).status).toBe(201);
    expect((await post(f, f.res, { startDate: "2024-01-01", endDate: "2024-12-31" })).status).toBe(201);
    expect((await post(f, f.res, { startDate: "2025-06-01", endDate: "2026-02-01" })).status).toBe(409);
    expect((await post(f, f.com, { childrenReside: undefined })).status).toBe(201);
  });

  it("treats a move-out date as the end of the occupied period, and month-to-month as open-ended", async () => {
    const f = await fixture();
    expect((await post(f, f.res, { moveOutDate: "2026-03-15", endReason: "Tenant moved out" })).status).toBe(201);
    expect((await post(f, f.res, { startDate: "2026-03-16", endDate: "2026-12-31" })).status).toBe(201);
    expect((await post(f, f.res, { startDate: "2020-01-01", endDate: "2020-12-31", monthToMonth: true })).status).toBe(409);
  });

  it("ignores archived leases in the overlap check", async () => {
    const f = await fixture();
    const first = await json<Lease>(await post(f, f.res));
    await pool.query("update lease set archived_at = now() where id = $1", [first.id]);
    expect((await post(f, f.res)).status).toBe(201);
  });

  describe("replaceCurrentLease", () => {
    const shift = (days: number) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

    it("ends the current lease the day before the new start, in the same transaction", async () => {
      const f = await fixture();
      const current = await json<Lease>(await post(f, f.res, { startDate: shift(-100), endDate: shift(200) }));
      const start = shift(10);
      const res = await post(f, f.res, { startDate: start, endDate: shift(400), replaceCurrentLease: { endReason: "Tenant broke lease" } });
      expect(res.status).toBe(201);
      const ended = (await pool.query("select move_out_date::text d, end_reason, version from lease where id = $1", [current.id])).rows[0];
      expect(ended).toMatchObject({ d: shift(9), end_reason: "Tenant broke lease", version: 2 });
      const revisions = (await pool.query("select version_number from lease_revision where lease_id = $1 order by 1", [current.id])).rows;
      expect(revisions.map((r) => r.version_number)).toEqual([1, 2]);
      expect(await count(`select count(*) n from audit_log where entity_id = '${current.id}' and action = 'update'`)).toBe(1);
    });

    it("defaults the reason to Replaced by new lease", async () => {
      const f = await fixture();
      const current = await json<Lease>(await post(f, f.res, { startDate: shift(-100), endDate: shift(200) }));
      expect((await post(f, f.res, { startDate: shift(10), endDate: shift(400), replaceCurrentLease: {} })).status).toBe(201);
      expect((await pool.query("select end_reason from lease where id = $1", [current.id])).rows[0].end_reason).toBe("Replaced by new lease");
    });

    it("still refuses without the option, when the new lease starts on or before the current start, or when it is not the current lease", async () => {
      const f = await fixture();
      await post(f, f.res, { startDate: shift(-100), endDate: shift(200) });
      expect((await post(f, f.res, { startDate: shift(10), endDate: shift(400) })).status).toBe(409);
      const replace = { replaceCurrentLease: { endReason: "Other" } };
      expect((await post(f, f.res, { startDate: shift(-100), endDate: shift(400), ...replace })).status).toBe(409);
      expect((await post(f, f.res, { startDate: shift(-200), endDate: shift(-50), ...replace })).status).toBe(409);
      const upcomingUnit = f.com;
      await post(f, upcomingUnit, { childrenReside: undefined, startDate: shift(30), endDate: shift(300) });
      expect((await post(f, upcomingUnit, { childrenReside: undefined, startDate: shift(60), endDate: shift(400), ...replace })).status).toBe(409);
      expect(await count("select count(*) n from lease")).toBe(2);
    });

    it("refuses when the new lease would clash with more than the current lease", async () => {
      const f = await fixture();
      await post(f, f.res, { startDate: shift(-100), endDate: shift(200) });
      await post(f, f.res, { startDate: shift(300), endDate: shift(600) });
      const res = await post(f, f.res, { startDate: shift(10), endDate: shift(400), replaceCurrentLease: { endReason: "Other" } });
      expect(res.status).toBe(409);
    });

    it("rolls back everything when the new lease is invalid", async () => {
      const f = await fixture();
      const current = await json<Lease>(await post(f, f.res, { startDate: shift(-100), endDate: shift(200) }));
      const res = await post(f, f.res, { startDate: shift(10), endDate: shift(5), replaceCurrentLease: { endReason: "Other" } });
      expect(res.status).toBe(422);
      expect((await pool.query("select version, move_out_date from lease where id = $1", [current.id])).rows[0]).toMatchObject({ version: 1, move_out_date: null });
    });
  });
});

describe("tenant usage", () => {
  it("a tenant on a lease can't be deleted", async () => {
    const f = await fixture();
    await post(f, f.res);
    const t = await json<{ version: number }>(await call(f.cookie, "GET", `/api/tenants/${f.t1}`));
    expect((await call(f.cookie, "DELETE", `/api/tenants/${f.t1}?version=${t.version}`)).status).toBe(409);
  });
});
