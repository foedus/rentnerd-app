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
  await pool.query('truncate "user", template, audit_log cascade');
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

const text = (t: string) => ({ type: "text", text: t });
const content = (...inline: unknown[]) => ({ type: "doc", content: [{ type: "paragraph", content: inline }] });
const chip = (key: string) => ({ type: "placeholder", attrs: { key } });
const body = (extra: Record<string, unknown> = {}) => ({ name: "Standard residential lease", kind: "master_lease", content: content(text("Tenant: "), chip("tenant_names")), ...extra });
type T = { id: string; name: string; kind: string; version: number; archivedAt: string | null; hasDocuments: boolean; updatedByName: string | null; content?: unknown };
type Err = { error: { code: string; fields?: Record<string, string> } };

describe("templates API", () => {
  it("creates a template that every landlord can read, with who last updated it", async () => {
    const a = await makeUser("a@example.com", "admin");
    const l = await makeUser("l@example.com", "landlord");
    const created = await call(a.cookie, "POST", "/api/templates", body());
    expect(created.status).toBe(201);
    const t = (await created.json()) as T;
    expect(t).toMatchObject({ name: "Standard residential lease", kind: "master_lease", version: 1, archivedAt: null, hasDocuments: false, updatedByName: "Name of a@example.com" });
    const list = (await (await call(l.cookie, "GET", "/api/templates")).json()) as { data: T[]; total: number };
    expect(list.total).toBe(1);
    expect(list.data[0]).toMatchObject({ id: t.id, name: "Standard residential lease" });
    expect(list.data[0]).not.toHaveProperty("content");
    const one = (await (await call(l.cookie, "GET", `/api/templates/${t.id}`)).json()) as T;
    expect(one.content).toEqual(body().content);
  });

  it("refuses an empty name, a duplicate name (any letter case) and an unknown type", async () => {
    const { cookie } = await makeUser("a@example.com", "admin");
    const empty = await call(cookie, "POST", "/api/templates", body({ name: "  " }));
    expect(empty.status).toBe(422);
    expect(((await empty.json()) as Err).error.fields?.name).toBe("Enter a template name.");
    expect((await call(cookie, "POST", "/api/templates", body({ kind: "lease" }))).status).toBe(422);
    expect((await call(cookie, "POST", "/api/templates", body())).status).toBe(201);
    const dup = await call(cookie, "POST", "/api/templates", body({ name: "STANDARD residential LEASE", kind: "extension" }));
    expect(dup.status).toBe(409);
    expect(((await dup.json()) as Err).error.fields?.name).toBe("A template with this name already exists.");
  });

  it("validates the content on save with 422 and saves nothing", async () => {
    const { cookie } = await makeUser("a@example.com", "admin");
    const unknown = await call(cookie, "POST", "/api/templates", body({ content: content(text("{{not_a_key}}")) }));
    expect(unknown.status).toBe(422);
    expect(((await unknown.json()) as Err).error.fields?.content).toBe("Unrecognised placeholders: {{not_a_key}}");
    const ext = await call(cookie, "POST", "/api/templates", body({ content: content(chip("extension_start_date")) }));
    expect(((await ext.json()) as Err).error.fields?.content).toBe("Unrecognised placeholders: {{extension_start_date}} (only available in Lease extension templates)");
    const image = await call(cookie, "POST", "/api/templates", body({ content: { type: "doc", content: [{ type: "image", attrs: { src: "http://x/y.png" } }] } }));
    expect(image.status).toBe(422);
    expect((await call(cookie, "POST", "/api/templates", body({ content: { type: "doc", content: [] } }))).status).toBe(422);
    expect((await call(cookie, "POST", "/api/templates", body({ content: "x" }))).status).toBe(422);
    expect(((await (await call(cookie, "GET", "/api/templates")).json()) as { total: number }).total).toBe(0);
    const okExt = await call(cookie, "POST", "/api/templates", body({ kind: "extension", content: content(chip("extension_start_date")) }));
    expect(okExt.status).toBe(201);
  });

  it("edits name and content, bumps the version, and keeps the type fixed", async () => {
    const { cookie } = await makeUser("a@example.com", "admin");
    const t = (await (await call(cookie, "POST", "/api/templates", body())).json()) as T;
    const edited = await call(cookie, "PATCH", `/api/templates/${t.id}`, { version: 1, name: "Renamed", content: content(text("New text")) });
    expect(edited.status).toBe(200);
    expect(await edited.json()).toMatchObject({ name: "Renamed", version: 2, content: content(text("New text")) });
    const same = (await (await call(cookie, "PATCH", `/api/templates/${t.id}`, { version: 2, name: "Renamed", kind: "master_lease" })).json()) as T;
    expect(same.version).toBe(2);
    const kind = await call(cookie, "PATCH", `/api/templates/${t.id}`, { version: 2, kind: "extension" });
    expect(kind.status).toBe(422);
    expect(((await kind.json()) as Err).error.fields?.kind).toMatch(/can't be changed/);
    const old = await call(cookie, "PATCH", `/api/templates/${t.id}`, { version: 1, name: "Late" });
    expect(old.status).toBe(409);
    const bad = await call(cookie, "PATCH", `/api/templates/${t.id}`, { version: 2, content: content(text("{{extension_end_date}}")) });
    expect(bad.status).toBe(422);
    expect((await call(cookie, "PATCH", `/api/templates/${UUID}`, { version: 1, name: "x" })).status).toBe(404);
  });

  it("refuses renaming onto another template's name", async () => {
    const { cookie } = await makeUser("a@example.com", "admin");
    await call(cookie, "POST", "/api/templates", body({ name: "One" }));
    const two = (await (await call(cookie, "POST", "/api/templates", body({ name: "Two" }))).json()) as T;
    const res = await call(cookie, "PATCH", `/api/templates/${two.id}`, { version: 1, name: "one" });
    expect(res.status).toBe(409);
    expect(((await res.json()) as Err).error.fields?.name).toBe("A template with this name already exists.");
  });

  it("archives and restores; archived templates are listed only on request and free their name", async () => {
    const { cookie } = await makeUser("a@example.com", "admin");
    const t = (await (await call(cookie, "POST", "/api/templates", body())).json()) as T;
    const archived = (await (await call(cookie, "POST", `/api/templates/${t.id}/archive`)).json()) as T;
    expect(archived.archivedAt).not.toBeNull();
    expect(archived.version).toBe(2);
    expect((await call(cookie, "POST", `/api/templates/${t.id}/archive`)).status).toBe(409);
    expect(((await (await call(cookie, "GET", "/api/templates")).json()) as { total: number }).total).toBe(0);
    expect(((await (await call(cookie, "GET", "/api/templates?archived=true")).json()) as { total: number }).total).toBe(1);
    expect((await call(cookie, "POST", "/api/templates", body())).status).toBe(201);
    const clash = await call(cookie, "POST", `/api/templates/${t.id}/restore`);
    expect(clash.status).toBe(409);
    expect(((await clash.json()) as Err).error.fields?.name).toBe("A template with this name already exists.");
    await call(cookie, "PATCH", `/api/templates/${t.id}`, { version: 2, name: "Other name" });
    const restored = (await (await call(cookie, "POST", `/api/templates/${t.id}/restore`, { version: 3 })).json()) as T;
    expect(restored.archivedAt).toBeNull();
    expect((await call(cookie, "POST", `/api/templates/${t.id}/restore`)).status).toBe(409);
    expect((await call(cookie, "POST", `/api/templates/${t.id}/archive`, { version: 1 })).status).toBe(409);
  });

  it("filters the list by type", async () => {
    const { cookie } = await makeUser("a@example.com", "admin");
    await call(cookie, "POST", "/api/templates", body({ name: "M" }));
    await call(cookie, "POST", "/api/templates", body({ name: "E", kind: "extension" }));
    const list = (await (await call(cookie, "GET", "/api/templates?kind=extension")).json()) as { data: T[] };
    expect(list.data.map((t) => t.name)).toEqual(["E"]);
    expect((await call(cookie, "GET", "/api/templates?kind=nope")).status).toBe(422);
  });

  it("deletes an unused template and records everything in the Activity log", async () => {
    const { cookie } = await makeUser("a@example.com", "admin");
    const t = (await (await call(cookie, "POST", "/api/templates", body())).json()) as T;
    await call(cookie, "PATCH", `/api/templates/${t.id}`, { version: 1, content: content(text("Changed")) });
    await call(cookie, "POST", `/api/templates/${t.id}/archive`);
    await call(cookie, "POST", `/api/templates/${t.id}/restore`);
    expect((await call(cookie, "DELETE", `/api/templates/${t.id}`)).status).toBe(204);
    expect((await call(cookie, "GET", `/api/templates/${t.id}`)).status).toBe(404);
    expect((await call(cookie, "DELETE", `/api/templates/${t.id}`)).status).toBe(404);
    const rows = (await pool.query("select action, summary from audit_log where entity_type = 'template' order by at, id")).rows;
    expect(rows.map((r) => r.action)).toEqual(["create", "update", "archive", "restore", "delete"]);
    expect(rows[0].summary).toBe("Added Master lease template Standard residential lease");
  });

  it("lists placeholders for a template type", async () => {
    const { cookie } = await makeUser("a@example.com", "landlord");
    const master = (await (await call(cookie, "GET", "/api/placeholders?kind=master_lease")).json()) as { data: { key: string; label: string }[] };
    const ext = (await (await call(cookie, "GET", "/api/placeholders?kind=extension")).json()) as { data: { key: string; label: string }[] };
    expect(master.data.map((p) => p.label)).not.toContain("Extension start date");
    expect(ext.data.map((p) => p.label)).toContain("Extension start date");
    expect(master.data[0]).toEqual({ key: "today", label: "Today's date", extensionOnly: false });
    expect((await call(cookie, "GET", "/api/placeholders?kind=x")).status).toBe(422);
    expect(((await (await call(cookie, "GET", "/api/placeholders")).json()) as { data: unknown[] }).data).toHaveLength(40);
  });

  it("lets the smoke user read but not write, and needs a session", async () => {
    const admin = await makeUser("a@example.com", "admin");
    const smoke = await makeUser("s@example.com", "smoke");
    const t = (await (await call(admin.cookie, "POST", "/api/templates", body())).json()) as T;
    expect((await call(smoke.cookie, "GET", "/api/templates")).status).toBe(200);
    expect((await call(smoke.cookie, "GET", `/api/templates/${t.id}`)).status).toBe(200);
    expect((await call(smoke.cookie, "GET", "/api/placeholders")).status).toBe(200);
    expect((await call(smoke.cookie, "POST", "/api/templates", body({ name: "X" }))).status).toBe(403);
    expect((await call(smoke.cookie, "PATCH", `/api/templates/${t.id}`, { version: 1, name: "X" })).status).toBe(403);
    expect((await call(smoke.cookie, "POST", `/api/templates/${t.id}/archive`)).status).toBe(403);
    expect((await call(smoke.cookie, "DELETE", `/api/templates/${t.id}`)).status).toBe(403);
    expect((await call("", "GET", "/api/templates")).status).toBe(401);
    expect((await call("", "GET", "/api/placeholders")).status).toBe(401);
    expect((await call(admin.cookie, "GET", "/api/templates/not-a-uuid")).status).toBe(404);
  });
});
