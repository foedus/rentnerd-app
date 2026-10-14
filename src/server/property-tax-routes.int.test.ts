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
  await pool.query('truncate "user", owner, property, unit, property_value, property_tax, audit_log cascade');
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

type Fixture = { cookie: string; propertyId: string };
type Tax = { id: string; version: number; taxYear: number; amountCents: number };

async function fixture(): Promise<Fixture> {
  const { cookie } = await makeUser("admin@example.com", "admin");
  const o = (await (await call(cookie, "POST", "/api/owners", { name: "Acme LLC", ownerType: "LLC", addressLine1: "1 A St", city: "Brooklyn", state: "NY", zip: "11201" })).json()) as { id: string };
  const p = (await (await call(cookie, "POST", "/api/properties", { name: "412 Court St", street: "412 Court St", city: "Brooklyn", state: "NY", zip: "11231", ownerId: o.id })).json()) as { id: string };
  return { cookie, propertyId: p.id };
}
const addTax = (f: Fixture, body: Record<string, unknown>) => call(f.cookie, "POST", `/api/properties/${f.propertyId}/taxes`, body);
const tax = (taxYear: number, amountCents = 1_200_000) => ({ taxYear, amountCents });

describe("property taxes API", () => {
  it("adds tax years and lists them newest first", async () => {
    const f = await fixture();
    expect((await addTax(f, tax(2020, 4_000_000))).status).toBe(201);
    expect((await addTax(f, tax(2025, 5_200_000))).status).toBe(201);
    const list = (await (await call(f.cookie, "GET", `/api/properties/${f.propertyId}/taxes`)).json()) as { data: Tax[]; total: number };
    expect(list.total).toBe(2);
    expect(list.data.map((t) => t.taxYear)).toEqual([2025, 2020]);
    expect(list.data[0]?.amountCents).toBe(5_200_000);
  });

  it("refuses a second entry for the same tax year, on add and on edit, with a field message", async () => {
    const f = await fixture();
    await addTax(f, tax(2025));
    const dup = await addTax(f, tax(2025));
    expect(dup.status).toBe(409);
    expect(((await dup.json()) as { error: { fields: Record<string, string> } }).error.fields).toEqual({ taxYear: "This tax year already exists for this property." });
    const other = (await (await addTax(f, tax(2024))).json()) as Tax;
    const clash = await call(f.cookie, "PATCH", `/api/property-taxes/${other.id}`, { taxYear: 2025, version: other.version });
    expect(clash.status).toBe(409);
    expect(((await clash.json()) as { error: { fields: Record<string, string> } }).error.fields.taxYear).toBe("This tax year already exists for this property.");
  });

  it("allows the same year on different properties", async () => {
    const f = await fixture();
    await addTax(f, tax(2025));
    const o = (await pool.query(`select owner_id from property where id = $1`, [f.propertyId])).rows[0].owner_id as string;
    const p2 = (await (await call(f.cookie, "POST", "/api/properties", { name: "Other", street: "2 B St", city: "Brooklyn", state: "NY", zip: "11231", ownerId: o })).json()) as { id: string };
    expect((await call(f.cookie, "POST", `/api/properties/${p2.id}/taxes`, tax(2025))).status).toBe(201);
  });

  it("validates the year range and amount with the §14.1 envelope", async () => {
    const f = await fixture();
    for (const bad of [tax(1989), tax(2101), tax(2025.5), tax(2025, -1), tax(2025, 1.5), tax(2025, 1_000_000_000_001), { amountCents: 100 }, {}]) {
      const res = await addTax(f, bad);
      expect(res.status).toBe(422);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("VALIDATION_ERROR");
    }
    expect((await addTax(f, tax(1990, 0))).status).toBe(201);
    expect((await addTax(f, tax(2100))).status).toBe(201);
  });

  it("edits with the version, refuses a stale version, ignores no-op edits and writes audit rows", async () => {
    const f = await fixture();
    const t = (await (await addTax(f, tax(2025, 1_200_000))).json()) as Tax;
    const noop = await call(f.cookie, "PATCH", `/api/property-taxes/${t.id}`, { amountCents: 1_200_000, version: t.version });
    expect(((await noop.json()) as Tax).version).toBe(t.version);
    const ok = await call(f.cookie, "PATCH", `/api/property-taxes/${t.id}`, { amountCents: 1_300_000, version: t.version });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as Tax).version).toBe(t.version + 1);
    expect((await call(f.cookie, "PATCH", `/api/property-taxes/${t.id}`, { amountCents: 1, version: t.version })).status).toBe(409);
    expect((await call(f.cookie, "PATCH", `/api/property-taxes/${t.id}`, { amountCents: 1 })).status).toBe(422);
    const audit = (await pool.query(`select action, changes from audit_log where entity_type = 'property_tax' order by at, id`)).rows;
    expect(audit.map((a) => a.action)).toEqual(["create", "update"]);
    expect(audit[1].changes).toEqual({ "Annual property tax": ["$12,000.00", "$13,000.00"] });
  });

  it("hard-deletes a tax year and audits it", async () => {
    const f = await fixture();
    const t = (await (await addTax(f, tax(2025))).json()) as Tax;
    expect((await call(f.cookie, "DELETE", `/api/property-taxes/${t.id}`)).status).toBe(204);
    expect((await call(f.cookie, "DELETE", `/api/property-taxes/${t.id}`)).status).toBe(404);
    expect((await pool.query(`select 1 from property_tax`)).rowCount).toBe(0);
    expect((await pool.query(`select 1 from audit_log where entity_type = 'property_tax' and action = 'delete'`)).rowCount).toBe(1);
  });

  it("returns 404 for unknown properties and tax years", async () => {
    const f = await fixture();
    expect((await call(f.cookie, "GET", `/api/properties/${UUID}/taxes`)).status).toBe(404);
    expect((await call(f.cookie, "POST", `/api/properties/${UUID}/taxes`, tax(2025))).status).toBe(404);
    expect((await call(f.cookie, "PATCH", `/api/property-taxes/${UUID}`, { amountCents: 5, version: 1 })).status).toBe(404);
    expect((await call(f.cookie, "DELETE", `/api/property-taxes/not-a-uuid`)).status).toBe(404);
  });

  it("lets the Smoke user read but not write, and refuses a foreign Origin", async () => {
    const f = await fixture();
    const t = (await (await addTax(f, tax(2025))).json()) as Tax;
    const smoke = await makeUser("smoke@example.com", "smoke");
    expect((await call(smoke.cookie, "GET", `/api/properties/${f.propertyId}/taxes`)).status).toBe(200);
    expect((await addTax({ ...f, cookie: smoke.cookie }, tax(2026))).status).toBe(403);
    expect((await call(smoke.cookie, "PATCH", `/api/property-taxes/${t.id}`, { amountCents: 5, version: 1 })).status).toBe(403);
    expect((await call(smoke.cookie, "DELETE", `/api/property-taxes/${t.id}`)).status).toBe(403);
    const res = await app.request(`/api/properties/${f.propertyId}/taxes`, { method: "POST", headers: { cookie: f.cookie, origin: "https://evil.example", "content-type": "application/json" }, body: JSON.stringify(tax(2027)) });
    expect(res.status).toBe(403);
  });

  it("refuses new tax years on an archived property and removes them when the property is deleted", async () => {
    const f = await fixture();
    await addTax(f, tax(2025));
    await pool.query(`update property set archived_at = now() where id = $1`, [f.propertyId]);
    expect((await addTax(f, tax(2026))).status).toBe(409);
    await pool.query(`delete from property where id = $1`, [f.propertyId]);
    expect((await pool.query(`select 1 from property_tax`)).rowCount).toBe(0);
  });
});
