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
let sent: EnqueueEmail[] = [];
let auth = createAuth(db, env);
const app = () => createApp(pool, "dist/client", auth, { testRoutesEnabled: false }, env.APP_URL, db, async (e) => void sent.push(e));
const post = (a: ReturnType<typeof app>, path: string, body: unknown, headers: Record<string, string> = {}) =>
  a.request(path, { method: "POST", headers: { "content-type": "application/json", origin: env.APP_URL, ...headers }, body: JSON.stringify(body) });

beforeAll(() => {
  execFileSync("npm", ["run", "build"], { stdio: "pipe" });
  execFileSync("node", ["dist/migrate.js"], { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
});
beforeEach(async () => {
  sent = [];
  // A fresh auth instance per test resets the in-memory per-address limit.
  auth = createAuth(db, env, { appUrl: env.APP_URL, enqueue: async (e) => void sent.push(e) });
  await pool.query('truncate "user" cascade');
});
afterAll(() => pool.end());

async function makeUser(email: string, status: "active" | "invited" | "deactivated" = "active", verified = true) {
  const [u] = (await pool.query(`insert into "user" (name, email, role, status, email_verified) values ('Pat', $1, 'landlord', $2, $3) returning id`, [email, status, verified])).rows;
  const hash = await (await auth.$context).password.hash(OLD);
  await pool.query(`insert into account (user_id, provider_id, account_id, password) values ($1, 'credential', $2, $3)`, [u.id, u.id, hash]);
  return u.id as string;
}
/** Better Auth runs the send in the background, so wait for the expected number of emails. */
const sentCount = (n: number) => vi.waitFor(() => expect(sent).toHaveLength(n));
const tokenOf = (e: EnqueueEmail) => new URL(e.content.action?.url ?? "").searchParams.get("token") ?? "";
const forgot = (a: ReturnType<typeof app>, email: string, headers: Record<string, string> = {}) => post(a, "/api/auth/request-password-reset", { email }, headers);

describe("forgot password", () => {
  it("answers the same for every address and emails only active verified users", async () => {
    await makeUser("active@example.com");
    await makeUser("gone@example.com", "deactivated");
    await makeUser("invited@example.com", "invited", false);
    const a = app();
    const statuses = [];
    for (const email of ["active@example.com", "gone@example.com", "invited@example.com", "nobody@example.com"]) {
      const res = await forgot(a, email);
      statuses.push([res.status, JSON.stringify(await res.json())]);
    }
    expect(new Set(statuses.map((s) => s[0])).size).toBe(1);
    expect(statuses[0]?.[0]).toBe(200);
    await sentCount(1);
    await new Promise((r) => setTimeout(r, 200));
    expect(sent.map((e) => [e.to, e.subject])).toEqual([["active@example.com", "Reset your RentNerd password"]]);
  });

  it("sends at most 3 emails per address per hour", async () => {
    await makeUser("active@example.com");
    const a = app();
    for (let i = 0; i < 5; i++) expect((await forgot(a, "active@example.com")).status).toBe(200);
    await sentCount(3);
    await new Promise((r) => setTimeout(r, 200));
    expect(sent).toHaveLength(3);
  });

  it("limits each visitor address to 20 requests per hour with 429 RATE_LIMITED", async () => {
    const a = app();
    for (let i = 0; i < 20; i++) expect((await forgot(a, `u${i}@example.com`, { "x-forwarded-for": `1.1.1.${i}` })).status).toBe(200);
    const res = await forgot(a, "late@example.com");
    expect(res.status).toBe(429);
    expect((await res.json()).error).toMatchObject({ code: "RATE_LIMITED", message: "Too many attempts. Try again in a few minutes." });
  });
});

describe("reset password", () => {
  it("refuses a password made only of spaces and keeps the old one", async () => {
    await makeUser("active@example.com");
    const a = app();
    await forgot(a, "active@example.com");
    await sentCount(1);
    const token = tokenOf(sent[0] as EnqueueEmail);
    expect((await post(a, "/api/auth/reset-password", { token, newPassword: " ".repeat(12) })).status).toBe(400);
    expect((await post(a, "/api/auth/sign-in/email", { email: "active@example.com", password: OLD })).status).toBe(200);
  });

  it("answers a blank sign-in password the same for known and unknown emails", async () => {
    await makeUser("active@example.com");
    const a = app();
    const known = await post(a, "/api/auth/sign-in/email", { email: "active@example.com", password: " ".repeat(12) });
    const unknown = await post(a, "/api/auth/sign-in/email", { email: "nobody@example.com", password: " ".repeat(12) });
    expect(known.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(await unknown.json()).toEqual(await known.json());
  });

  it("resets once, signs out every session, and sends the password-changed email", async () => {
    await makeUser("active@example.com");
    const a = app();
    const signIn = (pw: string) => post(a, "/api/auth/sign-in/email", { email: "active@example.com", password: pw });
    const cookie = (await signIn(OLD)).headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
    expect((await a.request("/api/me", { headers: { cookie } })).status).toBe(200);

    await forgot(a, "active@example.com");
    await sentCount(1);
    const token = tokenOf(sent[0] as EnqueueEmail);
    const NEW = "Brand-new-password-0002";
    const ok = await post(a, "/api/auth/reset-password", { token, newPassword: NEW });
    expect(ok.status).toBe(200);
    expect((await a.request("/api/me", { headers: { cookie } })).status).toBe(401);
    await sentCount(2);
    expect((await signIn(OLD)).status).toBe(401);
    expect((await signIn(NEW)).status).toBe(200);
    expect(sent.map((e) => e.subject)).toEqual(["Reset your RentNerd password", "Your RentNerd password was changed"]);
    expect(sent[1]?.to).toBe("active@example.com");

    expect((await post(a, "/api/auth/reset-password", { token, newPassword: "Another-password-0003" })).status).toBe(400);
  });

  it("kills every other outstanding reset link once one is used", async () => {
    await makeUser("active@example.com");
    const a = app();
    await forgot(a, "active@example.com");
    await forgot(a, "active@example.com");
    await sentCount(2);
    const [first, second] = sent.map(tokenOf);
    expect((await post(a, "/api/auth/reset-password", { token: first, newPassword: "Brand-new-password-0002" })).status).toBe(200);
    expect((await post(a, "/api/auth/reset-password", { token: second, newPassword: "Another-password-0003" })).status).toBe(400);
  });

  it("rejects an expired token", async () => {
    await makeUser("active@example.com");
    const a = app();
    await forgot(a, "active@example.com");
    await sentCount(1);
    await pool.query("update verification set expires_at = now() - interval '1 minute'");
    const res = await post(a, "/api/auth/reset-password", { token: tokenOf(sent[0] as EnqueueEmail), newPassword: "Brand-new-password-0002" });
    expect(res.status).toBe(400);
    expect(sent).toHaveLength(1);
  });

  it("limits reset attempts to 20 per visitor address per 15 minutes", async () => {
    const a = app();
    for (let i = 0; i < 20; i++) expect((await post(a, "/api/auth/reset-password", { token: "nope", newPassword: "Brand-new-password-0002" })).status).toBe(400);
    expect((await post(a, "/api/auth/reset-password", { token: "nope", newPassword: "Brand-new-password-0002" })).status).toBe(429);
  });
});
