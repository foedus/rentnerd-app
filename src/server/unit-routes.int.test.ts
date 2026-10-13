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
  await pool.query('truncate "user", owner, property, unit, audit_log cascade');
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

type Unit = { id: string; version: number; label: string; use: string; bathrooms: number | null; owner: { id: string; name: string } | null; property: { name: string } };
type Fixture = { cookie: string; ownerId: string; propertyId: string };

async function fixture(): Promise<Fixture> {
  const { cookie } = await makeUser("admin@example.com", "admin");
  const o = (await (await call(cookie, "POST", "/api/owners", { name: "Acme LLC", ownerType: "LLC", addressLine1: "1 A St", city: "Brooklyn", state: "NY", zip: "11201" })).json()) as { id: string };
  const p = (await (await call(cookie, "POST", "/api/properties", { name: "412 Court St", street: "412 Court St", city: "Brooklyn", state: "NY", zip: "11231", ownerId: o.id })).json()) as { id: string };
  return { cookie, ownerId: o.id, propertyId: p.id };
}
const addUnit = async (f: Fixture, body: Record<string, unknown>) => call(f.cookie, "POST", `/api/properties/${f.propertyId}/units`, body);
const propertyOf = async (f: Fixture) => (await (await call(f.cookie, "GET", `/api/properties/${f.propertyId}`)).json()) as { propertyType: string };

describe("units API", () => {
  it("needs a session; the Smoke user can read but not write", async () => {
    const f = await fixture();
    expect((await app.request(`/api/properties/${f.propertyId}/units`)).status).toBe(401);
    expect((await app.request(`/api/units/${UUID}`)).status).toBe(401);
    const smoke = await makeUser("smoke@example.com", "smoke");
    expect((await call(smoke.cookie, "GET", `/api/properties/${f.propertyId}/units`)).status).toBe(200);
    expect((await call(smoke.cookie, "POST", `/api/properties/${f.propertyId}/units`, { label: "2R", use: "Residential" })).status).toBe(403);
  });

  it("creates a unit, returns the property's owner and audits it", async () => {
    const f = await fixture();
    const res = await addUnit(f, { label: "2R", use: "Residential", bedrooms: 2, bathrooms: 1.5, squareFeet: 800, notes: "Sunny" });
    expect(res.status).toBe(201);
    const u = (await res.json()) as Unit;
    expect(u).toMatchObject({ label: "2R", use: "Residential", bathrooms: 1.5, version: 1, property: { name: "412 Court St" }, owner: { name: "Acme LLC" } });
    const read = await call(f.cookie, "GET", `/api/units/${u.id}`);
    expect(await read.json()).toMatchObject({ id: u.id, label: "2R" });
    const audit = await pool.query("select action, summary from audit_log where entity_type = 'unit'");
    expect(audit.rows).toEqual([{ action: "create", summary: "Created unit 2R (Residential)" }]);
  });

  it("validates fields with the 422 envelope", async () => {
    const f = await fixture();
    const res = await addUnit(f, { use: "Garage", bedrooms: 40 });
    expect(res.status).toBe(422);
    const { error } = (await res.json()) as { error: { code: string; fields: Record<string, string> } };
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(Object.keys(error.fields).sort()).toEqual(["bedrooms", "label", "use"]);
  });

  it("refuses a duplicate label within a property, ignoring capitals, but allows it in another property", async () => {
    const f = await fixture();
    expect((await addUnit(f, { label: "2R", use: "Residential" })).status).toBe(201);
    const dup = await addUnit(f, { label: "2r", use: "Commercial" });
    expect(dup.status).toBe(409);
    expect(await dup.json()).toMatchObject({ error: { code: "CONFLICT", fields: { label: "A unit with this label already exists in this property." } } });
    const other = (await (await call(f.cookie, "POST", "/api/properties", { name: "Other", street: "2 B St", city: "Queens", state: "NY", zip: "11101", ownerId: f.ownerId })).json()) as { id: string };
    expect((await call(f.cookie, "POST", `/api/properties/${other.id}/units`, { label: "2R", use: "Residential" })).status).toBe(201);
  });

  it("reuses a label once the unit holding it is archived", async () => {
    const f = await fixture();
    const u = (await (await addUnit(f, { label: "2R", use: "Residential" })).json()) as Unit;
    await pool.query("update unit set archived_at = now() where id = $1", [u.id]);
    expect((await addUnit(f, { label: "2R", use: "Residential" })).status).toBe(201);
    const list = (await (await call(f.cookie, "GET", `/api/properties/${f.propertyId}/units`)).json()) as { total: number };
    expect(list.total).toBe(1);
    const all = (await (await call(f.cookie, "GET", `/api/properties/${f.propertyId}/units?archived=true`)).json()) as { total: number };
    expect(all.total).toBe(2);
  });

  it("lists units sorted and paged, and gives 404 for an unknown property", async () => {
    const f = await fixture();
    for (const label of ["B", "A", "C"]) await addUnit(f, { label, use: "Residential" });
    const list = (await (await call(f.cookie, "GET", `/api/properties/${f.propertyId}/units?pageSize=2`)).json()) as { data: Unit[]; page: number; pageSize: number; total: number };
    expect(list.data.map((u) => u.label)).toEqual(["A", "B"]);
    expect(list).toMatchObject({ page: 1, pageSize: 2, total: 3 });
    const desc = (await (await call(f.cookie, "GET", `/api/properties/${f.propertyId}/units?order=desc`)).json()) as { data: Unit[] };
    expect(desc.data.map((u) => u.label)).toEqual(["C", "B", "A"]);
    expect((await call(f.cookie, "GET", `/api/properties/${UUID}/units`)).status).toBe(404);
    expect((await call(f.cookie, "GET", "/api/properties/nope/units")).status).toBe(404);
    expect((await call(f.cookie, "POST", `/api/properties/${UUID}/units`, { label: "A", use: "Residential" })).status).toBe(404);
    expect((await call(f.cookie, "GET", `/api/units/${UUID}`)).status).toBe(404);
  });

  it("does not add units to an archived property", async () => {
    const f = await fixture();
    await pool.query("update property set archived_at = now()");
    const res = await addUnit(f, { label: "2R", use: "Residential" });
    expect(res.status).toBe(409);
  });

  it("applies an owner override and rejects a missing or archived owner", async () => {
    const f = await fixture();
    const other = (await (await call(f.cookie, "POST", "/api/owners", { name: "Zed Corp", ownerType: "Corporation", addressLine1: "3 C St", city: "Queens", state: "NY", zip: "11101" })).json()) as { id: string };
    const u = (await (await addUnit(f, { label: "Store", use: "Commercial", ownerOverrideId: other.id })).json()) as Unit;
    expect(u.owner).toMatchObject({ id: other.id, name: "Zed Corp" });
    expect((await addUnit(f, { label: "X", use: "Commercial", ownerOverrideId: UUID })).status).toBe(422);
    await pool.query("update owner set archived_at = now() where id = $1", [other.id]);
    const res = await addUnit(f, { label: "Y", use: "Commercial", ownerOverrideId: other.id });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: { fields: { ownerOverrideId: "Choose an owner that isn't archived." } } });
    // An override that is already set may stay even once archived; clearing it falls back to the property owner.
    const keep = await call(f.cookie, "PATCH", `/api/units/${u.id}`, { notes: "kept", version: u.version });
    expect(keep.status).toBe(200);
    const cleared = (await (await call(f.cookie, "PATCH", `/api/units/${u.id}`, { ownerOverrideId: null, version: 2 })).json()) as Unit;
    expect(cleared.owner?.name).toBe("Acme LLC");
  });

  it("edits a unit, bumps the version, audits before → after and refuses stale versions", async () => {
    const f = await fixture();
    const u = (await (await addUnit(f, { label: "2R", use: "Residential", bedrooms: 1 })).json()) as Unit;
    const res = await call(f.cookie, "PATCH", `/api/units/${u.id}`, { label: "2F", bedrooms: 2, bathrooms: 2, version: u.version });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ label: "2F", bedrooms: 2, bathrooms: 2, version: 2 });
    const audit = await pool.query("select changes from audit_log where action = 'update' and entity_type = 'unit'");
    expect(audit.rows[0].changes).toMatchObject({ "Unit label": ["2R", "2F"], Bedrooms: ["1", "2"] });
    const stale = await call(f.cookie, "PATCH", `/api/units/${u.id}`, { label: "3F", version: 1 });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ error: { code: "CONFLICT" } });
    expect((await call(f.cookie, "PATCH", `/api/units/${u.id}`, { label: "3F" })).status).toBe(422);
    expect((await call(f.cookie, "PATCH", `/api/units/${UUID}`, { label: "3F", version: 1 })).status).toBe(404);
  });

  it("refuses to change use (422) but accepts the same use, and refuses a clashing label on edit", async () => {
    const f = await fixture();
    const u = (await (await addUnit(f, { label: "2R", use: "Residential" })).json()) as Unit;
    await addUnit(f, { label: "3R", use: "Residential" });
    const bad = await call(f.cookie, "PATCH", `/api/units/${u.id}`, { use: "Commercial", version: u.version });
    expect(bad.status).toBe(422);
    expect(await bad.json()).toMatchObject({ error: { code: "VALIDATION_ERROR", fields: { use: "Use can't be changed. To change it, archive this unit and add a new one." } } });
    expect((await call(f.cookie, "PATCH", `/api/units/${u.id}`, { use: "Residential", version: u.version })).status).toBe(200);
    expect((await call(f.cookie, "PATCH", `/api/units/${u.id}`, { label: "3r", version: 2 })).status).toBe(409);
  });

  it("derives the property type from its non-archived units", async () => {
    const f = await fixture();
    expect((await propertyOf(f)).propertyType).toBe("—");
    const a = (await (await addUnit(f, { label: "1", use: "Residential" })).json()) as Unit;
    expect((await propertyOf(f)).propertyType).toBe("Residential");
    await addUnit(f, { label: "Store", use: "Commercial" });
    expect((await propertyOf(f)).propertyType).toBe("Mixed");
    await pool.query("update unit set archived_at = now() where id = $1", [a.id]);
    expect((await propertyOf(f)).propertyType).toBe("Commercial");
  });

  it("creates the single \"Entire property\" unit with a new single-unit property", async () => {
    const f = await fixture();
    const res = await call(f.cookie, "POST", "/api/properties", { name: "Corner Store", street: "9 D St", city: "Queens", state: "NY", zip: "11101", ownerId: f.ownerId, singleUnitUse: "Commercial" });
    expect(res.status).toBe(201);
    const p = (await res.json()) as { id: string; propertyType: string };
    expect(p.propertyType).toBe("Commercial");
    const list = (await (await call(f.cookie, "GET", `/api/properties/${p.id}/units`)).json()) as { data: Unit[] };
    expect(list.data.map((u) => [u.label, u.use])).toEqual([["Entire property", "Commercial"]]);
    const bad = await call(f.cookie, "POST", "/api/properties", { name: "X", street: "9 D St", city: "Queens", state: "NY", zip: "11101", ownerId: f.ownerId, singleUnitUse: "Mixed" });
    expect(bad.status).toBe(422);
    // A refused property leaves no stray unit behind.
    await call(f.cookie, "POST", "/api/properties", { name: "corner store", street: "9 D St", city: "Queens", state: "NY", zip: "11101", ownerId: f.ownerId, singleUnitUse: "Residential" });
    expect((await pool.query("select count(*)::int as n from unit")).rows[0].n).toBe(1);
  });
});
