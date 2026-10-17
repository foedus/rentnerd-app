import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb } from "../db/client";
import { createApp } from "./app";
import { createAuth } from "./auth";
import { seedComplianceCatalog } from "./compliance-items";
import { addDays, todayNy } from "../shared/dates";

const url = "postgres://rentnerd:rentnerd@localhost:5432/rentnerd_test";
const { pool, db } = createDb(url);
const env = { AUTH_SECRET: "integration-test-secret-0123456789abcdef0123456789", APP_URL: "http://localhost:8080" };
const auth = createAuth(db, env);
const PASSWORD = "Correct-horse-1234";
const app = createApp(pool, "dist/client", auth, { testRoutesEnabled: false }, env.APP_URL, db, async () => undefined);


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
const json = async <T>(r: Response) => (await r.json()) as T;


const today = todayNy();

async function setup() {
  const { cookie } = await makeUser("admin@example.com", "admin");
  const o = await json<{ id: string }>(await call(cookie, "POST", "/api/owners", { name: "Acme LLC", ownerType: "LLC", addressLine1: "1 A St", city: "Brooklyn", state: "NY", zip: "11201" }));
  const property = async (name: string) => (await json<{ id: string }>(await call(cookie, "POST", "/api/properties", { name, street: `1 ${name} St`, city: "Brooklyn", state: "NY", zip: "11231", ownerId: o.id }))).id;
  const unit = async (propertyId: string, label: string, use = "Residential") => (await json<{ id: string }>(await call(cookie, "POST", `/api/properties/${propertyId}/units`, { label, use }))).id;
  const tenantId = (await json<{ id: string }>(await call(cookie, "POST", "/api/tenants", { tenantType: "Individual", firstName: "Ann", lastName: "Lee" }))).id;
  const lease = async (unitId: string, startDate: string, endDate: string, baseRentCents: number, extra: Record<string, unknown> = {}) => {
    const r = await call(cookie, "POST", `/api/units/${unitId}/leases`, { startDate, endDate, baseRentCents, rentDueDay: 1, childrenReside: false, ...extra, tenants: [{ tenantId, isPrimary: true }] });
    expect([r.status, r.status === 201 ? "" : await r.clone().text()]).toEqual([201, ""]);
    return (await json<{ id: string }>(r)).id;
  };
  const dashboard = async () => json<Dash>(await call(cookie, "GET", "/api/dashboard"));
  return { cookie, property, unit, lease, dashboard };
}

interface Dash {
  asOf: string;
  summary: Record<string, number | string | null>;
  byProperty: ({ name: string; propertyType: string } & Record<string, number | string | null>)[];
  leasesNeedingDecision: { leaseId: string; propertyName: string; unitLabel: string; tenants: string[]; endedOn: string; currentRentCents: number }[];
  leasesEndingSoon: { leaseId: string; endDate: string; daysLeft: number; currentRentCents: number }[];
  overdueCompliance: { propertyName: string; itemName: string; dueDate: string; responsible: string[] }[];
  complianceDueSoon: { propertyName: string; itemName: string; dueDate: string; responsible: string[] }[];
}

describe("GET /api/dashboard", () => {
  it("requires a session", async () => {
    expect((await app.request("/api/dashboard")).status).toBe(401);
  });

  it("is readable by the smoke user and empty without data", async () => {
    const smoke = await makeUser("smoke@example.com", "smoke");
    const d = await json<Dash>(await call(smoke.cookie, "GET", "/api/dashboard"));
    expect(d.summary).toMatchObject({ units: 0, occupied: 0, occupancyTenths: null, valueCents: null, grossYieldHundredths: null });
    expect(d.byProperty).toEqual([]);
    expect(d.leasesNeedingDecision).toEqual([]);
    expect(d.leasesEndingSoon).toEqual([]);
  });

  it("computes the Dashboard fixture (AC-DASH-01..03)", async () => {
    const f = await setup();
    const a = await f.property("A");
    const b = await f.property("B");
    expect((await call(f.cookie, "POST", `/api/properties/${a}/values`, { valueDate: "2026-01-01", kind: "market_estimate", amountCents: 100_000_000 })).status).toBe(201);
    const [a1, a2, a3, b1] = [await f.unit(a, "A1"), await f.unit(a, "A2"), await f.unit(a, "A3"), await f.unit(b, "B1", "Commercial")];
    const start = addDays(today, -100);
    const end = addDays(today, 200);
    await f.lease(a1, start, end, 200_000, { parkingChargeCents: 10_000 });
    await f.lease(a2, start, end, 300_000);
    await f.lease(a3, addDays(today, -400), addDays(today, -40), 150_000, { moveOutDate: addDays(today, -40), endReason: "Tenant moved out" });
    await f.lease(b1, start, end, 100_000, { childrenReside: undefined });
    const d = await f.dashboard();
    expect(d.asOf).toBe(today);
    expect(d.summary).toMatchObject({
      units: 4, occupied: 3, vacant: 1, occupancyTenths: 750, monthlyRentRollCents: 600_000, annualRentRollCents: 7_200_000,
      monthlyOtherIncomeCents: 10_000, vacancyLossCents: 150_000, valueCents: 100_000_000, grossYieldHundredths: 612,
      yieldNote: "Based on 1 of 2 properties with a value.",
    });
    const rows = Object.fromEntries(d.byProperty.map((r) => [r.name, r]));
    expect(rows.A).toMatchObject({ propertyType: "Residential", units: 3, occupied: 2, monthlyRentRollCents: 500_000, monthlyOtherIncomeCents: 10_000, grossYieldHundredths: 612 });
    expect(rows.B).toMatchObject({ propertyType: "Commercial", units: 1, occupied: 1, valueCents: null, grossYieldHundredths: null });
  });

  it("lists leases ending in the next 90 days and those needing a decision (AC-DASH-04, 05, 06, 07)", async () => {
    const f = await setup();
    const p = await f.property("P");
    const units = await Promise.all(["U1", "U2", "U3", "U4", "U5", "U6"].map((l) => f.unit(p, l)));
    const start = addDays(today, -300);
    const in45 = await f.lease(units[0]!, start, addDays(today, 45), 100_000);
    const moveOut = await f.lease(units[1]!, start, addDays(today, 300), 110_000, { moveOutDate: addDays(today, 30), endReason: "Not renewed" });
    await f.lease(units[2]!, start, addDays(today, 120), 120_000);
    const mtm = await f.lease(units[3]!, start, addDays(today, -1), 130_000);
    await call(f.cookie, "POST", `/api/leases/${mtm}/month-to-month`, { version: 1 });
    const decision = await f.lease(units[4]!, start, addDays(today, -1), 140_000);
    await f.lease(units[5]!, addDays(today, 10), addDays(today, 375), 150_000);
    const d = await f.dashboard();
    expect(d.leasesEndingSoon.map((r) => [r.leaseId, r.daysLeft])).toEqual([[moveOut, 30], [in45, 45]]);
    expect(d.leasesEndingSoon[0]).toMatchObject({ endDate: addDays(today, 30), currentRentCents: 110_000 });
    expect(d.leasesNeedingDecision).toEqual([expect.objectContaining({ leaseId: decision, propertyName: "P", unitLabel: "U5", tenants: ["Ann Lee"], endedOn: addDays(today, -1), currentRentCents: 140_000 })]);
    expect(d.summary).toMatchObject({ units: 6, occupied: 5, vacant: 1, monthlyRentRollCents: 100_000 + 110_000 + 120_000 + 130_000 + 140_000 });
  });

  it("leaves archived properties, units and leases out", async () => {
    const f = await setup();
    const p = await f.property("P");
    const [u1, u2] = [await f.unit(p, "U1"), await f.unit(p, "U2")];
    await f.lease(u1, addDays(today, -100), addDays(today, 20), 100_000);
    const archivedLease = await f.lease(u2, addDays(today, -100), addDays(today, 20), 100_000);
    await pool.query("update lease set archived_at = now() where id = $1", [archivedLease]);
    expect((await f.dashboard()).leasesEndingSoon).toHaveLength(1);
    await pool.query("update unit set archived_at = now() where id = $1", [u2]);
    expect((await f.dashboard()).summary).toMatchObject({ units: 1, occupied: 1 });
    await pool.query("update property set archived_at = now()");
    const d = await f.dashboard();
    expect(d.byProperty).toEqual([]);
    expect(d.leasesEndingSoon).toEqual([]);
    expect(d.summary).toMatchObject({ units: 0 });
  });

  it("lists overdue and due-in-30-days compliance items, leaving out not-applicable and archived ones (AC-CMP-07)", async () => {
    const f = await setup();
    const p = await f.property("P");
    const archivedProperty = await f.property("Old");
    await seedComplianceCatalog(db);
    await pool.query(
      `update property_compliance_item set applicable = true, next_due_date = null where property_id = any($1::uuid[])`,
      [[p, archivedProperty]],
    );
    const items = (await pool.query("select i.id, t.name from property_compliance_item i join compliance_item_type t on t.id = i.type_id where i.property_id = $1 order by t.name", [p])).rows as { id: string; name: string }[];
    expect(items.length).toBeGreaterThanOrEqual(4);
    const setDue = (id: string, due: string | null, applicable = true) => pool.query("update property_compliance_item set next_due_date = $2, applicable = $3 where id = $1", [id, due, applicable]);
    await setDue(items[0]!.id, addDays(today, -11));
    await setDue(items[1]!.id, addDays(today, 30));
    await setDue(items[2]!.id, addDays(today, 31));
    await setDue(items[3]!.id, addDays(today, -5), false);
    const d = await f.dashboard();
    expect(d.overdueCompliance).toEqual([expect.objectContaining({ propertyName: "P", itemName: items[0]!.name, dueDate: addDays(today, -11), responsible: ["Name of admin@example.com"] })]);
    expect(d.complianceDueSoon).toEqual([expect.objectContaining({ itemName: items[1]!.name, dueDate: addDays(today, 30) })]);
    await pool.query("update property set archived_at = now()");
    const gone = await f.dashboard();
    expect(gone.overdueCompliance).toEqual([]);
    expect(gone.complianceDueSoon).toEqual([]);
  });
});
