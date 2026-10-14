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
    expect(await fieldsOf(clash)).toMatchObject({ startDate: OVERLAP });
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
      const offered = await post(f, f.res, { startDate: shift(10), endDate: shift(400) });
      expect(offered.status).toBe(409);
      expect(await fieldsOf(offered)).toEqual({ startDate: OVERLAP, replaceCurrentLease: "available" });
      const notOffered = await post(f, f.res, { startDate: shift(-100), endDate: shift(400) });
      expect(await fieldsOf(notOffered)).toEqual({ startDate: OVERLAP });
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

describe("new tenants in the same request", () => {
  const ann = { tenantType: "Individual", firstName: "Cy", lastName: "Ng" };
  it("creates them with the lease, audited, and links them", async () => {
    const f = await fixture();
    const res = await post(f, f.res, { tenants: [{ tenantId: f.t1, isPrimary: false }], newTenants: [{ isPrimary: true, tenant: ann }] });
    expect(res.status).toBe(201);
    const created = await json<Lease>(res);
    expect(created.tenants).toHaveLength(2);
    const primary = (await pool.query("select first_name from tenant where id = $1", [created.tenants.find((t) => t.isPrimary)!.tenantId])).rows[0];
    expect(primary.first_name).toBe("Cy");
    expect(await count("select count(*) n from audit_log where entity_type = 'tenant' and summary = 'Created tenant Cy Ng'")).toBe(1);
  });

  it("works with only new tenants", async () => {
    const f = await fixture();
    const res = await post(f, f.res, { tenants: undefined, newTenants: [{ isPrimary: true, tenant: { tenantType: "Business", businessName: "Acme Shop", contactPerson: "Bo Diaz" } }] });
    expect(res.status).toBe(201);
  });

  it("counts them toward the one-primary rule and validates their fields", async () => {
    const f = await fixture();
    expect(await fieldsOf(await post(f, f.res, { newTenants: [{ isPrimary: true, tenant: ann }] }))).toHaveProperty("tenants");
    expect(await fieldsOf(await post(f, f.res, { tenants: [], newTenants: [] }))).toHaveProperty("tenants");
    const bad = await fieldsOf(await post(f, f.res, { tenants: [], newTenants: [{ isPrimary: true, tenant: { tenantType: "Business", businessName: "X" } }] }));
    expect(bad).toHaveProperty(["newTenants.0.tenant.contactPerson"], "Enter a contact person.");
  });

  it("creates nothing when the lease is refused", async () => {
    const f = await fixture();
    await post(f, f.res);
    const before = await count("select count(*) n from tenant");
    const res = await post(f, f.res, { tenants: [], newTenants: [{ isPrimary: true, tenant: ann }] });
    expect(res.status).toBe(409);
    expect(await count("select count(*) n from tenant")).toBe(before);
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

describe("lease reads", () => {
  type Detail = Lease & {
    status: string; statusLabel: string; effectiveEndDate: string; currentRentCents: number; unitLabel: string; propertyId: string;
    current: { tenants: { tenantId: string; displayName: string }[]; baseRentCents: number };
    rentSchedule: { periodStart: string; rentCents: number; term: string }[];
  };
  const make = async (f: Fx, unitId: string, over: Record<string, unknown>) => json<Detail>(await post(f, unitId, over));
  const list = async (f: Fx, query = "") => json<{ data: Detail[]; page: number; pageSize: number; total: number }>(await call(f.cookie, "GET", `/api/leases${query}`));

  it("needs a session and answers 404 for unknown leases", async () => {
    const f = await fixture();
    expect((await app.request("/api/leases")).status).toBe(401);
    for (const path of [`/api/leases/${UUID}`, "/api/leases/nope", `/api/leases/${UUID}/rent-schedule`, `/api/leases/${UUID}/versions`, `/api/leases/${UUID}/versions/1`]) {
      expect((await call(f.cookie, "GET", path)).status, path).toBe(404);
    }
    const smoke = await makeUser("smoke@example.com", "smoke");
    expect((await call(smoke.cookie, "GET", "/api/leases")).status).toBe(200);
  });

  it("lists leases with derived status, filters (status repeatable, property, unit, tenant, archived) and paging", async () => {
    const f = await fixture();
    const ended = await make(f, f.res, { startDate: "2020-01-01", endDate: "2020-12-31" });
    const needs = await make(f, f.com, { startDate: "2021-01-01", endDate: "2021-12-31", childrenReside: null, tenants: [{ tenantId: f.t2, isPrimary: true }] });
    const upcoming = await make(f, f.res, { startDate: "2090-01-01", endDate: "2090-12-31" });
    expect(upcoming.id).toBeTruthy();

    const all = await list(f);
    expect(all.total).toBe(3);
    expect(all.data.map((l) => l.id)).toEqual([upcoming.id, needs.id, ended.id]); // newest start first
    const byId = new Map(all.data.map((l) => [l.id, l]));
    expect(byId.get(ended.id)).toMatchObject({ status: "ended_superseded", unitLabel: "2R" });
    expect(byId.get(needs.id)?.status).toBe("needs_decision");
    expect(byId.get(upcoming.id)?.status).toBe("upcoming");

    expect((await list(f, "?status=upcoming&status=needs_decision")).data.map((l) => l.id).sort()).toEqual([needs.id, upcoming.id].sort());
    expect((await list(f, `?unitId=${f.res}`)).total).toBe(2);
    expect((await list(f, `?propertyId=${f.propertyId}&status=needs_decision`)).total).toBe(1);
    expect((await list(f, `?propertyId=${UUID}`)).total).toBe(0);
    expect((await list(f, `?tenantId=${f.t2}`)).data.map((l) => l.id)).toEqual([needs.id]);
    const paged = await list(f, "?pageSize=2&page=2&status=upcoming&status=needs_decision&status=ended_superseded");
    expect(paged).toMatchObject({ page: 2, pageSize: 2, total: 3 });
    expect(paged.data).toHaveLength(1);
    expect((await list(f, "?sort=startDate&order=asc")).data[0]?.id).toBe(ended.id);

    for (const bad of ["?status=bogus", "?pageSize=201", "?unitId=x", "?sort=rent"]) expect((await call(f.cookie, "GET", `/api/leases${bad}`)).status, bad).toBe(422);
  });

  it("hides archived leases unless asked and marks their status", async () => {
    const f = await fixture();
    const l = await make(f, f.res, { startDate: "2020-01-01", endDate: "2020-12-31" });
    await pool.query("update lease set archived_at = now() where id = $1", [l.id]);
    expect((await list(f)).total).toBe(0);
    const withArchived = await list(f, "?archived=true");
    expect(withArchived.data[0]).toMatchObject({ id: l.id, statusLabel: "Needs decision · Archived" });
  });

  it("finds a tenant who is only on an extension", async () => {
    const f = await fixture();
    const l = await make(f, f.res, { startDate: "2020-01-01", endDate: "2020-12-31" });
    const { rows } = await pool.query(
      `insert into lease_extension (lease_id, start_date, end_date, base_rent_cents) values ($1,'2021-01-01','2021-12-31',260000) returning id`, [l.id]);
    await pool.query("insert into extension_tenant (extension_id, tenant_id, is_primary) values ($1,$2,true), ($1,$3,false)", [rows[0].id, f.t1, f.t2]);
    expect((await list(f, `?tenantId=${f.t2}`)).data.map((x) => x.id)).toEqual([l.id]);
  });

  it("returns the lease with tenants, steps, extensions, status and current-term values", async () => {
    const f = await fixture();
    const l = await make(f, f.res, {
      startDate: "2020-01-01", endDate: "2020-12-31", increaseType: "schedule", increasePercent: null,
      rentSteps: [{ effectiveDate: "2020-07-01", amountCents: 260000 }],
      tenants: [{ tenantId: f.t1, isPrimary: true }, { tenantId: f.t2, isPrimary: false }], pets: "One cat",
    });
    const { rows } = await pool.query(
      `insert into lease_extension (lease_id, start_date, end_date, base_rent_cents, pets) values ($1,'2021-01-01','2021-12-31',275000,'No pets') returning id`, [l.id]);
    await pool.query("insert into extension_tenant (extension_id, tenant_id, is_primary) values ($1,$2,true)", [rows[0].id, f.t2]);

    const res = await call(f.cookie, "GET", `/api/leases/${l.id}`);
    expect(res.status).toBe(200);
    const d = (await res.json()) as Detail & { pets: string; extensions: { id: string; tenants: unknown[] }[]; current: { extensionId: string; pets: string } };
    expect(d).toMatchObject({ id: l.id, status: "needs_decision", statusLabel: "Needs decision", effectiveEndDate: "2021-12-31", currentRentCents: 275000, pets: "One cat", unitLabel: "2R" });
    expect(d.tenants).toHaveLength(2);
    expect(d.rentSteps).toEqual([{ effectiveDate: "2020-07-01", amountCents: 260000 }]);
    expect(d.extensions).toHaveLength(1);
    expect(d.current).toMatchObject({ extensionId: rows[0].id, pets: "No pets", baseRentCents: 275000 });
    expect(d.current.tenants).toEqual([expect.objectContaining({ tenantId: f.t2, displayName: "Bo Lee", isPrimary: true })]);
    expect(d.rentSchedule.map((r) => [r.periodStart, r.rentCents, r.term])).toEqual([
      ["2020-01-01", 250000, "Master lease"], ["2020-07-01", 260000, "Master lease"], ["2021-01-01", 275000, "Extension"],
    ]);

    const schedule = await json<{ data: unknown[]; total: number }>(await call(f.cookie, "GET", `/api/leases/${l.id}/rent-schedule`));
    expect(schedule.total).toBe(3);
    expect(schedule.data).toEqual(d.rentSchedule);
  });

  it("works out the Commercial tax reimbursement and its explanation for the current term", async () => {
    const f = await fixture();
    for (const [year, cents] of [[2020, 4000000], [2025, 5200000]]) {
      await pool.query("insert into property_tax (property_id, tax_year, amount_cents) values ($1,$2,$3)", [f.propertyId, year, cents]);
    }
    const l = await make(f, f.com, { startDate: "2026-01-01", endDate: "2030-12-31", childrenReside: undefined, baseTaxYear: 2020, taxSharePercent: 25 });
    const d = await json<{ current: { taxReimbursementCents: number | null; taxReimbursementExplanation: string | null } }>(await call(f.cookie, "GET", `/api/leases/${l.id}`));
    expect(d.current.taxReimbursementCents).toBe(25000);
    expect(d.current.taxReimbursementExplanation).toBe("25% × (2025 tax $52,000.00 − 2020 tax $40,000.00) ÷ 12");
    const plain = await make(f, f.res, { startDate: "2026-01-01", endDate: "2030-12-31" });
    const p = await json<{ current: { taxReimbursementCents: number | null; taxReimbursementExplanation: string | null } }>(await call(f.cookie, "GET", `/api/leases/${plain.id}`));
    expect(p.current).toMatchObject({ taxReimbursementCents: null, taxReimbursementExplanation: null });
  });

  it("lists lease versions newest first and returns one snapshot", async () => {
    const f = await fixture();
    const l = await make(f, f.res, { startDate: "2020-01-01", endDate: "2020-12-31" });
    await pool.query("update lease set version = 2 where id = $1", [l.id]);
    await pool.query("insert into lease_revision (lease_id, version_number, snapshot, summary) values ($1, 2, '{\"x\":1}', 'Changed rent')", [l.id]);

    const versions = await json<{ data: { versionNumber: number; summary: string; changedByName: string | null; snapshot?: unknown }[]; total: number }>(await call(f.cookie, "GET", `/api/leases/${l.id}/versions`));
    expect(versions.data.map((v) => [v.versionNumber, v.summary])).toEqual([[2, "Changed rent"], [1, "Lease created"]]);
    expect(versions.data[1]?.changedByName).toBe("Name of admin@example.com");
    expect(versions.data[0]).not.toHaveProperty("snapshot");

    const one = await json<{ versionNumber: number; snapshot: { id: string; baseRentCents: number } }>(await call(f.cookie, "GET", `/api/leases/${l.id}/versions/1`));
    expect(one).toMatchObject({ versionNumber: 1, summary: "Lease created", snapshot: { id: l.id, baseRentCents: 250000 } });
    for (const n of ["3", "0", "x"]) expect((await call(f.cookie, "GET", `/api/leases/${l.id}/versions/${n}`)).status, n).toBe(404);
  });
});
