import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb } from "../db/client";
import type { EnqueueEmail } from "../worker/email";
import { createApp } from "./app";
import { createAuth } from "./auth";
import { createInvitation } from "./invitations";

const url = "postgres://rentnerd:rentnerd@localhost:5432/rentnerd_test";
const { pool, db } = createDb(url);
const env = { AUTH_SECRET: "integration-test-secret-0123456789abcdef0123456789", APP_URL: "http://localhost:8080" };
const auth = createAuth(db, env);
const PASSWORD = "Correct-horse-1234";
let sent: EnqueueEmail[] = [];
const app = createApp(pool, "dist/client", auth, { testRoutesEnabled: false }, env.APP_URL, db, async (e) => void sent.push(e));

beforeAll(() => {
  execFileSync("npm", ["run", "build"], { stdio: "pipe" });
  execFileSync("node", ["dist/migrate.js"], { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
});
beforeEach(async () => {
  sent = [];
  await pool.query('truncate "user" cascade');
});
afterAll(() => pool.end());

async function makeUser(email: string, role: "admin" | "landlord", status: "active" | "invited" | "deactivated" = "active", name = email) {
  const ctx = await auth.$context;
  const [u] = (await pool.query(`insert into "user" (name, email, role, status, email_verified) values ($1,$2,$3,$4,true) returning id`, [name, email, role, status])).rows;
  await pool.query(`insert into account (user_id, provider_id, account_id, password) values ($1::uuid,'credential',$1::text,$2)`, [u.id, await ctx.password.hash(PASSWORD)]);
  return u.id as string;
}
async function signIn(email: string) {
  const res = await app.request("/api/auth/sign-in/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: env.APP_URL },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  expect(res.status).toBe(200);
  return res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}
const call = (cookie: string, method: string, path: string, body?: unknown) =>
  app.request(path, { method, headers: { cookie, origin: env.APP_URL, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

async function setup() {
  const adminId = await makeUser("admin@example.com", "admin", "active", "Ada Admin");
  const adminCookie = await signIn("admin@example.com");
  return { adminId, adminCookie };
}

describe("admin-only access", () => {
  it("gives landlords 403 FORBIDDEN on every user-management route", async () => {
    const { adminId, adminCookie } = await setup();
    await makeUser("lou@example.com", "landlord");
    const cookie = await signIn("lou@example.com");
    const inv = await (await call(adminCookie, "POST", "/api/invitations", { name: "Pat", email: "pat@example.com" })).json();
    for (const [method, path, body] of [
      ["GET", "/api/users", undefined],
      ["GET", "/api/invitations", undefined],
      ["POST", "/api/invitations", { name: "X", email: "x@example.com" }],
      ["POST", `/api/invitations/${inv.id}/resend`, {}],
      ["POST", `/api/invitations/${inv.id}/revoke`, {}],
      ["POST", `/api/users/${adminId}/deactivate`, {}],
      ["POST", `/api/users/${adminId}/reactivate`, {}],
    ] as const) {
      const res = await call(cookie, method, path, body);
      expect(res.status, `${method} ${path}`).toBe(403);
      expect((await res.json()).error.code).toBe("FORBIDDEN");
    }
  });

  it("answers 401 without a session", async () => {
    await setup();
    expect((await app.request("/api/users")).status).toBe(401);
  });
});

describe("POST /api/invitations", () => {
  it("creates an invited landlord, a valid invitation and one email naming the inviter", async () => {
    const { adminCookie } = await setup();
    const res = await call(adminCookie, "POST", "/api/invitations", { name: " Pat Lee ", email: "Pat@Example.com" });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ email: "pat@example.com", name: "Pat Lee", state: "valid" });
    const { rows } = await pool.query(`select role, status, email_verified from "user" where email = 'pat@example.com'`);
    expect(rows).toEqual([{ role: "landlord", status: "invited", email_verified: false }]);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: "pat@example.com", subject: "You're invited to RentNerd" });
    expect(sent[0]?.content.paragraphs[0]).toBe("Ada Admin has invited you to RentNerd, the shared tool for managing your properties.");
    expect(sent[0]?.content.action?.url).toMatch(/^http:\/\/localhost:8080\/accept-invite\?token=/);
  });

  it("ignores a role sent in the body and always invites a landlord", async () => {
    const { adminCookie } = await setup();
    const res = await call(adminCookie, "POST", "/api/invitations", { name: "Eve", email: "eve@example.com", role: "admin" });
    expect(res.status).toBe(201);
    const { rows } = await pool.query(`select role from "user" where email = 'eve@example.com'`);
    expect(rows).toEqual([{ role: "landlord" }]);
  });

  it("rejects an email that already belongs to any user with 409 and sends nothing", async () => {
    const { adminCookie } = await setup();
    await makeUser("old@example.com", "landlord", "deactivated");
    const res = await call(adminCookie, "POST", "/api/invitations", { name: "Old", email: "OLD@example.com" });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatchObject({ code: "CONFLICT", message: "A user with this email already exists." });
    expect(sent).toHaveLength(0);
  });

  it("validates name and email with 422", async () => {
    const { adminCookie } = await setup();
    const res = await call(adminCookie, "POST", "/api/invitations", { name: "", email: "nope" });
    expect(res.status).toBe(422);
    expect(Object.keys((await res.json()).error.fields)).toEqual(["name", "email"]);
  });
});

describe("resend and revoke", () => {
  async function invited() {
    const s = await setup();
    const inv = await (await call(s.adminCookie, "POST", "/api/invitations", { name: "Pat", email: "pat@example.com" })).json();
    return { ...s, inv };
  }
  const tokenOf = (e: EnqueueEmail | undefined) => new URL(e?.content.action?.url ?? "").searchParams.get("token") ?? "";
  const lookup = async (token: string) => (await app.request(`/api/invitations/lookup?token=${token}`)).status;

  it("resend invalidates the previous link and emails a working one", async () => {
    const { adminCookie, inv } = await invited();
    const first = tokenOf(sent[0]);
    const res = await call(adminCookie, "POST", `/api/invitations/${inv.id}/resend`, {});
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(2);
    expect(await lookup(first)).toBe(404);
    expect(await lookup(tokenOf(sent[1]))).toBe(200);
  });

  it("revoke kills the link, shows state revoked, and resend works afterwards (even from the revoked id)", async () => {
    const { adminCookie, inv } = await invited();
    const res = await call(adminCookie, "POST", `/api/invitations/${inv.id}/revoke`, {});
    expect(await res.json()).toMatchObject({ state: "revoked" });
    expect(await lookup(tokenOf(sent[0]))).toBe(404);
    const users = (await (await call(adminCookie, "GET", "/api/users")).json()).data;
    expect(users.find((u: { email: string }) => u.email === "pat@example.com")).toMatchObject({ status: "invited", invitation: { state: "revoked" } });
    expect((await call(adminCookie, "POST", `/api/invitations/${inv.id}/revoke`, {})).status).toBe(409);
    expect((await call(adminCookie, "POST", `/api/invitations/${inv.id}/resend`, {})).status).toBe(200);
    expect(await lookup(tokenOf(sent[1]))).toBe(200);
  });

  it("shows an expired invitation as state expired", async () => {
    const { adminCookie } = await invited();
    await pool.query("update invitation set expires_at = now() - interval '1 minute'");
    const users = (await (await call(adminCookie, "GET", "/api/users")).json()).data;
    expect(users.find((u: { email: string }) => u.email === "pat@example.com").invitation.state).toBe("expired");
    const list = await (await call(adminCookie, "GET", "/api/invitations")).json();
    expect(list).toMatchObject({ page: 1, pageSize: 50, total: 1 });
    expect(list.data[0]).toMatchObject({ email: "pat@example.com", state: "expired" });
  });

  it("refuses to resend or revoke for an accepted user and 404s unknown ids", async () => {
    const { adminCookie } = await setup();
    const userId = await makeUser("done@example.com", "landlord", "active");
    const { rows } = await pool.query(`insert into invitation (user_id, token_hash, expires_at, accepted_at) values ($1, 'h', now() + interval '1 day', now()) returning id`, [userId]);
    expect((await call(adminCookie, "POST", `/api/invitations/${rows[0].id}/resend`, {})).status).toBe(409);
    expect((await call(adminCookie, "POST", `/api/invitations/${rows[0].id}/revoke`, {})).status).toBe(409);
    for (const id of ["not-a-uuid", "00000000-0000-4000-8000-000000000000"])
      expect((await call(adminCookie, "POST", `/api/invitations/${id}/resend`, {})).status).toBe(404);
    expect(sent).toHaveLength(0);
  });

  it("keeps the public lookup route reachable without a session", async () => {
    const { adminId } = await setup();
    const { token } = await createInvitation(db, adminId, null);
    expect(await lookup(token)).toBe(404); // admin is active, so not a live invitation; the point is no 401/403
  });
});

describe("GET /api/users", () => {
  it("lists every user with a paging envelope and honours pageSize", async () => {
    const { adminCookie } = await setup();
    await makeUser("a@example.com", "landlord", "deactivated", "Amy");
    await makeUser("b@example.com", "landlord", "active", "Bob");
    const all = await (await call(adminCookie, "GET", "/api/users")).json();
    expect(all).toMatchObject({ page: 1, pageSize: 50, total: 3 });
    expect(all.data[0]).toEqual({ id: expect.any(String), name: "Ada Admin", email: "admin@example.com", role: "admin", status: "active", lastSignInAt: expect.any(String), invitation: null });
    const page = await (await call(adminCookie, "GET", "/api/users?pageSize=2&page=2")).json();
    expect(page.data).toHaveLength(1);
    expect((await call(adminCookie, "GET", "/api/users?pageSize=500")).status).toBe(422);
  });
});

describe("deactivate and reactivate", () => {
  it("deactivating revokes sessions at once, keeps them out, and reactivating restores the old password", async () => {
    const { adminCookie } = await setup();
    const id = await makeUser("lou@example.com", "landlord");
    const louCookie = await signIn("lou@example.com");
    expect((await call(louCookie, "GET", "/api/me")).status).toBe(200);

    const res = await call(adminCookie, "POST", `/api/users/${id}/deactivate`, {});
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id, status: "deactivated" });
    expect((await call(louCookie, "GET", "/api/me")).status).toBe(401);
    expect((await pool.query("select 1 from session where user_id = $1", [id])).rowCount).toBe(0);
    // Refusing the sign-in itself ("Incorrect email or password.") is T019; the API guard still treats any new session as signed out.
    const again = await app.request("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: env.APP_URL },
      body: JSON.stringify({ email: "lou@example.com", password: PASSWORD }),
    });
    const newCookie = again.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
    expect((await call(newCookie, "GET", "/api/me")).status).toBe(401);

    expect((await call(adminCookie, "POST", `/api/users/${id}/deactivate`, {})).status).toBe(409);
    expect((await call(adminCookie, "POST", `/api/users/${id}/reactivate`, {})).status).toBe(200);
    expect((await call(await signIn("lou@example.com"), "GET", "/api/me")).status).toBe(200);
    expect((await call(adminCookie, "POST", `/api/users/${id}/reactivate`, {})).status).toBe(409);
  });

  it("removes the landlord from every property and gives the Admin any property left with none (D-06)", async () => {
    const { adminId, adminCookie } = await setup();
    const lou = await makeUser("lou@example.com", "landlord");
    const mia = await makeUser("mia@example.com", "landlord");
    const [{ id: ownerId }] = (await pool.query(`insert into owner (name, owner_type, address_line1, city, state, zip) values ('Acme','LLC','1 A St','Brooklyn','NY','11201') returning id`)).rows;
    const addProperty = async (name: string, ids: string[]) => {
      const [{ id }] = (await pool.query(`insert into property (name, street, city, state, zip, owner_id) values ($1,'1 A St','Brooklyn','NY','11201',$2) returning id`, [name, ownerId])).rows;
      for (const u of ids) await pool.query("insert into property_responsible (property_id, user_id) values ($1,$2)", [id, u]);
      return id as string;
    };
    const p = await addProperty("P", [lou]);
    const q = await addProperty("Q", [lou, mia]);
    const r = await addProperty("R", [mia]);
    const responsible = async (id: string) => (await pool.query("select user_id from property_responsible where property_id = $1 order by user_id", [id])).rows.map((x) => x.user_id);

    expect((await call(adminCookie, "POST", `/api/users/${lou}/deactivate`, {})).status).toBe(200);
    expect(await responsible(p)).toEqual([adminId]);
    expect(await responsible(q)).toEqual([mia]);
    expect(await responsible(r)).toEqual([mia]);
    const versions = (await pool.query("select name, version from property order by name")).rows;
    expect(versions).toEqual([{ name: "P", version: 2 }, { name: "Q", version: 2 }, { name: "R", version: 1 }]);
    const audits = (await pool.query(`select entity_id, summary from audit_log where entity_type = 'property' order by summary`)).rows;
    expect(audits.map((a) => a.entity_id).sort()).toEqual([p, q].sort());
    expect(audits.find((a) => a.entity_id === p).summary).toContain("the Admin was assigned");
  });

  it("never deactivates the admin (403) and 404s unknown users", async () => {
    const { adminId, adminCookie } = await setup();
    expect((await call(adminCookie, "POST", `/api/users/${adminId}/deactivate`, {})).status).toBe(403);
    expect((await pool.query(`select status from "user" where id = $1`, [adminId])).rows[0].status).toBe("active");
    expect((await call(adminCookie, "POST", "/api/users/00000000-0000-4000-8000-000000000000/deactivate", {})).status).toBe(404);
  });

  it("refuses to deactivate an invited user", async () => {
    const { adminCookie } = await setup();
    const id = await makeUser("inv@example.com", "landlord", "invited");
    expect((await call(adminCookie, "POST", `/api/users/${id}/deactivate`, {})).status).toBe(409);
  });
});
