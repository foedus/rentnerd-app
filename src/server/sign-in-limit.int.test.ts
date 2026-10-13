import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb } from "../db/client";
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
const headers = { "content-type": "application/json", origin: env.APP_URL };

beforeAll(() => {
  execFileSync("npm", ["run", "build"], { stdio: "pipe" });
  execFileSync("node", ["dist/migrate.js"], { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
});
beforeEach(async () => {
  await pool.query('truncate "user" cascade');
  await seedSmokeUser(auth, db, env);
});
afterAll(() => pool.end());

describe("sign-in rate limit through Better Auth", () => {
  const signIn = (app: ReturnType<typeof createApp>, email: string, password: string, extra: Record<string, string> = {}) =>
    app.request("/api/auth/sign-in/email", { method: "POST", headers: { ...headers, ...extra }, body: JSON.stringify({ email, password }) });

  it("answers 429 RATE_LIMITED on the 6th attempt, even with the right password, and ignores X-Forwarded-For", async () => {
    const app = createApp(pool, "dist/client", auth, { testRoutesEnabled: false }, env.APP_URL);
    for (let i = 0; i < 5; i++) {
      const res = await signIn(app, env.SMOKE_USER_EMAIL, `wrong-password-${i}000`, { "x-forwarded-for": `9.9.9.${i}` });
      expect(res.status).toBe(401);
    }
    const res = await signIn(app, env.SMOKE_USER_EMAIL, env.SMOKE_USER_PASSWORD, { "x-forwarded-for": "8.8.8.8" });
    expect(res.status).toBe(429);
    expect((await res.json()).error).toMatchObject({ code: "RATE_LIMITED", message: "Too many attempts. Try again in a few minutes." });
  });

  it("limits unknown emails too, and successful sign-ins don't count", async () => {
    const app = createApp(pool, "dist/client", auth, { testRoutesEnabled: false }, env.APP_URL);
    for (let i = 0; i < 7; i++) expect((await signIn(app, env.SMOKE_USER_EMAIL, env.SMOKE_USER_PASSWORD)).status).toBe(200);
    for (let i = 0; i < 5; i++) expect((await signIn(app, "nobody@example.test", `wrong-password-${i}000`)).status).not.toBe(429);
    expect((await signIn(app, "nobody@example.test", "wrong-password-x000")).status).toBe(429);
  });
});
