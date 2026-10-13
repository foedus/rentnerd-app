import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createDb } from "../db/client";
import type { EnqueueEmail } from "../worker/email";
import { createApp } from "./app";
import { createAuth } from "./auth";

const url = "postgres://rentnerd:rentnerd@localhost:5432/rentnerd_test";
const { pool, db } = createDb(url);
const env = { AUTH_SECRET: "integration-test-secret-0123456789abcdef0123456789", APP_URL: "http://localhost:8080" };
const OLD = "Old-password-0001";
const NEW = "Brand-new-password-0002";
let sent: EnqueueEmail[] = [];
let auth = createAuth(db, env);
const app = () => createApp(pool, "dist/client", auth, { testRoutesEnabled: false }, env.APP_URL, db, async (e) => void sent.push(e));
const send = (a: ReturnType<typeof app>, method: string, path: string, body: unknown, cookie = "") =>
  a.request(path, { method, headers: { "content-type": "application/json", origin: env.APP_URL, cookie }, body: JSON.stringify(body) });
const cookieOf = (res: Response) => res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");

beforeAll(() => {
  execFileSync("npm", ["run", "build"], { stdio: "pipe" });
  execFileSync("node", ["dist/migrate.js"], { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
});
beforeEach(async () => {
  sent = [];
  auth = createAuth(db, env, { appUrl: env.APP_URL, enqueue: async (e) => void sent.push(e) });
  await pool.query('truncate "user" cascade');
});
afterAll(() => pool.end());

async function makeUser(email: string, role = "landlord") {
  const [u] = (await pool.query(`insert into "user" (name, email, role, status, email_verified) values ('Pat', $1, $2, 'active', true) returning id`, [email, role])).rows;
  const hash = await (await auth.$context).password.hash(OLD);
  await pool.query(`insert into account (user_id, provider_id, account_id, password) values ($1, 'credential', $2, $3)`, [u.id, u.id, hash]);
}
const signIn = (a: ReturnType<typeof app>, email: string, pw: string) => send(a, "POST", "/api/auth/sign-in/email", { email, password: pw });

describe("account settings", () => {
  it("changes the name", async () => {
    await makeUser("pat@example.com");
    const a = app();
    const cookie = cookieOf(await signIn(a, "pat@example.com", OLD));
    const res = await send(a, "PATCH", "/api/me", { name: "  New Name " }, cookie);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ name: "New Name", email: "pat@example.com" });
    expect((await send(a, "PATCH", "/api/me", { name: "   " }, cookie)).status).toBe(422);
  });

  it("changes the password, signs other sessions out, emails the notice", async () => {
    await makeUser("pat@example.com");
    const a = app();
    const other = cookieOf(await signIn(a, "pat@example.com", OLD));
    const mine = cookieOf(await signIn(a, "pat@example.com", OLD));
    const res = await send(a, "POST", "/api/auth/change-password", { currentPassword: OLD, newPassword: NEW, revokeOtherSessions: true }, mine);
    expect(res.status).toBe(200);
    expect((await a.request("/api/me", { headers: { cookie: other } })).status).toBe(401);
    expect((await a.request("/api/me", { headers: { cookie: cookieOf(res) } })).status).toBe(200);
    expect((await signIn(a, "pat@example.com", OLD)).status).toBe(401);
    expect((await signIn(a, "pat@example.com", NEW)).status).toBe(200);
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ to: "pat@example.com", subject: "Your RentNerd password was changed" });
  });

  it("refuses a wrong current password, a short or blank new one, and sends nothing", async () => {
    await makeUser("pat@example.com");
    const a = app();
    const cookie = cookieOf(await signIn(a, "pat@example.com", OLD));
    const change = (currentPassword: string, newPassword: string) => send(a, "POST", "/api/auth/change-password", { currentPassword, newPassword }, cookie);
    expect((await change("Wrong-password-01", NEW)).status).toBe(400);
    expect((await change(OLD, "short")).status).toBe(400);
    expect((await change(OLD, " ".repeat(12))).status).toBe(400);
    await new Promise((r) => setTimeout(r, 200));
    expect(sent).toHaveLength(0);
    expect((await signIn(a, "pat@example.com", OLD)).status).toBe(200);
  });

  it("is not available to the smoke user", async () => {
    await makeUser("smoke@example.com", "smoke");
    const a = app();
    const cookie = cookieOf(await signIn(a, "smoke@example.com", OLD));
    expect((await send(a, "POST", "/api/auth/change-password", { currentPassword: OLD, newPassword: NEW }, cookie)).status).toBe(403);
    expect((await send(a, "PATCH", "/api/me", { name: "X" }, cookie)).status).toBe(403);
    expect((await signIn(a, "smoke@example.com", OLD)).status).toBe(200);
  });
});
