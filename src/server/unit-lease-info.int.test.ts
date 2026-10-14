import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb } from "../db/client";
import { createApp } from "./app";
import { createAuth } from "./auth";
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

interface Info {
  statusText: string; currentRentCents: number | null; potentialRentCents: number | null; tenants: string[]; leaseEndDate: string | null;
  currentLease: { id: string; statusLabel: string } | null; history: { startDate: string; endDate: string; statusLabel: string; rentAtEndCents: number }[];
}

async function fixture() {
  const { cookie } = await makeUser("admin@example.com", "admin");
  const o = await json<{ id: string }>(await call(cookie, "POST", "/api/owners", { name: "Acme LLC", ownerType: "LLC", addressLine1: "1 A St", city: "Brooklyn", state: "NY", zip: "11201" }));
  const p = await json<{ id: string }>(await call(cookie, "POST", "/api/properties", { name: "412 Court St", street: "412 Court St", city: "Brooklyn", state: "NY", zip: "11231", ownerId: o.id }));
  const unitId = (await json<{ id: string }>(await call(cookie, "POST", `/api/properties/${p.id}/units`, { label: "2R", use: "Residential" }))).id;
  const tenant = async (firstName: string) => (await json<{ id: string }>(await call(cookie, "POST", "/api/tenants", { tenantType: "Individual", firstName, lastName: "Lee" }))).id;
  const [t1, t2] = [await tenant("Ann"), await tenant("Bo")];
  const lease = (startDate: string, endDate: string, baseRentCents: number, extra: Record<string, unknown> = {}) =>
    call(cookie, "POST", `/api/units/${unitId}/leases`, { startDate, endDate, baseRentCents, rentDueDay: 1, childrenReside: false, ...extra, tenants: [{ tenantId: t2, isPrimary: false }, { tenantId: t1, isPrimary: true }] });
  const unit = async () => (await json<{ lease: Info }>(await call(cookie, "GET", `/api/units/${unitId}`))).lease;
  const listed = async () => (await json<{ data: { lease: Info }[] }>(await call(cookie, "GET", `/api/properties/${p.id}/units`))).data[0]!.lease;
  return { cookie, lease, unit, listed };
}

describe("unit lease information", () => {
  const today = todayNy();

  it("a unit without leases is Vacant with no rents", async () => {
    const f = await fixture();
    expect(await f.unit()).toMatchObject({ statusText: "Vacant", currentRentCents: null, potentialRentCents: null, currentLease: null, history: [] });
  });

  it("an active lease makes the unit Occupied with its rent, tenants, end date and a history row", async () => {
    const f = await fixture();
    const end = addDays(today, 200);
    expect((await f.lease(addDays(today, -30), end, 215000)).status).toBe(201);
    for (const info of [await f.unit(), await f.listed()]) {
      expect(info).toMatchObject({ statusText: "Occupied", currentRentCents: 215000, potentialRentCents: null, tenants: ["Ann Lee", "Bo Lee"], leaseEndDate: end });
      expect(info.currentLease?.statusLabel).toBe("Active");
      expect(info.history).toHaveLength(1);
    }
  });

  it("an upcoming lease leaves the unit Vacant · leased from the start date, with the last rent as potential rent", async () => {
    const f = await fixture();
    expect((await f.lease(addDays(today, 40), addDays(today, 400), 190000)).status).toBe(201);
    const info = await f.unit();
    expect(info.statusText).toMatch(/^Vacant · leased from [A-Z][a-z]{2} \d{1,2}, \d{4}$/);
    expect(info).toMatchObject({ currentRentCents: null, potentialRentCents: 190000, currentLease: null });
    expect(info.history[0]?.statusLabel).toBe("Upcoming");
  });

  it("a moving-out lease shows the move-out date as its end", async () => {
    const f = await fixture();
    const out = addDays(today, 60);
    expect((await f.lease(addDays(today, -30), addDays(today, 300), 215000, { moveOutDate: out, endReason: "Tenant moved out" })).status).toBe(201);
    const info = await f.unit();
    expect(info.leaseEndDate).toBe(out);
    expect(info.history[0]).toMatchObject({ endDate: out });
  });

  it("a month-to-month lease has no lease end but keeps its rent", async () => {
    const f = await fixture();
    const created = await json<{ id: string }>(await f.lease(addDays(today, -400), addDays(today, -10), 180000));
    expect((await call(f.cookie, "POST", `/api/leases/${created.id}/month-to-month`, { version: 1, monthToMonthRentCents: 230000 })).status).toBe(200);
    expect(await f.unit()).toMatchObject({ statusText: "Occupied", currentRentCents: 230000, leaseEndDate: null });
  });

  it("a lease past its end with no move-out date and no later lease is Needs decision and still counts as occupied", async () => {
    const f = await fixture();
    expect((await f.lease(addDays(today, -400), addDays(today, -100), 180000)).status).toBe(201);
    expect(await f.unit()).toMatchObject({ statusText: "Occupied", currentRentCents: 180000, potentialRentCents: null });
  });

  it("an ended lease leaves the unit Vacant with its rent at end as potential rent; history is newest first", async () => {
    const f = await fixture();
    expect((await f.lease(addDays(today, -800), addDays(today, -500), 170000)).status).toBe(201);
    expect((await f.lease(addDays(today, -400), addDays(today, -100), 180000, { moveOutDate: addDays(today, -100), endReason: "Tenant moved out" })).status).toBe(201);
    const info = await f.unit();
    expect(info).toMatchObject({ statusText: "Vacant", potentialRentCents: 180000, leaseEndDate: null });
    expect(info.history.map((h) => [h.statusLabel, h.rentAtEndCents])).toEqual([["Ended", 180000], ["Ended (superseded)", 170000]]);
  });
});
