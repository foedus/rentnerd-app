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

beforeAll(() => {
  execFileSync("npm", ["run", "build"], { stdio: "pipe" });
  execFileSync("node", ["dist/migrate.js"], { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
});
beforeEach(async () => {
  await pool.query('truncate "user", owner, property, unit, investment_entry, audit_log cascade');
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

type Entry = { propertyName: string; unitLabel: string | null; id: string; version: number; entryDate: string; propertyId: string; unitId: string | null; category: string; description: string; vendor: string | null; costCents: number };
type List = { data: Entry[]; total: number; totalCents: number; page: number; pageSize: number };

async function fixture() {
  const { cookie } = await makeUser("admin@example.com", "admin");
  const o = (await (await call(cookie, "POST", "/api/owners", { name: "Acme LLC", ownerType: "LLC", addressLine1: "1 A St", city: "Brooklyn", state: "NY", zip: "11201" })).json()) as { id: string };
  const mk = async (name: string) => ((await (await call(cookie, "POST", "/api/properties", { name, street: name, city: "Brooklyn", state: "NY", zip: "11231", ownerId: o.id })).json()) as { id: string }).id;
  const a = await mk("Property A");
  const b = await mk("Property B");
  const mkUnit = async (pid: string, label: string) => ((await (await call(cookie, "POST", `/api/properties/${pid}/units`, { label, use: "Residential" })).json()) as { id: string }).id;
  return { cookie, a, b, unitA: await mkUnit(a, "1A"), unitB: await mkUnit(b, "2B") };
}
const entry = (propertyId: string, extra: Record<string, unknown> = {}) => ({ entryDate: "2026-09-01", propertyId, category: "Appliance", description: "Replace fridge", vendor: "AJ Madison", costCents: 125_000, ...extra });

describe("investments API", () => {
  it("adds entries and lists them newest first with the total for the whole filter", async () => {
    const f = await fixture();
    const first = await call(f.cookie, "POST", "/api/investments", entry(f.a));
    expect(first.status).toBe(201);
    expect(await first.json()).toMatchObject({ unitId: null, vendor: "AJ Madison", costCents: 125_000, version: 1 });
    await call(f.cookie, "POST", "/api/investments", entry(f.a, { entryDate: "2026-10-01", category: "Repair", description: "Fix roof", vendor: "", costCents: 50_000, unitId: f.unitA }));
    await call(f.cookie, "POST", "/api/investments", entry(f.b, { entryDate: "2026-08-01", category: "Appliance", costCents: 10_000 }));
    const all = (await (await call(f.cookie, "GET", "/api/investments")).json()) as List;
    expect(all.total).toBe(3);
    expect(all.totalCents).toBe(185_000);
    expect(all.data.map((e) => e.entryDate)).toEqual(["2026-10-01", "2026-09-01", "2026-08-01"]);
    expect(all.data[0]?.vendor).toBeNull();
    expect(all.data.map((e) => [e.propertyName, e.unitLabel])).toEqual([["Property A", "1A"], ["Property A", null], ["Property B", null]]);
    const filtered = (await (await call(f.cookie, "GET", `/api/investments?propertyId=${f.a}&category=Appliance`)).json()) as List;
    expect([filtered.total, filtered.totalCents]).toEqual([1, 125_000]);
    const range = (await (await call(f.cookie, "GET", "/api/investments?from=2026-09-01&to=2026-09-30")).json()) as List;
    expect([range.total, range.totalCents]).toEqual([1, 125_000]);
    const paged = (await (await call(f.cookie, "GET", "/api/investments?pageSize=1&page=2")).json()) as List;
    expect([paged.data.length, paged.total, paged.totalCents]).toEqual([1, 3, 185_000]);
    expect(((await (await call(f.cookie, "GET", "/api/investments?propertyId=&category=&from=&to=")).json()) as List).total).toBe(3);
    const none = (await (await call(f.cookie, "GET", `/api/investments?propertyId=${UUID}`)).json()) as List;
    expect([none.total, none.totalCents]).toEqual([0, 0]);
  });

  it("reports each property's Total invested on the property", async () => {
    const f = await fixture();
    const total = async (id: string) => ((await (await call(f.cookie, "GET", `/api/properties/${id}`)).json()) as { totalInvestedCents: number }).totalInvestedCents;
    expect(await total(f.a)).toBe(0);
    const made = (await (await call(f.cookie, "POST", "/api/investments", entry(f.a))).json()) as Entry;
    await call(f.cookie, "POST", "/api/investments", entry(f.a, { costCents: 90_050 }));
    await call(f.cookie, "POST", "/api/investments", entry(f.b, { costCents: 700 }));
    expect([await total(f.a), await total(f.b)]).toEqual([215_050, 700]);
    await call(f.cookie, "DELETE", `/api/investments/${made.id}`);
    expect(await total(f.a)).toBe(90_050);
    const list = (await (await call(f.cookie, "GET", "/api/properties")).json()) as { data: { id: string; totalInvestedCents: number }[] };
    expect(list.data.find((p) => p.id === f.a)?.totalInvestedCents).toBe(90_050);
  });

  it("validates fields and the unit/property relationship", async () => {
    const f = await fixture();
    const bad = await call(f.cookie, "POST", "/api/investments", { entryDate: "2026-02-30", category: "Gifts", description: "  ", costCents: -1 });
    expect(bad.status).toBe(422);
    const fields = ((await bad.json()) as { error: { fields: Record<string, string> } }).error.fields;
    expect(Object.keys(fields).sort()).toEqual(["category", "costCents", "description", "entryDate", "propertyId"]);
    expect((await call(f.cookie, "POST", "/api/investments", entry(f.a, { description: "x".repeat(501) }))).status).toBe(422);
    expect((await call(f.cookie, "POST", "/api/investments", entry(f.a, { costCents: 0 }))).status).toBe(201);
    const wrongUnit = await call(f.cookie, "POST", "/api/investments", entry(f.a, { unitId: f.unitB }));
    expect(wrongUnit.status).toBe(422);
    expect(((await wrongUnit.json()) as { error: { fields: Record<string, string> } }).error.fields.unitId).toBe("Choose a unit of this property.");
    expect((await call(f.cookie, "POST", "/api/investments", entry(UUID))).status).toBe(422);
    expect((await call(f.cookie, "GET", "/api/investments?category=Gifts")).status).toBe(422);
  });

  it("refuses new entries on an archived property or unit", async () => {
    const f = await fixture();
    await pool.query("update unit set archived_at = now() where id = $1", [f.unitA]);
    expect((await call(f.cookie, "POST", "/api/investments", entry(f.a, { unitId: f.unitA }))).status).toBe(422);
    await pool.query("update property set archived_at = now() where id = $1", [f.a]);
    expect((await call(f.cookie, "POST", "/api/investments", entry(f.a))).status).toBe(409);
  });

  it("still lets an entry on an archived property be corrected, but not moved to one", async () => {
    const f = await fixture();
    const e = (await (await call(f.cookie, "POST", "/api/investments", entry(f.a, { unitId: f.unitA }))).json()) as Entry;
    await pool.query("update unit set archived_at = now() where id = $1", [f.unitA]);
    await pool.query("update property set archived_at = now() where id = $1", [f.a]);
    expect((await call(f.cookie, "PATCH", `/api/investments/${e.id}`, { version: 1, costCents: 5 })).status).toBe(200);
    expect((await call(f.cookie, "PATCH", `/api/investments/${e.id}`, { version: 2, propertyId: f.b, unitId: null })).status).toBe(200);
    expect((await call(f.cookie, "PATCH", `/api/investments/${e.id}`, { version: 3, propertyId: f.a })).status).toBe(409);
  });

  it("edits with a version check, audits changes and keeps the unit rules", async () => {
    const f = await fixture();
    const e = (await (await call(f.cookie, "POST", "/api/investments", entry(f.a, { unitId: f.unitA }))).json()) as Entry;
    const res = await call(f.cookie, "PATCH", `/api/investments/${e.id}`, { version: 1, costCents: 99_900, vendor: "" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ version: 2, costCents: 99_900, vendor: null, unitId: f.unitA });
    expect((await call(f.cookie, "PATCH", `/api/investments/${e.id}`, { version: 1, costCents: 1 })).status).toBe(409);
    const same = (await (await call(f.cookie, "PATCH", `/api/investments/${e.id}`, { version: 2, costCents: 99_900 })).json()) as Entry;
    expect(same.version).toBe(2);
    const whole = (await (await call(f.cookie, "PATCH", `/api/investments/${e.id}`, { version: 2, unitId: null })).json()) as Entry;
    expect([whole.unitId, whole.version]).toEqual([null, 3]);
    expect((await call(f.cookie, "PATCH", `/api/investments/${e.id}`, { version: 3, unitId: f.unitB })).status).toBe(422);
    const moved = (await (await call(f.cookie, "PATCH", `/api/investments/${e.id}`, { version: 3, propertyId: f.b, unitId: f.unitB })).json()) as Entry;
    expect([moved.propertyId, moved.unitId]).toEqual([f.b, f.unitB]);
    const toA = (await (await call(f.cookie, "PATCH", `/api/investments/${e.id}`, { version: 4, propertyId: f.a })).json()) as Entry;
    expect([toA.propertyId, toA.unitId]).toEqual([f.a, null]);
    expect((await call(f.cookie, "PATCH", `/api/investments/${UUID}`, { version: 1 })).status).toBe(404);
    expect((await call(f.cookie, "PATCH", "/api/investments/nope", { version: 1 })).status).toBe(404);
    expect((await call(f.cookie, "PATCH", `/api/investments/${e.id}`, { costCents: 1 })).status).toBe(422);
    const audit = (await pool.query("select action, summary, changes from audit_log where entity_type = 'investment_entry' order by at, id")).rows as { action: string; summary: string; changes: Record<string, unknown> | null }[];
    expect(audit.map((r) => r.action)).toEqual(["create", "update", "update", "update", "update"]);
    expect(audit[1]?.changes).toMatchObject({ Cost: ["$1,250.00", "$999.00"], Vendor: ["AJ Madison", null] });
  });

  it("deletes entries for good and audits it", async () => {
    const f = await fixture();
    const e = (await (await call(f.cookie, "POST", "/api/investments", entry(f.a))).json()) as Entry;
    expect((await call(f.cookie, "DELETE", `/api/investments/${e.id}`)).status).toBe(204);
    expect((await call(f.cookie, "DELETE", `/api/investments/${e.id}`)).status).toBe(404);
    expect(((await (await call(f.cookie, "GET", "/api/investments")).json()) as List).totalCents).toBe(0);
    expect((await pool.query("select 1 from audit_log where action = 'delete' and entity_type = 'investment_entry'")).rowCount).toBe(1);
  });

  it("lets landlords write, the smoke user read, and signed-out callers nothing", async () => {
    const f = await fixture();
    const landlord = await makeUser("l@example.com", "landlord");
    const smoke = await makeUser("s@example.com", "smoke");
    expect((await call(landlord.cookie, "POST", "/api/investments", entry(f.a))).status).toBe(201);
    expect((await call(smoke.cookie, "GET", "/api/investments")).status).toBe(200);
    const e = (await (await call(f.cookie, "GET", "/api/investments")).json()) as List;
    const id = e.data[0]?.id ?? UUID;
    expect((await call(smoke.cookie, "POST", "/api/investments", entry(f.a))).status).toBe(403);
    expect((await call(smoke.cookie, "PATCH", `/api/investments/${id}`, { version: 1, costCents: 5 })).status).toBe(403);
    expect((await call(smoke.cookie, "DELETE", `/api/investments/${id}`)).status).toBe(403);
    expect((await app.request("/api/investments")).status).toBe(401);
  });
});
