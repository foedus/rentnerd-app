import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb } from "../db/client";
import type { EnqueueEmail } from "../worker/email";
import { createApp } from "./app";
import { createAuth } from "./auth";

const url = "postgres://rentnerd:rentnerd@localhost:5432/rentnerd_test";
const { pool, db } = createDb(url);
const env = { AUTH_SECRET: "integration-test-secret-0123456789abcdef0123456789", APP_URL: "http://localhost:8080" };
const PASSWORD = "Correct-horse-1234";
let sent: EnqueueEmail[] = [];
let auth = createAuth(db, env);
let app = createApp(pool, "dist/client", auth, { testRoutesEnabled: false }, env.APP_URL, db, async (e) => void sent.push(e));

beforeAll(() => {
  execFileSync("npm", ["run", "build"], { stdio: "pipe" });
  execFileSync("node", ["dist/migrate.js"], { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
});
beforeEach(async () => {
  sent = [];
  auth = createAuth(db, env, { appUrl: env.APP_URL, enqueue: async (e) => void sent.push(e) });
  app = createApp(pool, "dist/client", auth, { testRoutesEnabled: false }, env.APP_URL, db, async (e) => void sent.push(e));
  await pool.query('truncate "user" cascade');
  await pool.query("truncate audit_log");
});
afterAll(() => pool.end());

async function makeUser(email: string, role: "admin" | "landlord" | "smoke", status = "active", name = email) {
  const ctx = await auth.$context;
  const [u] = (await pool.query(`insert into "user" (name, email, role, status, email_verified) values ($1,$2,$3,$4,true) returning id`, [name, email, role, status])).rows;
  await pool.query(`insert into account (user_id, provider_id, account_id, password) values ($1::uuid,'credential',$1::text,$2)`, [u.id, await ctx.password.hash(PASSWORD)]);
  return u.id as string;
}
const post = (path: string, body: unknown, cookie = "", headers: Record<string, string> = {}) =>
  app.request(path, { method: "POST", headers: { "content-type": "application/json", origin: env.APP_URL, cookie, ...headers }, body: JSON.stringify(body) });
async function signIn(email: string, password = PASSWORD) {
  const res = await post("/api/auth/sign-in/email", { email, password });
  return { res, cookie: res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ") };
}
const rows = async () => (await pool.query("select * from audit_log order by at, id")).rows;
const actions = async () => (await rows()).map((r) => r.action);

describe("sign-in events", () => {
  it("records sign_in and sign_out with the actor, but nothing for the smoke user", async () => {
    const id = await makeUser("lou@example.com", "landlord", "active", "Lou");
    const { cookie } = await signIn("lou@example.com");
    expect((await post("/api/auth/sign-out", {}, cookie)).status).toBe(200);
    const smoke = await makeUser("smoke@example.com", "smoke");
    const s = await signIn("smoke@example.com");
    await post("/api/auth/sign-out", {}, s.cookie);
    const r = await rows();
    expect(r.map((x) => x.action)).toEqual(["sign_in", "sign_out"]);
    expect(r.every((x) => x.actor_user_id === id && x.entity_id === id)).toBe(true);
    expect(r.some((x) => x.actor_user_id === smoke)).toBe(false);
  });

  it("records sign_in_failed for a known user and never stores the typed email for an unknown one", async () => {
    const id = await makeUser("lou@example.com", "landlord");
    expect((await signIn("lou@example.com", "wrong-password-1")).res.status).toBe(401);
    expect((await signIn("nobody@example.com", "wrong-password-1")).res.status).toBe(401);
    const r = await rows();
    expect(r.map((x) => [x.action, x.actor_user_id])).toEqual([["sign_in_failed", id], ["sign_in_failed", null]]);
    expect(JSON.stringify(r[1])).not.toContain("nobody");
  });

  it("records a failed sign-in of a deactivated user", async () => {
    await makeUser("gone@example.com", "landlord", "deactivated");
    expect((await signIn("gone@example.com")).res.status).toBe(401);
    expect(await actions()).toEqual(["sign_in_failed"]);
  });
});

describe("password and profile events", () => {
  it("records password_changed and a name update without any secret", async () => {
    await makeUser("lou@example.com", "landlord", "active", "Lou");
    const { cookie } = await signIn("lou@example.com");
    const NEW = "Another-pass-5678";
    expect((await post("/api/auth/change-password", { currentPassword: PASSWORD, newPassword: NEW }, cookie)).status).toBe(200);
    const patch = await app.request("/api/me", { method: "PATCH", headers: { "content-type": "application/json", origin: env.APP_URL, cookie }, body: JSON.stringify({ name: "Louise" }) });
    expect(patch.status).toBe(200);
    const r = await rows();
    expect(r.map((x) => x.action)).toEqual(["sign_in", "password_changed", "update"]);
    expect(r[2].changes).toEqual({ Name: ["Lou", "Louise"] });
    const dump = JSON.stringify(r);
    for (const secret of [PASSWORD, NEW, cookie.split("=")[1] ?? "x"]) expect(dump).not.toContain(secret);
  });

  it("records password_reset", async () => {
    await makeUser("lou@example.com", "landlord", "active", "Lou");
    await post("/api/auth/request-password-reset", { email: "lou@example.com", redirectTo: "/reset-password" });
    const token = /token=([\w-]+)/.exec(JSON.stringify(sent))?.[1];
    expect(token).toBeTruthy();
    expect((await post("/api/auth/reset-password", { token, newPassword: "Brand-new-pass-99" })).status).toBe(200);
    const r = await rows();
    expect(r.map((x) => x.action)).toEqual(["password_reset"]);
    expect(JSON.stringify(r)).not.toContain(token as string);
  });
});

describe("admin user events", () => {
  it("records invite, resend, revoke, deactivate and reactivate in order, with the client address", async () => {
    const adminId = await makeUser("admin@example.com", "admin", "active", "Ada");
    const { cookie } = await signIn("admin@example.com");
    const inv = await (await post("/api/invitations", { name: "Pat", email: "pat@example.com" }, cookie)).json();
    await post(`/api/invitations/${inv.id}/resend`, {}, cookie);
    const second = (await (await app.request("/api/invitations", { headers: { cookie } })).json()).data[0];
    await post(`/api/invitations/${second.id}/revoke`, {}, cookie);
    const lou = await makeUser("lou@example.com", "landlord", "active", "Lou");
    await post(`/api/users/${lou}/deactivate`, {}, cookie);
    await post(`/api/users/${lou}/reactivate`, {}, cookie);
    const r = (await rows()).slice(1);
    expect(r.map((x) => x.action)).toEqual(["invite", "invite", "invite_revoked", "deactivate", "reactivate"]);
    expect(r.every((x) => x.actor_user_id === adminId)).toBe(true);
    expect(r[1].summary).toMatch(/^Resent invitation/);
    expect(r[3].entity_id).toBe(lou);
    expect(r[0].ip).toBeTruthy();
    expect(JSON.stringify(r)).not.toMatch(/token/i);
  });

  it("writes no audit row when an action is refused", async () => {
    await makeUser("admin@example.com", "admin");
    const { cookie } = await signIn("admin@example.com");
    const lou = await makeUser("lou@example.com", "landlord", "deactivated");
    expect((await post(`/api/users/${lou}/deactivate`, {}, cookie)).status).toBe(409);
    expect(await actions()).toEqual(["sign_in"]);
  });
});
