import { execFileSync } from "node:child_process";
import { Hono } from "hono";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb } from "../db/client";
import { createApp } from "./app";
import { mountErrorHandlers, originCheck, sessionGuard } from "./api-guard";
import { createAuth } from "./auth";
import { mountOwnerRoutes, type OwnerUsage } from "./owner-routes";

const url = "postgres://rentnerd:rentnerd@localhost:5432/rentnerd_test";
const { pool, db } = createDb(url);
const env = { AUTH_SECRET: "integration-test-secret-0123456789abcdef0123456789", APP_URL: "http://localhost:8080" };
const auth = createAuth(db, env);
const PASSWORD = "Correct-horse-1234";
const app = createApp(pool, "dist/client", auth, { testRoutesEnabled: false }, env.APP_URL, db, async () => undefined);

// Same stack with a stand-in for the (not yet built) property tables.
let blocking: { id: string; name: string }[] = [];
let referenced = false;
const usage: OwnerUsage = { activeProperties: async () => blocking, isReferenced: async () => referenced };
const usageApp = new Hono();
mountErrorHandlers(usageApp);
usageApp.use("/api/*", originCheck(env.APP_URL));
usageApp.use("/api/*", sessionGuard(auth));
mountOwnerRoutes(usageApp, db, usage);

beforeAll(() => {
  execFileSync("npm", ["run", "build"], { stdio: "pipe" });
  execFileSync("node", ["dist/migrate.js"], { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
});
beforeEach(async () => {
  blocking = [];
  referenced = false;
  await pool.query('truncate "user", owner, audit_log cascade');
});
afterAll(() => pool.end());

async function makeUser(email: string, role: "admin" | "landlord" | "smoke") {
  const ctx = await auth.$context;
  const [u] = (await pool.query(`insert into "user" (name, email, role, status, email_verified) values ($1,$1,$2,'active',true) returning id`, [email, role])).rows;
  await pool.query(`insert into account (user_id, provider_id, account_id, password) values ($1::uuid,'credential',$1::text,$2)`, [u.id, await ctx.password.hash(PASSWORD)]);
  const res = await app.request("/api/auth/sign-in/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: env.APP_URL },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  return { id: u.id as string, cookie: res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ") };
}
const call = (target: Pick<Hono, "request">, cookie: string, method: string, path: string, body?: unknown) =>
  target.request(path, { method, headers: { cookie, origin: env.APP_URL, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

const valid = { name: "Acme Holdings LLC", ownerType: "LLC", addressLine1: "1 A St", city: "Brooklyn", state: "ny", zip: "11201" };
async function create(cookie: string, extra: Record<string, unknown> = {}) {
  const res = await call(app, cookie, "POST", "/api/owners", { ...valid, ...extra });
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string; version: number; name: string; state: string; archivedAt: string | null };
}

describe("owners API", () => {
  it("requires a session, and the Smoke user may read but not write", async () => {
    expect((await app.request("/api/owners")).status).toBe(401);
    const admin = await makeUser("admin@example.com", "admin");
    const o = await create(admin.cookie);
    const smoke = await makeUser("smoke@example.com", "smoke");
    expect((await call(app, smoke.cookie, "GET", "/api/owners")).status).toBe(200);
    expect((await call(app, smoke.cookie, "POST", "/api/owners", valid)).status).toBe(403);
    expect((await call(app, smoke.cookie, "DELETE", `/api/owners/${o.id}`)).status).toBe(403);
  });

  it("creates an owner (landlords too), normalises fields and audits it", async () => {
    const landlord = await makeUser("l@example.com", "landlord");
    const o = await create(landlord.cookie, { email: " Ann@Example.COM ", phone: "", notes: "  " });
    expect(o).toMatchObject({ state: "NY", version: 1, archivedAt: null, email: "ann@example.com", phone: null, notes: null });
    const { rows } = await pool.query("select action, entity_type, entity_id, actor_user_id from audit_log where action <> 'sign_in'");
    expect(rows).toEqual([{ action: "create", entity_type: "owner", entity_id: o.id, actor_user_id: landlord.id }]);
  });

  it("returns 422 with per-field messages", async () => {
    const admin = await makeUser("admin@example.com", "admin");
    const empty = await call(app, admin.cookie, "POST", "/api/owners", {});
    expect(empty.status).toBe(422);
    const body = await empty.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(Object.keys(body.error.fields).sort()).toEqual(["addressLine1", "city", "name", "ownerType", "state", "zip"]);
    const bad = await call(app, admin.cookie, "POST", "/api/owners", { ...valid, zip: "1234", email: "nope", state: "NYC" });
    expect(Object.keys((await bad.json()).error.fields).sort()).toEqual(["email", "state", "zip"]);
    expect((await call(app, admin.cookie, "POST", "/api/owners", { ...valid, zip: "112011234" })).status).toBe(201);
  });

  it("PATCH bumps the version, records before→after, and a stale version is a 409 CONFLICT", async () => {
    const admin = await makeUser("admin@example.com", "admin");
    const o = await create(admin.cookie);
    const ok = await call(app, admin.cookie, "PATCH", `/api/owners/${o.id}`, { city: "Queens", version: 1 });
    expect(await ok.json()).toMatchObject({ city: "Queens", version: 2, name: o.name });
    const stale = await call(app, admin.cookie, "PATCH", `/api/owners/${o.id}`, { city: "Bronx", version: 1 });
    expect(stale.status).toBe(409);
    expect((await stale.json()).error.code).toBe("CONFLICT");
    expect((await call(app, admin.cookie, "PATCH", `/api/owners/${o.id}`, { city: "Bronx" })).status).toBe(422);
    const { rows } = await pool.query("select changes from audit_log where action = 'update'");
    expect(rows).toEqual([{ changes: { City: ["Brooklyn", "Queens"] } }]);
  });

  it("returns 404 for unknown or malformed ids", async () => {
    const admin = await makeUser("admin@example.com", "admin");
    for (const id of [crypto.randomUUID(), "nope"]) {
      for (const [method, suffix, body] of [["GET", "", undefined], ["PATCH", "", { city: "X", version: 1 }], ["DELETE", "", undefined], ["POST", "/archive", {}], ["POST", "/restore", {}]] as const) {
        const res = await call(app, admin.cookie, method, `/api/owners/${id}${suffix}`, body);
        expect(res.status, `${method} ${id}${suffix}`).toBe(404);
        expect((await res.json()).error.code).toBe("NOT_FOUND");
      }
    }
  });

  it("lists with pagination, sort, search and the archived filter", async () => {
    const admin = await makeUser("admin@example.com", "admin");
    await create(admin.cookie, { name: "Bravo LLC", city: "Albany" });
    await create(admin.cookie, { name: "Alpha 100% Inc", city: "Utica" });
    const gone = await create(admin.cookie, { name: "Charlie Trust", city: "Troy" });
    await call(app, admin.cookie, "POST", `/api/owners/${gone.id}/archive`, {});
    const names = async (qs: string) => ((await (await call(app, admin.cookie, "GET", `/api/owners${qs}`)).json()).data as { name: string }[]).map((o) => o.name);
    expect(await names("")).toEqual(["Alpha 100% Inc", "Bravo LLC"]);
    expect(await names("?archived=true")).toEqual(["Alpha 100% Inc", "Bravo LLC", "Charlie Trust"]);
    expect(await names("?sort=city&order=desc")).toEqual(["Alpha 100% Inc", "Bravo LLC"]);
    expect(await names("?sort=name&order=desc")).toEqual(["Bravo LLC", "Alpha 100% Inc"]);
    expect(await names("?q=albany")).toEqual(["Bravo LLC"]);
    expect(await names("?q=%25")).toEqual(["Alpha 100% Inc"]);
    const page = await (await call(app, admin.cookie, "GET", "/api/owners?page=2&pageSize=1")).json();
    expect(page).toMatchObject({ page: 2, pageSize: 1, total: 2 });
    expect(page.data).toHaveLength(1);
    expect((await call(app, admin.cookie, "GET", "/api/owners?pageSize=201")).status).toBe(422);
    expect((await call(app, admin.cookie, "GET", "/api/owners?sort=bogus")).status).toBe(422);
  });

  it("archives and restores with audit rows and version checks", async () => {
    const admin = await makeUser("admin@example.com", "admin");
    const o = await create(admin.cookie);
    const archived = await (await call(app, admin.cookie, "POST", `/api/owners/${o.id}/archive`, { version: 1 })).json();
    expect(archived).toMatchObject({ version: 2 });
    expect(archived.archivedAt).toBeTruthy();
    expect((await call(app, admin.cookie, "POST", `/api/owners/${o.id}/archive`, {})).status).toBe(409);
    expect((await call(app, admin.cookie, "POST", `/api/owners/${o.id}/restore`, { version: 1 })).status).toBe(409);
    const restored = await (await call(app, admin.cookie, "POST", `/api/owners/${o.id}/restore`, { version: 2 })).json();
    expect(restored).toMatchObject({ version: 3, archivedAt: null });
    const { rows } = await pool.query("select action from audit_log where action <> 'sign_in' order by at");
    expect(rows.map((r) => r.action)).toEqual(["create", "archive", "restore"]);
  });

  it("refuses to archive while non-archived properties use the owner, listing them", async () => {
    const admin = await makeUser("admin@example.com", "admin");
    const o = await create(admin.cookie);
    blocking = [{ id: crypto.randomUUID(), name: "12 Elm St" }];
    const res = await call(usageApp, admin.cookie, "POST", `/api/owners/${o.id}/archive`, {});
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatchObject({ code: "CONFLICT", message: "Change the owner on these properties before archiving this owner:", properties: blocking });
    const { rows } = await pool.query("select archived_at, version from owner");
    expect(rows).toEqual([{ archived_at: null, version: 1 }]);
    blocking = [];
    expect((await call(usageApp, admin.cookie, "POST", `/api/owners/${o.id}/archive`, {})).status).toBe(200);
  });

  it("tells the detail screen whether anything refers to the owner", async () => {
    const admin = await makeUser("admin@example.com", "admin");
    const o = await create(admin.cookie);
    const read = async () => (await (await call(usageApp, admin.cookie, "GET", `/api/owners/${o.id}`)).json()) as { referenced: boolean };
    expect((await read()).referenced).toBe(false);
    referenced = true;
    expect((await read()).referenced).toBe(true);
  });

  it("deletes only unreferenced owners and audits it", async () => {
    const admin = await makeUser("admin@example.com", "admin");
    const o = await create(admin.cookie);
    referenced = true;
    const refused = await call(usageApp, admin.cookie, "DELETE", `/api/owners/${o.id}`);
    expect(refused.status).toBe(409);
    expect((await pool.query("select 1 from owner")).rowCount).toBe(1);
    referenced = false;
    expect((await call(usageApp, admin.cookie, "DELETE", `/api/owners/${o.id}`)).status).toBe(204);
    expect((await pool.query("select 1 from owner")).rowCount).toBe(0);
    expect((await pool.query("select summary from audit_log where action = 'delete'")).rows).toEqual([{ summary: "Deleted owner Acme Holdings LLC" }]);
    expect((await call(app, admin.cookie, "GET", `/api/owners/${o.id}`)).status).toBe(404);
  });

  it("rejects writes with a foreign or missing Origin", async () => {
    const admin = await makeUser("admin@example.com", "admin");
    const o = await create(admin.cookie);
    for (const origin of ["https://evil.example", undefined]) {
      const headers: Record<string, string> = { cookie: admin.cookie, "content-type": "application/json" };
      if (origin) headers.origin = origin;
      for (const [method, path] of [["POST", "/api/owners"], ["PATCH", `/api/owners/${o.id}`], ["DELETE", `/api/owners/${o.id}`]] as [string, string][]) {
        expect((await app.request(path, { method, headers, body: method === "DELETE" ? undefined : JSON.stringify(valid) })).status).toBe(403);
      }
    }
  });
});

describe("owner usage by real properties and units", () => {
  const property = { name: "Court Plaza", street: "1 Elm St", city: "Brooklyn", state: "NY", zip: "11201", inNyc: true };
  it("refuses archive while a non-archived property uses the owner, and delete while anything refers to it", async () => {
    const { cookie } = await makeUser("admin@x.com", "admin");
    const o = await create(cookie);
    const p = await (await call(app, cookie, "POST", "/api/properties", { ...property, ownerId: o.id })).json() as { id: string };
    const archive = await call(app, cookie, "POST", `/api/owners/${o.id}/archive`, { version: o.version });
    expect(archive.status).toBe(409);
    const body = (await archive.json()) as { error: { properties: { id: string; name: string }[] } };
    expect(body.error.properties).toEqual([{ id: p.id, name: "Court Plaza" }]);
    expect((await call(app, cookie, "DELETE", `/api/owners/${o.id}`)).status).toBe(409);
  });

  it("counts a unit's owner override, and the owner is archivable once only archived things refer to it", async () => {
    const { cookie } = await makeUser("admin2@x.com", "admin");
    const base = await create(cookie);
    const other = await create(cookie, { name: "Other LLC" });
    const p = await (await call(app, cookie, "POST", "/api/properties", { ...property, ownerId: base.id })).json() as { id: string };
    const u = await call(app, cookie, "POST", `/api/properties/${p.id}/units`, { label: "2R", use: "Residential", ownerOverrideId: other.id });
    expect(u.status).toBe(201);
    const refused = await call(app, cookie, "POST", `/api/owners/${other.id}/archive`, { version: other.version });
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: { properties: { id: string }[] } }).error.properties.map((x) => x.id)).toEqual([p.id]);
    await pool.query("update property set archived_at = now()");
    expect((await call(app, cookie, "POST", `/api/owners/${other.id}/archive`, { version: other.version })).status).toBe(200);
    expect((await call(app, cookie, "DELETE", `/api/owners/${other.id}`)).status).toBe(409);
  });
});
