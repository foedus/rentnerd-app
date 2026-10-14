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
  await pool.query('truncate "user", owner, property, unit, property_value, audit_log cascade');
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

type Fixture = { cookie: string; ownerId: string; propertyId: string };
type Value = { id: string; version: number; valueDate: string; kind: string; amountCents: number; source: string | null };

async function fixture(extra: Record<string, unknown> = {}): Promise<Fixture> {
  const { cookie } = await makeUser("admin@example.com", "admin");
  const o = (await (await call(cookie, "POST", "/api/owners", { name: "Acme LLC", ownerType: "LLC", addressLine1: "1 A St", city: "Brooklyn", state: "NY", zip: "11201" })).json()) as { id: string };
  const p = (await (await call(cookie, "POST", "/api/properties", { name: "412 Court St", street: "412 Court St", city: "Brooklyn", state: "NY", zip: "11231", ownerId: o.id, ...extra })).json()) as { id: string };
  return { cookie, ownerId: o.id, propertyId: p.id };
}
const addValue = (f: Fixture, body: Record<string, unknown>) => call(f.cookie, "POST", `/api/properties/${f.propertyId}/values`, body);
const currentOf = async (f: Fixture) => ((await (await call(f.cookie, "GET", `/api/properties/${f.propertyId}`)).json()) as { currentValue: { amountCents: number; basis: { kind: string; date?: string } } | null }).currentValue;
const market = (valueDate: string, amountCents: number) => ({ valueDate, kind: "market_estimate", amountCents });

describe("property values API", () => {
  it("adds values, lists newest first and shows the latest market estimate as the current value", async () => {
    const f = await fixture({ purchasePriceCents: 70_000_000 });
    expect(await currentOf(f)).toEqual({ amountCents: 70_000_000, basis: { kind: "purchase_price" } });
    expect((await addValue(f, market("2026-01-01", 90_000_000))).status).toBe(201);
    expect((await addValue(f, { ...market("2026-06-01", 95_000_000), source: "Broker" })).status).toBe(201);
    expect((await addValue(f, { valueDate: "2026-09-01", kind: "assessed", amountCents: 30_000_000 })).status).toBe(201);
    expect(await currentOf(f)).toEqual({ amountCents: 95_000_000, basis: { kind: "market_estimate", date: "2026-06-01" } });
    const list = (await (await call(f.cookie, "GET", `/api/properties/${f.propertyId}/values`)).json()) as { data: Value[]; total: number };
    expect(list.total).toBe(3);
    expect(list.data.map((v) => v.valueDate)).toEqual(["2026-09-01", "2026-06-01", "2026-01-01"]);
    expect(list.data[1]?.source).toBe("Broker");
  });

  it("has no current value without a market estimate or purchase price", async () => {
    const f = await fixture();
    await addValue(f, { valueDate: "2026-02-01", kind: "assessed", amountCents: 100 });
    expect(await currentOf(f)).toBeNull();
  });

  it("validates fields with the §14.1 envelope", async () => {
    const f = await fixture();
    for (const bad of [{ valueDate: "2026-02-30", kind: "market_estimate", amountCents: 100 }, { valueDate: "2026-01-01", kind: "guess", amountCents: 100 }, market("2026-01-01", 0), market("2026-01-01", -5), market("2026-01-01", 1.5), {}]) {
      const res = await addValue(f, bad);
      expect(res.status).toBe(422);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("edits with the version, refuses a stale version and writes audit rows", async () => {
    const f = await fixture();
    const v = (await (await addValue(f, market("2026-01-01", 90_000_000))).json()) as Value;
    const ok = await call(f.cookie, "PATCH", `/api/property-values/${v.id}`, { amountCents: 91_000_000, version: v.version });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as Value).version).toBe(v.version + 1);
    expect((await call(f.cookie, "PATCH", `/api/property-values/${v.id}`, { amountCents: 1, version: v.version })).status).toBe(409);
    expect((await call(f.cookie, "PATCH", `/api/property-values/${v.id}`, { amountCents: 1 })).status).toBe(422);
    expect(await currentOf(f)).toMatchObject({ amountCents: 91_000_000 });
    const audit = (await pool.query(`select action, changes from audit_log where entity_type = 'property_value' order by at, id`)).rows;
    expect(audit.map((a) => a.action)).toEqual(["create", "update"]);
    expect(audit[1].changes).toEqual({ Amount: ["$900,000.00", "$910,000.00"] });
  });

  it("leaves the version alone when nothing changes, breaks same-date ties by creation order and caps the amount", async () => {
    const f = await fixture();
    const first = (await (await addValue(f, market("2026-06-01", 95_000_000))).json()) as Value;
    await addValue(f, market("2026-06-01", 96_000_000));
    const same = await call(f.cookie, "PATCH", `/api/property-values/${first.id}`, { amountCents: 95_000_000, source: null, version: first.version });
    expect(((await same.json()) as Value).version).toBe(first.version);
    const list = (await (await call(f.cookie, "GET", `/api/properties/${f.propertyId}/values`)).json()) as { data: Value[] };
    expect(list.data.map((v) => v.amountCents)).toEqual([96_000_000, 95_000_000]);
    expect(await currentOf(f)).toMatchObject({ amountCents: 96_000_000 });
    expect((await addValue(f, market("2026-07-01", 1_000_000_000_001))).status).toBe(422);
  });

  it("hard-deletes a value, falls back to the next one and audits it", async () => {
    const f = await fixture();
    await addValue(f, market("2026-01-01", 90_000_000));
    const latest = (await (await addValue(f, market("2026-06-01", 95_000_000))).json()) as Value;
    expect((await call(f.cookie, "DELETE", `/api/property-values/${latest.id}`)).status).toBe(204);
    expect(await currentOf(f)).toMatchObject({ amountCents: 90_000_000 });
    expect((await call(f.cookie, "DELETE", `/api/property-values/${latest.id}`)).status).toBe(404);
    expect((await pool.query(`select 1 from audit_log where entity_type = 'property_value' and action = 'delete'`)).rowCount).toBe(1);
  });

  it("returns 404 for unknown properties and values", async () => {
    const f = await fixture();
    expect((await call(f.cookie, "GET", `/api/properties/${UUID}/values`)).status).toBe(404);
    expect((await call(f.cookie, "POST", `/api/properties/${UUID}/values`, market("2026-01-01", 100))).status).toBe(404);
    expect((await call(f.cookie, "PATCH", `/api/property-values/${UUID}`, { amountCents: 5, version: 1 })).status).toBe(404);
    expect((await call(f.cookie, "DELETE", `/api/property-values/not-a-uuid`)).status).toBe(404);
  });

  it("lets the Smoke user read but not write, and refuses a foreign Origin", async () => {
    const f = await fixture();
    const v = (await (await addValue(f, market("2026-01-01", 100))).json()) as Value;
    const smoke = await makeUser("smoke@example.com", "smoke");
    expect((await call(smoke.cookie, "GET", `/api/properties/${f.propertyId}/values`)).status).toBe(200);
    expect((await addValue({ ...f, cookie: smoke.cookie }, market("2026-02-01", 100))).status).toBe(403);
    expect((await call(smoke.cookie, "PATCH", `/api/property-values/${v.id}`, { amountCents: 5, version: 1 })).status).toBe(403);
    expect((await call(smoke.cookie, "DELETE", `/api/property-values/${v.id}`)).status).toBe(403);
    const res = await app.request(`/api/properties/${f.propertyId}/values`, { method: "POST", headers: { cookie: f.cookie, origin: "https://evil.example", "content-type": "application/json" }, body: JSON.stringify(market("2026-03-01", 100)) });
    expect(res.status).toBe(403);
  });

  it("refuses new values on an archived property", async () => {
    const f = await fixture();
    await pool.query(`update property set archived_at = now() where id = $1`, [f.propertyId]);
    expect((await addValue(f, market("2026-01-01", 100))).status).toBe(409);
  });
});
