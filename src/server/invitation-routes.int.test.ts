import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb } from "../db/client";
import { createApp } from "./app";
import { createAuth } from "./auth";
import { createInvitation } from "./invitations";

const url = "postgres://rentnerd:rentnerd@localhost:5432/rentnerd_test";
const { pool, db } = createDb(url);
const env = { AUTH_SECRET: "integration-test-secret-0123456789abcdef0123456789", APP_URL: "http://localhost:8080" };
const auth = createAuth(db, env);
const app = () => createApp(pool, "dist/client", auth, { testRoutesEnabled: false }, env.APP_URL, db);
const PASSWORD = "Pat-password-00001";

beforeAll(() => {
  execFileSync("npm", ["run", "build"], { stdio: "pipe" });
  execFileSync("node", ["dist/migrate.js"], { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
});
beforeEach(() => pool.query('truncate "user" cascade'));
afterAll(() => pool.end());

async function invite(email = "pat@example.com") {
  const [u] = (await pool.query(`insert into "user" (name, email, role, status) values ('Pat Lee', $1, 'landlord', 'invited') returning id`, [email])).rows;
  return { userId: u.id as string, ...(await createInvitation(db, u.id, null)) };
}
const post = (a: ReturnType<typeof app>, path: string, body: unknown, headers: Record<string, string> = {}) =>
  a.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", origin: env.APP_URL, ...headers },
    body: JSON.stringify(body),
  });
const cookieOf = (res: Response) => res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");

describe("GET /api/invitations/lookup", () => {
  it("returns the email and prefilled name for a live token, with no session", async () => {
    const { token } = await invite();
    const res = await app().request(`/api/invitations/lookup?token=${token}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ email: "pat@example.com", name: "Pat Lee" });
  });

  it.each(["", "?token=nope"])("answers 404 NOT_FOUND for a missing or unknown token (%s)", async (q) => {
    const res = await app().request(`/api/invitations/lookup${q}`);
    expect(res.status).toBe(404);
    expect((await res.json()).error).toMatchObject({ code: "NOT_FOUND", message: expect.stringContaining("invalid or has expired") });
  });

  it("rejects expired and revoked invitations", async () => {
    const { token, userId } = await invite();
    await pool.query("update invitation set expires_at = now() - interval '1 minute'");
    expect((await app().request(`/api/invitations/lookup?token=${token}`)).status).toBe(404);
    await pool.query("update invitation set expires_at = now() + interval '1 day', revoked_at = now()");
    expect((await app().request(`/api/invitations/lookup?token=${token}`)).status).toBe(404);
    expect(userId).toBeTruthy();
  });

  it("is limited to 20 requests per IP per 15 minutes", async () => {
    const a = app();
    for (let i = 0; i < 20; i++) expect((await a.request("/api/invitations/lookup?token=x")).status).toBe(404);
    const res = await a.request("/api/invitations/lookup?token=x");
    expect(res.status).toBe(429);
    expect((await res.json()).error.code).toBe("RATE_LIMITED");
  });
});

describe("POST /api/invitations/accept", () => {
  it("sets the password, verifies the email, activates, and signs the user in", async () => {
    const { token } = await invite();
    const a = app();
    const res = await post(a, "/api/invitations/accept", { token, name: "Patricia Lee", password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie().join(";")).toMatch(/HttpOnly/i);
    const me = await a.request("/api/me", { headers: { cookie: cookieOf(res) } });
    expect(await me.json()).toMatchObject({ name: "Patricia Lee", email: "pat@example.com", role: "landlord", status: "active" });
    expect((await pool.query('select email_verified from "user"')).rows[0].email_verified).toBe(true);
    expect((await pool.query("select accepted_at from invitation")).rows[0].accepted_at).not.toBeNull();
    // the password works for a normal sign-in too
    const again = await post(a, "/api/auth/sign-in/email", { email: "pat@example.com", password: PASSWORD });
    expect(again.status).toBe(200);
  });

  it("is single use, also under concurrent requests", async () => {
    const { token } = await invite();
    const a = app();
    const results = await Promise.all(
      [1, 2, 3].map(() => post(a, "/api/invitations/accept", { token, name: "Pat", password: PASSWORD })),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 404, 404]);
    expect((await pool.query("select 1 from account")).rowCount).toBe(1);
  });

  it("rejects used, expired and revoked links with 404 and does not change the user", async () => {
    const { token } = await invite();
    await pool.query("update invitation set revoked_at = now()");
    const res = await post(app(), "/api/invitations/accept", { token, name: "Pat", password: PASSWORD });
    expect(res.status).toBe(404);
    expect((await pool.query('select status from "user"')).rows[0].status).toBe("invited");
    expect((await pool.query("select 1 from account")).rowCount).toBe(0);
  });

  it("validates the body with 422 field messages, and bad JSON with 400", async () => {
    const { token } = await invite();
    const a = app();
    const short = await post(a, "/api/invitations/accept", { token, name: " ", password: "short" });
    expect(short.status).toBe(422);
    const body = await short.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(Object.keys(body.error.fields).sort()).toEqual(["name", "password"]);
    const bad = await a.request("/api/invitations/accept", { method: "POST", headers: { origin: env.APP_URL }, body: "{" });
    expect(bad.status).toBe(400);
    expect((await pool.query('select status from "user"')).rows[0].status).toBe("invited");
  });

  it("requires the app Origin and is rate limited", async () => {
    const a = app();
    expect((await post(a, "/api/invitations/accept", {}, { origin: "http://evil.test" })).status).toBe(403);
    for (let i = 0; i < 20; i++) await post(a, "/api/invitations/accept", { token: "x", name: "P", password: PASSWORD });
    expect((await post(a, "/api/invitations/accept", { token: "x", name: "P", password: PASSWORD })).status).toBe(429);
  });
});

describe("/api/me", () => {
  async function signedIn() {
    const { token } = await invite();
    const a = app();
    const res = await post(a, "/api/invitations/accept", { token, name: "Pat Lee", password: PASSWORD });
    return { a, cookie: cookieOf(res) };
  }

  it("needs a session", async () => {
    expect((await app().request("/api/me")).status).toBe(401);
    expect((await post(app(), "/api/me", {})).status).toBe(401);
  });

  it("PATCH changes only the signed-in user's name and validates it", async () => {
    const { a, cookie } = await signedIn();
    await pool.query(`insert into "user" (name, email) values ('Other', 'other@example.com')`);
    const patch = (body: unknown) =>
      a.request("/api/me", { method: "PATCH", headers: { cookie, origin: env.APP_URL, "content-type": "application/json" }, body: JSON.stringify(body) });
    const ok = await patch({ name: "  New Name " });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ name: "New Name", email: "pat@example.com" });
    expect((await pool.query(`select name from "user" where email = 'other@example.com'`)).rows[0].name).toBe("Other");
    const bad = await patch({ name: "" });
    expect(bad.status).toBe(422);
    expect((await bad.json()).error.fields.name).toBeTruthy();
  });
});
