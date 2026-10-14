import { execFileSync } from "node:child_process";
import { Hono } from "hono";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb } from "../db/client";
import { createApp } from "./app";
import { mountErrorHandlers, originCheck, sessionGuard } from "./api-guard";
import { createAuth } from "./auth";
import { mountTenantRoutes, type TenantUsage } from "./tenant-routes";

const url = "postgres://rentnerd:rentnerd@localhost:5432/rentnerd_test";
const { pool, db } = createDb(url);
const env = { AUTH_SECRET: "integration-test-secret-0123456789abcdef0123456789", APP_URL: "http://localhost:8080" };
const auth = createAuth(db, env);
const PASSWORD = "Correct-horse-1234";
const app = createApp(pool, "dist/client", auth, { testRoutesEnabled: false }, env.APP_URL, db, async () => undefined);

// Same stack with a stand-in for the (not yet built) lease tables.
let onLease = false;
const usage: TenantUsage = { isOnLease: async () => onLease };
const usageApp = new Hono();
mountErrorHandlers(usageApp);
usageApp.use("/api/*", originCheck(env.APP_URL));
usageApp.use("/api/*", sessionGuard(auth));
mountTenantRoutes(usageApp, db, usage);

beforeAll(() => {
  execFileSync("npm", ["run", "build"], { stdio: "pipe" });
  execFileSync("node", ["dist/migrate.js"], { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
});
beforeEach(async () => {
  onLease = false;
  await pool.query('truncate "user", tenant, audit_log cascade');
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

const ann = { tenantType: "Individual", firstName: "Ann", lastName: "Lee" };
const acme = { tenantType: "Business", businessName: "Acme Shop", contactPerson: "Bo Diaz" };
async function create(cookie: string, input: Record<string, unknown> = ann) {
  const res = await call(app, cookie, "POST", "/api/tenants", input);
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string; version: number; displayName: string; archivedAt: string | null; [k: string]: unknown };
}

describe("tenants API", () => {
  it("requires a session, and the Smoke user may read but not write", async () => {
    expect((await app.request("/api/tenants")).status).toBe(401);
    const admin = await makeUser("admin@example.com", "admin");
    const t = await create(admin.cookie);
    const smoke = await makeUser("smoke@example.com", "smoke");
    expect((await call(app, smoke.cookie, "GET", "/api/tenants")).status).toBe(200);
    expect((await call(app, smoke.cookie, "POST", "/api/tenants", ann)).status).toBe(403);
    expect((await call(app, smoke.cookie, "DELETE", `/api/tenants/${t.id}`)).status).toBe(403);
  });

  it("creates an Individual with only names, and a Business, and audits them", async () => {
    const landlord = await makeUser("l@example.com", "landlord");
    const a = await create(landlord.cookie);
    expect(a).toMatchObject({ displayName: "Ann Lee", email: null, phone: null, version: 1, archivedAt: null, businessName: null });
    const b = await create(landlord.cookie, { ...acme, email: " Bo@Example.COM ", phone: "", firstName: "ignored" });
    expect(b).toMatchObject({ displayName: "Acme Shop (Bo Diaz)", email: "bo@example.com", phone: null, firstName: null });
    const { rows } = await pool.query("select action, entity_type, actor_user_id from audit_log where action <> 'sign_in'");
    expect(rows).toEqual([
      { action: "create", entity_type: "tenant", actor_user_id: landlord.id },
      { action: "create", entity_type: "tenant", actor_user_id: landlord.id },
    ]);
  });

  it("returns 422 with per-field messages for each tenant type", async () => {
    const admin = await makeUser("admin@example.com", "admin");
    const fields = async (body: unknown) => Object.keys((await (await call(app, admin.cookie, "POST", "/api/tenants", body)).json()).error.fields).sort();
    expect(await fields({})).toEqual(["tenantType"]);
    expect(await fields({ tenantType: "Individual" })).toEqual(["firstName", "lastName"]);
    expect(await fields({ tenantType: "Business", firstName: "Ann", lastName: "Lee" })).toEqual(["businessName", "contactPerson"]);
    expect(await fields({ ...ann, email: "nope" })).toEqual(["email"]);
  });

  it("PATCH bumps the version, audits before→after, and a stale or missing version is refused", async () => {
    const admin = await makeUser("admin@example.com", "admin");
    const t = await create(admin.cookie);
    const ok = await call(app, admin.cookie, "PATCH", `/api/tenants/${t.id}`, { phone: "555-1212", version: 1 });
    expect(await ok.json()).toMatchObject({ phone: "555-1212", version: 2, displayName: "Ann Lee" });
    const stale = await call(app, admin.cookie, "PATCH", `/api/tenants/${t.id}`, { phone: "1", version: 1 });
    expect(stale.status).toBe(409);
    expect((await stale.json()).error.code).toBe("CONFLICT");
    expect((await call(app, admin.cookie, "PATCH", `/api/tenants/${t.id}`, { phone: "1" })).status).toBe(422);
    const { rows } = await pool.query("select changes from audit_log where action = 'update'");
    expect(rows).toEqual([{ changes: { Phone: [null, "555-1212"] } }]);
  });

  it("PATCH re-checks the type rules on the merged record and clears the other type's names", async () => {
    const admin = await makeUser("admin@example.com", "admin");
    const t = await create(admin.cookie);
    const bad = await call(app, admin.cookie, "PATCH", `/api/tenants/${t.id}`, { tenantType: "Business", version: 1 });
    expect(bad.status).toBe(422);
    expect(Object.keys((await bad.json()).error.fields).sort()).toEqual(["businessName", "contactPerson"]);
    const emptied = await call(app, admin.cookie, "PATCH", `/api/tenants/${t.id}`, { lastName: "", version: 1 });
    expect(emptied.status).toBe(422);
    const ok = await call(app, admin.cookie, "PATCH", `/api/tenants/${t.id}`, { tenantType: "Business", businessName: "Acme", contactPerson: "Ann Lee", version: 1 });
    expect(await ok.json()).toMatchObject({ displayName: "Acme (Ann Lee)", firstName: null, lastName: null, version: 2 });
  });

  it("returns 404 for unknown or malformed ids", async () => {
    const admin = await makeUser("admin@example.com", "admin");
    for (const id of [crypto.randomUUID(), "nope"]) {
      for (const [method, suffix, body] of [["GET", "", undefined], ["PATCH", "", { phone: "1", version: 1 }], ["DELETE", "", undefined], ["POST", "/archive", {}], ["POST", "/restore", {}]] as const) {
        const res = await call(app, admin.cookie, method, `/api/tenants/${id}${suffix}`, body);
        expect(res.status, `${method} ${id}${suffix}`).toBe(404);
        expect((await res.json()).error.code).toBe("NOT_FOUND");
      }
    }
  });

  it("lists with pagination, sort, search and the archived filter", async () => {
    const admin = await makeUser("admin@example.com", "admin");
    await create(admin.cookie, { tenantType: "Individual", firstName: "Bo", lastName: "Zed", email: "bo@x.com" });
    await create(admin.cookie, { tenantType: "Individual", firstName: "Al", lastName: "Adams" });
    await create(admin.cookie, { tenantType: "Business", businessName: "100% Pizza", contactPerson: "Cy" });
    const gone = await create(admin.cookie, { tenantType: "Individual", firstName: "Di", lastName: "Gone" });
    await call(app, admin.cookie, "POST", `/api/tenants/${gone.id}/archive`, {});
    const names = async (qs: string) => ((await (await call(app, admin.cookie, "GET", `/api/tenants${qs}`)).json()).data as { displayName: string }[]).map((t) => t.displayName);
    expect(await names("")).toEqual(["100% Pizza (Cy)", "Al Adams", "Bo Zed"]);
    expect(await names("?archived=true")).toHaveLength(4);
    expect(await names("?sort=name&order=desc")).toEqual(["Bo Zed", "Al Adams", "100% Pizza (Cy)"]);
    expect(await names("?q=BO@x")).toEqual(["Bo Zed"]);
    expect(await names("?q=%25")).toEqual(["100% Pizza (Cy)"]);
    expect(await names("?q=cy")).toEqual(["100% Pizza (Cy)"]);
    const page = await (await call(app, admin.cookie, "GET", "/api/tenants?page=2&pageSize=2")).json();
    expect(page).toMatchObject({ page: 2, pageSize: 2, total: 3 });
    expect(page.data).toHaveLength(1);
    expect((await call(app, admin.cookie, "GET", "/api/tenants?pageSize=201")).status).toBe(422);
    expect((await call(app, admin.cookie, "GET", "/api/tenants?sort=bogus")).status).toBe(422);
  });

  it("archives and restores with audit rows and version checks", async () => {
    const admin = await makeUser("admin@example.com", "admin");
    const t = await create(admin.cookie);
    const archived = await (await call(app, admin.cookie, "POST", `/api/tenants/${t.id}/archive`, { version: 1 })).json();
    expect(archived).toMatchObject({ version: 2 });
    expect(archived.archivedAt).toBeTruthy();
    expect((await call(app, admin.cookie, "POST", `/api/tenants/${t.id}/archive`, {})).status).toBe(409);
    expect((await call(app, admin.cookie, "POST", `/api/tenants/${t.id}/restore`, { version: 1 })).status).toBe(409);
    const restored = await (await call(app, admin.cookie, "POST", `/api/tenants/${t.id}/restore`, { version: 2 })).json();
    expect(restored).toMatchObject({ version: 3, archivedAt: null });
    expect((await call(app, admin.cookie, "POST", `/api/tenants/${t.id}/restore`, {})).status).toBe(409);
    const { rows } = await pool.query("select action from audit_log where action in ('archive','restore') order by at, id");
    expect(rows.map((r) => r.action)).toEqual(["archive", "restore"]);
  });

  it("deletes an unused tenant with an audit row; a tenant on a lease can only be archived", async () => {
    const admin = await makeUser("admin@example.com", "admin");
    const t = await create(admin.cookie);
    const used = await create(admin.cookie, acme);
    onLease = true;
    const refused = await call(usageApp, admin.cookie, "DELETE", `/api/tenants/${used.id}`);
    expect(refused.status).toBe(409);
    expect((await refused.json()).error.code).toBe("CONFLICT");
    expect((await (await call(usageApp, admin.cookie, "GET", `/api/tenants/${used.id}`)).json()).onLease).toBe(true);
    expect((await call(usageApp, admin.cookie, "POST", `/api/tenants/${used.id}/archive`, {})).status).toBe(200);
    onLease = false;
    expect((await call(app, admin.cookie, "DELETE", `/api/tenants/${t.id}`)).status).toBe(204);
    expect((await call(app, admin.cookie, "GET", `/api/tenants/${t.id}`)).status).toBe(404);
    const { rows } = await pool.query("select entity_id from audit_log where action = 'delete'");
    expect(rows).toEqual([{ entity_id: t.id }]);
  });
});
