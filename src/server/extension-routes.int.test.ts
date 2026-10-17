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
const count = async (sql: string) => Number((await pool.query(sql)).rows[0].n);


const versionsOf = async (f: Fx, id: string) =>
  (await json<{ data: { versionNumber: number; summary: string }[] }>(await call(f.cookie, "GET", `/api/leases/${id}/versions`))).data.map((v) => ({ versionNumber: v.versionNumber, summary: v.summary }));
type Ext = { id: string; startDate: string; endDate: string; baseRentCents: number; pets: string | null; parkingChargeCents: number | null; rentDueDay: number; tenants: { tenantId: string; isPrimary: boolean }[]; notes: string | null };
type Full = Lease & { monthToMonth: boolean; extensions: Ext[] };
const lease = async (f: Fx, unitId = f.res, over: Record<string, unknown> = {}) =>
  json<Full>(await post(f, unitId, { startDate: day(-30), endDate: day(300), pets: "One cat", parkingChargeCents: 10000, rentDueDay: 3, ...over }));
const getLease = async (f: Fx, id: string) => json<Full>(await call(f.cookie, "GET", `/api/leases/${id}`));
const extend = (f: Fx, id: string, over: Record<string, unknown> = {}, version = 1) =>
  call(f.cookie, "POST", `/api/leases/${id}/extensions`, { endDate: day(665), baseRentCents: 225000, version, ...over });

describe("POST /api/leases/{id}/extensions", () => {
  it("needs a session, is refused to the Smoke user and 404s for unknown leases", async () => {
    const f = await fixture();
    const l = await lease(f);
    const bare = await app.request(`/api/leases/${l.id}/extensions`, { method: "POST", headers: { origin: env.APP_URL, "content-type": "application/json" }, body: "{}" });
    expect(bare.status).toBe(401);
    const smoke = await makeUser("smoke@example.com", "smoke");
    expect((await call(smoke.cookie, "POST", `/api/leases/${l.id}/extensions`, { endDate: day(665), baseRentCents: 1, version: 1 })).status).toBe(403);
    expect((await extend(f, UUID)).status).toBe(404);
    expect((await extend(f, "nope")).status).toBe(404);
  });

  it("copies every omitted term and the tenants from the previous term, starts the day after it ends and saves a version", async () => {
    const f = await fixture();
    const l = await lease(f);
    const res = await extend(f, l.id);
    expect(res.status).toBe(201);
    const e = await json<Ext>(res);
    expect(e).toMatchObject({ startDate: day(301), endDate: day(665), baseRentCents: 225000, pets: "One cat", parkingChargeCents: 10000, rentDueDay: 3, tenants: [{ tenantId: f.t1, isPrimary: true }] });
    const after = await getLease(f, l.id);
    expect(after.version).toBe(2);
    expect(after.extensions.map((x) => x.id)).toEqual([e.id]);
    expect(await versionsOf(f, l.id)).toEqual([
      { versionNumber: 2, summary: `Extension added: — → ${(await pool.query("select to_char($1::date, 'Mon FMDD, YYYY') a, to_char($2::date, 'Mon FMDD, YYYY') b", [day(301), day(665)])).rows.map((r) => `${r.a} – ${r.b} at $2,250.00`)[0]}` },
      { versionNumber: 1, summary: "Lease created" },
    ]);
    expect(await count("select count(*) n from audit_log where entity_type = 'lease' and action = 'update'")).toBe(1);
    // A second extension copies from the first, not from the master lease.
    await call(f.cookie, "PATCH", `/api/extensions/${e.id}`, { pets: "No pets", version: 2 });
    const second = await json<Ext>(await extend(f, l.id, { endDate: day(1030) }, 3));
    expect(second).toMatchObject({ startDate: day(666), pets: "No pets" });
  });

  it("uses what is given: dates, tenants, terms, notes, a rent schedule, and null to clear a copied term", async () => {
    const f = await fixture();
    const l = await lease(f);
    const res = await extend(f, l.id, {
      startDate: day(310), pets: "Two cats", parkingChargeCents: 15000, notes: "Renewal", tenants: [{ tenantId: f.t1, isPrimary: false }, { tenantId: f.t2, isPrimary: true }],
      increaseType: "schedule", rentSteps: [{ effectiveDate: day(400), amountCents: 230000 }], parking: null,
    });
    expect(res.status).toBe(201);
    expect(await json<Ext>(res)).toMatchObject({ startDate: day(310), pets: "Two cats", parkingChargeCents: 15000, notes: "Renewal", tenants: expect.arrayContaining([{ tenantId: f.t2, isPrimary: true }]) });
    expect((await getLease(f, l.id)).extensions[0]).toMatchObject({ increaseType: "schedule", rentSteps: [{ effectiveDate: day(400), amountCents: 230000 }] });
  });

  it("sets month-to-month back to false and records it", async () => {
    const f = await fixture();
    const l = await lease(f, f.res, { startDate: day(-400), endDate: day(-35) });
    const mtm = await json<Full>(await call(f.cookie, "POST", `/api/leases/${l.id}/month-to-month`, { version: 1, monthToMonthRentCents: 240000 }));
    expect(mtm.monthToMonth).toBe(true);
    const res = await extend(f, l.id, { endDate: day(300) }, 2);
    expect(res.status).toBe(201);
    expect(await getLease(f, l.id)).toMatchObject({ monthToMonth: false, monthToMonthRentCents: null, version: 3 });
    const audit = (await pool.query("select changes from audit_log where entity_type = 'lease' and entity_id = $1 and summary like 'Added extension%'", [l.id])).rows;
    expect(audit[0].changes["Month-to-month"]).toEqual(["Yes", "No"]);
  });

  it("refuses a start before the previous effective end + 1 day, naming the date", async () => {
    const f = await fixture();
    const l = await lease(f, f.res, { startDate: "2026-01-01", endDate: "2026-10-31" });
    const res = await extend(f, l.id, { startDate: "2026-10-31", endDate: "2027-10-31" });
    expect(res.status).toBe(422);
    expect(await fieldsOf(res)).toEqual({ startDate: "Extension must start on or after Nov 1, 2026." });
    expect((await extend(f, l.id, { startDate: "2026-12-01", endDate: "2027-10-31" })).status).toBe(201);
    expect(await fieldsOf(await extend(f, l.id, { startDate: "2026-12-31", endDate: "2027-12-31" }, 2))).toHaveProperty("startDate");
  });

  it("validates the extension's rules", async () => {
    const f = await fixture();
    const l = await lease(f);
    expect(await fieldsOf(await extend(f, l.id, { endDate: day(301) }))).toHaveProperty("endDate");
    expect(await fieldsOf(await extend(f, l.id, { baseRentCents: 0 }))).toHaveProperty("baseRentCents");
    expect(await fieldsOf(await call(f.cookie, "POST", `/api/leases/${l.id}/extensions`, { version: 1, baseRentCents: 1000 }))).toHaveProperty("endDate");
    expect(await fieldsOf(await extend(f, l.id, { increaseType: "percent" }))).toHaveProperty("increasePercent");
    expect(await fieldsOf(await extend(f, l.id, { increaseType: "schedule", rentSteps: [{ effectiveDate: day(301), amountCents: 1000 }] }))).toHaveProperty("rentSteps");
    expect(await fieldsOf(await extend(f, l.id, { tenants: [{ tenantId: f.t1, isPrimary: false }] }))).toHaveProperty("tenants");
    expect(await fieldsOf(await extend(f, l.id, { baseTaxYear: 2024, taxSharePercent: 10 }))).toHaveProperty("baseTaxYear");
    expect(await fieldsOf(await extend(f, l.id, { tenants: [{ tenantId: UUID, isPrimary: true }, { tenantId: f.t1, isPrimary: false }] }))).toEqual({ tenants: "Choose a tenant." });
    expect((await getLease(f, l.id)).extensions).toHaveLength(0);
  });

  it("keeps at least one master-lease tenant and refuses archived new tenants", async () => {
    const f = await fixture();
    const l = await lease(f);
    const res = await extend(f, l.id, { tenants: [{ tenantId: f.t2, isPrimary: true }] });
    expect(res.status).toBe(422);
    expect(await fieldsOf(res)).toEqual({ tenants: "At least one tenant from the original lease must stay. To change all tenants, end this lease and create a new lease." });
    await pool.query("update tenant set archived_at = now() where id = $1", [f.t2]);
    expect(await fieldsOf(await extend(f, l.id, { tenants: [{ tenantId: f.t1, isPrimary: true }, { tenantId: f.t2, isPrimary: false }] }))).toEqual({ tenants: "Choose tenants that aren't archived." });
    // A later extension is checked against the master lease's tenants, not the previous extension's.
    await pool.query("update tenant set archived_at = null where id = $1", [f.t2]);
    expect((await extend(f, l.id, { tenants: [{ tenantId: f.t1, isPrimary: false }, { tenantId: f.t2, isPrimary: true }] })).status).toBe(201);
    expect((await extend(f, l.id, { endDate: day(1030), tenants: [{ tenantId: f.t2, isPrimary: true }] }, 2)).status).toBe(422);
  });

  it("is refused on ended leases and leases with a move-out date, and for a stale version", async () => {
    const f = await fixture();
    const ended = await lease(f, f.res, { startDate: day(-400), endDate: day(-35), moveOutDate: day(-100), endReason: "Tenant moved out" });
    expect((await extend(f, ended.id)).status).toBe(409);
    const moving = await lease(f, f.com, { childrenReside: undefined, moveOutDate: day(50), endReason: "Not renewed" });
    const res = await extend(f, moving.id);
    expect(res.status).toBe(409);
    expect((await json<{ error: { message: string } }>(res)).error.message).toMatch(/ended lease or one with a move-out date/);
    const l = await lease(f, (await json<{ id: string }>(await call(f.cookie, "POST", `/api/properties/${f.propertyId}/units`, { label: "3R", use: "Residential" }))).id);
    expect((await extend(f, l.id, {}, 5)).status).toBe(409);
    expect((await extend(f, l.id, {}, 0)).status).toBe(422);
    expect((await getLease(f, l.id)).extensions).toHaveLength(0);
  });

  it("is refused when it would run into a later lease on the unit", async () => {
    const f = await fixture();
    const l = await lease(f, f.res, { startDate: day(-30), endDate: day(100) });
    await post(f, f.res, { startDate: day(200), endDate: day(400) });
    const res = await extend(f, l.id, { endDate: day(250) });
    expect(res.status).toBe(409);
    expect((await json<{ error: { message: string } }>(res)).error.message).toBe(OVERLAP);
    expect((await extend(f, l.id, { endDate: day(150) })).status).toBe(201);
  });
});

describe("PATCH and DELETE /api/extensions/{id}", () => {
  const withExtension = async (f: Fx, over: Record<string, unknown> = {}) => {
    const l = await lease(f);
    const e = await json<Ext>(await extend(f, l.id, over));
    return { l, e };
  };
  const patchExt = (f: Fx, id: string, over: Record<string, unknown>, version = 2) => call(f.cookie, "PATCH", `/api/extensions/${id}`, { version, ...over });

  it("needs a session, is refused to the Smoke user and 404s for unknown extensions", async () => {
    const f = await fixture();
    const { e } = await withExtension(f);
    const bare = (method: string) => app.request(`/api/extensions/${e.id}`, { method, headers: { origin: env.APP_URL, "content-type": "application/json" }, body: JSON.stringify({ version: 2 }) });
    expect((await bare("PATCH")).status).toBe(401);
    expect((await bare("DELETE")).status).toBe(401);
    const smoke = await makeUser("smoke@example.com", "smoke");
    expect((await call(smoke.cookie, "PATCH", `/api/extensions/${e.id}`, { version: 2 })).status).toBe(403);
    expect((await call(smoke.cookie, "DELETE", `/api/extensions/${e.id}`)).status).toBe(403);
    for (const id of [UUID, "nope"]) {
      expect((await patchExt(f, id, { pets: "Cat" })).status).toBe(404);
      expect((await call(f.cookie, "DELETE", `/api/extensions/${id}`)).status).toBe(404);
    }
  });

  it("edits the latest extension, saves a version with a readable summary and writes an audit row", async () => {
    const f = await fixture();
    const { l, e } = await withExtension(f);
    const res = await patchExt(f, e.id, { baseRentCents: 230000, pets: "Dog", notes: "Agreed by phone", tenants: [{ tenantId: f.t1, isPrimary: false }, { tenantId: f.t2, isPrimary: true }] });
    expect(res.status).toBe(200);
    expect(await json<Ext>(res)).toMatchObject({ id: e.id, baseRentCents: 230000, pets: "Dog", notes: "Agreed by phone", parkingChargeCents: 10000 });
    expect((await getLease(f, l.id)).version).toBe(3);
    const [latest] = await versionsOf(f, l.id);
    expect(latest!.summary).toContain("Monthly rent: $2,250.00 → $2,300.00");
    expect(latest!.summary).toContain("Pets: One cat → Dog");
    expect(latest!.summary).toContain("Notes: — → Agreed by phone");
    const audit = (await pool.query("select changes from audit_log where entity_type = 'lease' and entity_id = $1 and summary like 'Updated extension%'", [l.id])).rows;
    expect(audit).toHaveLength(1);
    expect(audit[0].changes["Monthly rent"]).toEqual(["$2,250.00", "$2,300.00"]);
  });

  it("does not bump the version when nothing changes, and 409s for a stale version", async () => {
    const f = await fixture();
    const { l, e } = await withExtension(f);
    const same = await patchExt(f, e.id, { baseRentCents: 225000 });
    expect(same.status).toBe(200);
    expect(await json<Ext>(same)).toMatchObject({ id: e.id });
    expect((await getLease(f, l.id)).version).toBe(2);
    expect((await patchExt(f, e.id, { pets: "Dog" }, 1)).status).toBe(409);
    expect((await call(f.cookie, "PATCH", `/api/extensions/${e.id}`, { pets: "Dog" })).status).toBe(422);
  });

  it("re-validates the rules: start on or after the previous end + 1 day, end after start, tenants, rent steps", async () => {
    const f = await fixture();
    const { l, e } = await withExtension(f);
    expect(await fieldsOf(await patchExt(f, e.id, { startDate: day(300) }))).toHaveProperty("startDate");
    expect(await fieldsOf(await patchExt(f, e.id, { endDate: day(301) }))).toHaveProperty("endDate");
    expect(await fieldsOf(await patchExt(f, e.id, { tenants: [{ tenantId: f.t2, isPrimary: true }] }))).toEqual({ tenants: "At least one tenant from the original lease must stay. To change all tenants, end this lease and create a new lease." });
    expect(await fieldsOf(await patchExt(f, e.id, { increaseType: "schedule", rentSteps: [{ effectiveDate: day(100), amountCents: 5 }] }))).toHaveProperty("rentSteps");
    expect((await patchExt(f, e.id, { startDate: day(320), endDate: day(700) })).status).toBe(200);
    expect((await getLease(f, l.id)).version).toBe(3);
  });

  it("only changes or deletes the latest extension, and measures the start against the extension before it", async () => {
    const f = await fixture();
    const { l, e } = await withExtension(f);
    const second = await json<Ext>(await extend(f, l.id, { endDate: day(1030) }, 2));
    for (const [method, body] of [["PATCH", { version: 3, pets: "Dog" }], ["DELETE", undefined]] as const) {
      const res = await call(f.cookie, method, `/api/extensions/${e.id}`, body);
      expect(res.status).toBe(409);
      expect((await json<{ error: { message: string } }>(res)).error.message).toBe("Only the latest extension can be changed.");
    }
    expect(await fieldsOf(await patchExt(f, second.id, { startDate: day(665) }, 3))).toEqual({ startDate: `Extension must start on or after ${(await pool.query("select to_char($1::date, 'Mon FMDD, YYYY') d", [day(666)])).rows[0].d}.` });
    expect((await patchExt(f, second.id, { startDate: day(700) }, 3)).status).toBe(200);
  });

  it("refuses an edit that would clash with a later lease on the unit", async () => {
    const f = await fixture();
    const { e } = await withExtension(f);
    await post(f, f.res, { startDate: day(800), endDate: day(900) });
    const res = await patchExt(f, e.id, { endDate: day(850) });
    expect(res.status).toBe(409);
    expect((await json<{ error: { message: string } }>(res)).error.message).toBe(OVERLAP);
  });

  it("deletes the latest extension with its tenants and steps, saves a version and writes an audit row; the next one can then be removed", async () => {
    const f = await fixture();
    const l = await lease(f);
    const first = await json<Ext>(await extend(f, l.id));
    const second = await json<Ext>(await extend(f, l.id, { endDate: day(1030), increaseType: "schedule", rentSteps: [{ effectiveDate: day(800), amountCents: 240000 }] }, 2));
    const res = await call(f.cookie, "DELETE", `/api/extensions/${second.id}`);
    expect(res.status).toBe(204);
    const after = await getLease(f, l.id);
    expect(after).toMatchObject({ version: 4 });
    expect(after.extensions.map((x) => x.id)).toEqual([first.id]);
    expect(await count(`select count(*) n from extension_tenant where extension_id = '${second.id}'`)).toBe(0);
    expect(await count(`select count(*) n from rent_step where extension_id = '${second.id}'`)).toBe(0);
    expect((await versionsOf(f, l.id))[0]!.summary).toMatch(/^Extension removed: .* at \$2,250\.00 → —$/);
    expect(await count("select count(*) n from audit_log where entity_type = 'lease' and action = 'update' and summary like 'Deleted extension%'")).toBe(1);
    expect((await call(f.cookie, "DELETE", `/api/extensions/${first.id}`)).status).toBe(204);
    expect((await getLease(f, l.id)).extensions).toHaveLength(0);
  });

  it("DELETE honours a version in the body", async () => {
    const f = await fixture();
    const { l, e } = await withExtension(f);
    expect((await call(f.cookie, "DELETE", `/api/extensions/${e.id}`, { version: 1 })).status).toBe(409);
    expect((await call(f.cookie, "DELETE", `/api/extensions/${e.id}`, { version: 2 })).status).toBe(204);
    expect((await getLease(f, l.id)).extensions).toHaveLength(0);
  });
});

describe("GET /api/extensions/{id} and the extension names on the lease", () => {
  it("returns one extension, 404s for unknown ids and needs a session", async () => {
    const f = await fixture();
    const l = await lease(f);
    const e = await json<Ext>(await extend(f, l.id));
    const res = await call(f.cookie, "GET", `/api/extensions/${e.id}`);
    expect(res.status).toBe(200);
    expect(await json<Ext & { leaseId: string }>(res)).toMatchObject({ id: e.id, leaseId: l.id, baseRentCents: 225000 });
    expect((await call(f.cookie, "GET", `/api/extensions/${UUID}`)).status).toBe(404);
    expect((await call(f.cookie, "GET", "/api/extensions/nope")).status).toBe(404);
    expect((await app.request(`/api/extensions/${e.id}`)).status).toBe(401);
  });

  it("names the extension's tenants on the lease detail", async () => {
    const f = await fixture();
    const l = await lease(f);
    await extend(f, l.id);
    const after = await json<{ extensions: { tenants: { tenantId: string; displayName: string }[] }[] }>(await call(f.cookie, "GET", `/api/leases/${l.id}`));
    expect(after.extensions[0]!.tenants).toMatchObject([{ tenantId: f.t1, displayName: "Ann Lee" }]);
  });
});
