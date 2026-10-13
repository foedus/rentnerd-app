import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb } from "../db/client";
import { session, user } from "../db/schema";
import { createApp } from "./app";
import { createAuth } from "./auth";
import { seedSmokeUser } from "./seed";

const url = "postgres://rentnerd:rentnerd@localhost:5432/rentnerd_test";
const { pool, db } = createDb(url);
const env = {
  AUTH_SECRET: "integration-test-secret-0123456789abcdef0123456789",
  APP_URL: "http://localhost:8080",
  SMOKE_USER_EMAIL: "smoke@example.test",
  SMOKE_USER_PASSWORD: "smoke-password-0001",
};
const auth = createAuth(db, env);
const app = createApp(pool, "dist/client", auth, { testRoutesEnabled: false }, env.APP_URL);
const json = { "content-type": "application/json" };

beforeAll(() => {
  execFileSync("npm", ["run", "build"], { stdio: "pipe" });
  execFileSync("node", ["dist/migrate.js"], { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
});
beforeEach(async () => {
  await pool.query('truncate "user" cascade');
  await seedSmokeUser(auth, db, env);
});
afterAll(() => pool.end());

async function signInCookie() {
  const res = await app.request("/api/auth/sign-in/email", {
    method: "POST",
    headers: { ...json, origin: env.APP_URL },
    body: JSON.stringify({ email: env.SMOKE_USER_EMAIL, password: env.SMOKE_USER_PASSWORD }),
  });
  expect(res.status).toBe(200);
  const raw = res.headers.get("set-cookie") ?? "";
  return { raw, cookie: raw.split(";")[0] ?? "" };
}

describe("session cookie", () => {
  it("is HttpOnly, SameSite=Lax, has Max-Age of 7 days and is not Secure over http", async () => {
    const { raw } = await signInCookie();
    expect(raw).toMatch(/HttpOnly/i);
    expect(raw).toMatch(/SameSite=Lax/i);
    expect(raw).toMatch(/Max-Age=604800/i);
    expect(raw).not.toMatch(/Secure/i);
  });

  it("is Secure when the app URL is https", async () => {
    const secure = createAuth(db, { ...env, APP_URL: "https://rentnerd-app.fly.dev" });
    const res = await createApp(pool, "dist/client", secure, { testRoutesEnabled: false }, "https://rentnerd-app.fly.dev").request(
      "/api/auth/sign-in/email",
      {
        method: "POST",
        headers: { ...json, origin: "https://rentnerd-app.fly.dev" },
        body: JSON.stringify({ email: env.SMOKE_USER_EMAIL, password: env.SMOKE_USER_PASSWORD }),
      },
    );
    expect(res.headers.get("set-cookie")).toMatch(/Secure/i);
  });

  it("stores a database session that expires in 7 days", async () => {
    await signInCookie();
    const [s] = await db.select().from(session);
    const days = (s!.expiresAt.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.99);
    expect(days).toBeLessThanOrEqual(7);
  });
});

describe("401 for missing sessions (AC-API-01)", () => {
  it("answers 401 UNAUTHENTICATED in the error envelope", async () => {
    for (const path of ["/api/properties", "/api/me", "/api/anything/else"]) {
      const res = await app.request(path);
      expect(res.status).toBe(401);
      expect((await res.json()).error).toMatchObject({ code: "UNAUTHENTICATED", message: expect.any(String) });
    }
  });

  it("leaves health, auth and the public invitation routes open", async () => {
    expect((await app.request("/api/health")).status).toBe(200);
    expect((await app.request("/api/auth/get-session")).status).toBe(200);
    expect((await app.request("/api/invitations/lookup?token=x")).status).toBe(404);
    const accept = await app.request("/api/invitations/accept", { method: "POST", headers: { origin: env.APP_URL } });
    expect(accept.status).toBe(404);
  });

  it("lets a signed-in user through to the router (404 for unknown routes)", async () => {
    const { cookie } = await signInCookie();
    const res = await app.request("/api/nothing-here", { headers: { cookie } });
    expect(res.status).toBe(404);
  });

  it("treats invited and deactivated users as signed out", async () => {
    const { cookie } = await signInCookie();
    for (const status of ["deactivated", "invited"] as const) {
      await db.update(user).set({ status });
      const res = await app.request("/api/nothing-here", { headers: { cookie } });
      expect(res.status).toBe(401);
    }
  });

  it("rejects a forged cookie", async () => {
    const res = await app.request("/api/me", { headers: { cookie: "better-auth.session_token=forged.value" } });
    expect(res.status).toBe(401);
  });
});

describe("Origin check (AC-API-06)", () => {
  it.each(["POST", "PATCH", "PUT", "DELETE"])("rejects %s without an Origin", async (method) => {
    const { cookie } = await signInCookie();
    const res = await app.request("/api/nothing-here", { method, headers: { cookie } });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("FORBIDDEN");
  });

  it("rejects a foreign Origin, even on sign-in", async () => {
    const res = await app.request("/api/auth/sign-in/email", {
      method: "POST",
      headers: { ...json, origin: "https://evil.example" },
      body: JSON.stringify({ email: env.SMOKE_USER_EMAIL, password: env.SMOKE_USER_PASSWORD }),
    });
    expect(res.status).toBe(403);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("does not require an Origin on GET", async () => {
    expect((await app.request("/api/health")).status).toBe(200);
  });
});

describe("smoke user is read-only (D-24)", () => {
  it("gets 403 FORBIDDEN on writes but can read and sign out", async () => {
    const { cookie } = await signInCookie();
    for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
      const res = await app.request("/api/properties", { method, headers: { cookie, origin: env.APP_URL } });
      expect(res.status).toBe(403);
      expect((await res.json()).error.code).toBe("FORBIDDEN");
    }
    const other = await app.request("/api/auth/change-password", {
      method: "POST",
      headers: { cookie, origin: env.APP_URL, ...json },
      body: "{}",
    });
    expect(other.status).toBe(403);
    expect((await app.request("/api/nothing-here", { headers: { cookie } })).status).toBe(404);
    const out = await app.request("/api/auth/sign-out", { method: "POST", headers: { cookie, origin: env.APP_URL, ...json }, body: "{}" });
    expect(out.status).toBe(200);
  });
});

describe("error envelope", () => {
  it("returns INTERNAL for unexpected failures", async () => {
    const broken = createApp({ query: () => Promise.reject(new Error("boom")) } as never, "dist/client", auth, { testRoutesEnabled: true }, env.APP_URL);
    const res = await broken.request("/api/test/reset", { method: "POST" });
    expect(res.status).toBe(500);
    expect((await res.json()).error.code).toBe("INTERNAL");
  });
});
