import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDb } from "../db/client";
import { account, user } from "../db/schema";
import { createApp } from "./app";
import { createAuth } from "./auth";
import { seedSmokeUser } from "./seed";

const url = "postgres://rentnerd:rentnerd@localhost:5432/rentnerd_test";
const { pool, db } = createDb(url);
const env = {
  AUTH_SECRET: "integration-test-secret-0123456789abcdef0123456789",
  APP_URL: "http://localhost:8080",
  SMOKE_USER_EMAIL: "Smoke@Example.Test",
  SMOKE_USER_PASSWORD: "smoke-password-0001",
};
const auth = createAuth(db, env);
const app = createApp(pool, "dist/client", auth, { testRoutesEnabled: false }, env.APP_URL);

beforeAll(() => {
  execFileSync("npm", ["run", "build"], { stdio: "pipe" });
  execFileSync("node", ["dist/migrate.js"], { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
});
beforeEach(async () => {
  await pool.query('truncate "user" cascade');
});
afterAll(() => pool.end());

const signIn = (email: string, password: string) =>
  app.request("/api/auth/sign-in/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: env.APP_URL },
    body: JSON.stringify({ email, password }),
  });

describe("seedSmokeUser", () => {
  it("creates a verified, active smoke user who can sign in", async () => {
    expect(await seedSmokeUser(auth, db, env)).toEqual({ seeded: true, created: true });
    const [u] = await db.select().from(user);
    expect(u).toMatchObject({ email: "smoke@example.test", role: "smoke", status: "active", emailVerified: true });
    const res = await signIn("smoke@example.test", env.SMOKE_USER_PASSWORD);
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("HttpOnly");
  });

  it("is idempotent: a second run creates no duplicate", async () => {
    await seedSmokeUser(auth, db, env);
    expect(await seedSmokeUser(auth, db, env)).toEqual({ seeded: true, created: false });
    expect(await db.select().from(user)).toHaveLength(1);
    expect(await db.select().from(account)).toHaveLength(1);
  });

  it("survives two concurrent runs", async () => {
    await Promise.all([seedSmokeUser(auth, db, env), seedSmokeUser(auth, db, env)]);
    expect(await db.select().from(user)).toHaveLength(1);
    expect(await db.select().from(account)).toHaveLength(1);
    expect((await signIn("smoke@example.test", env.SMOKE_USER_PASSWORD)).status).toBe(200);
  });

  it("re-syncs the password when SMOKE_USER_PASSWORD changes", async () => {
    await seedSmokeUser(auth, db, env);
    await seedSmokeUser(auth, db, { ...env, SMOKE_USER_PASSWORD: "another-password-02" });
    expect((await signIn("smoke@example.test", "another-password-02")).status).toBe(200);
    expect((await signIn("smoke@example.test", env.SMOKE_USER_PASSWORD)).status).toBe(401);
  });

  it("repairs a smoke user that was unverified or deactivated", async () => {
    await seedSmokeUser(auth, db, env);
    await db.update(user).set({ emailVerified: false, status: "deactivated" });
    await seedSmokeUser(auth, db, env);
    const [u] = await db.select().from(user);
    expect(u).toMatchObject({ emailVerified: true, status: "active" });
  });

  it("does nothing without the environment variables", async () => {
    expect(await seedSmokeUser(auth, db, {})).toEqual({ seeded: false });
    expect(await db.select().from(user)).toHaveLength(0);
  });

  it("refuses to hijack a non-smoke user with the same email", async () => {
    await db.insert(user).values({ name: "L", email: "smoke@example.test", role: "landlord" });
    await expect(seedSmokeUser(auth, db, env)).rejects.toThrow(/not the smoke user/);
  });
});

describe("auth configuration", () => {
  it("disables sign-up", async () => {
    const res = await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: env.APP_URL },
      body: JSON.stringify({ name: "X", email: "x@example.test", password: "a-long-password-1" }),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await db.select().from(user).where(eq(user.email, "x@example.test"))).toHaveLength(0);
  });

  it("rejects an unverified user's sign-in", async () => {
    await seedSmokeUser(auth, db, env);
    await db.update(user).set({ emailVerified: false });
    expect((await signIn("smoke@example.test", env.SMOKE_USER_PASSWORD)).status).toBe(403);
  });

  it("enforces one admin and one smoke user in the database", async () => {
    await db.insert(user).values({ name: "A", email: "a@x.test", role: "admin" });
    await expect(db.insert(user).values({ name: "B", email: "b@x.test", role: "admin" })).rejects.toThrow();
    await db.insert(user).values({ name: "L1", email: "l1@x.test", role: "landlord" });
    await db.insert(user).values({ name: "L2", email: "l2@x.test", role: "landlord" });
  });
});

describe("sign-in rules", () => {
  it("refuses a deactivated user with the wrong-password answer and records last sign-in for active users", async () => {
    await seedSmokeUser(auth, db, env);
    const before = await signIn("smoke@example.test", "wrong-password-0000");
    expect(before.status).toBe(401);
    expect(await signIn("smoke@example.test", env.SMOKE_USER_PASSWORD)).toHaveProperty("status", 200);
    const [u] = await db.select().from(user);
    expect(u?.lastSignInAt).toBeInstanceOf(Date);

    await db.update(user).set({ status: "deactivated" });
    const res = await signIn("smoke@example.test", env.SMOKE_USER_PASSWORD);
    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(((await res.json()) as { message: string }).message).toBe(((await before.json()) as { message: string }).message);
  });
});
