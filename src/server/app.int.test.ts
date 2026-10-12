import { execFileSync } from "node:child_process";
import { afterAll, describe, expect, it } from "vitest";
import { createDb } from "../db/client";
import { createApp } from "./app";

const url = "postgres://rentnerd:rentnerd@localhost:5432/rentnerd_test";
const { pool } = createDb(url);
afterAll(() => pool.end());

describe("health endpoints", () => {
  it.each(["/api/health", "/healthz"])("%s is 200 ok with the database up", async (path) => {
    const res = await createApp(pool).request(path);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("returns 503 when the database is unreachable", async () => {
    const bad = createDb("postgres://rentnerd:rentnerd@localhost:1/rentnerd_test");
    const res = await createApp(bad.pool).request("/api/health");
    await bad.pool.end();
    expect(res.status).toBe(503);
  });
});

describe("test routes (D-25)", () => {
  it("returns 404 JSON for /api/test/* when test routes are disabled", async () => {
    const res = await createApp(pool).request("/api/test/clock", {
      method: "POST",
      body: JSON.stringify({ now: "2026-10-12T16:00:00.000Z" }),
    });
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("NOT_FOUND");
  });
});

describe("startup refusal (AC-PLAT-07)", () => {
  it.each([
    ["server.js", { NODE_ENV: "production" }],
    ["worker.js", { FLY_APP_NAME: "rentnerd-app" }],
    ["cli.js", { DATABASE_URL: "postgres://rentnerd:rentnerd@localhost:5432/rentnerd" }],
  ])("%s exits non-zero with an explanation in an unsafe environment", (script, unsafe) => {
    execFileSync("npm", ["run", "build"], { stdio: "pipe" });
    const env = { ...process.env, NODE_ENV: "test", DATABASE_URL: url, ENABLE_TEST_ROUTES: "true", ...unsafe };
    try {
      execFileSync("node", [`dist/${script}`], { env, stdio: "pipe", timeout: 20000 });
      throw new Error("expected a non-zero exit");
    } catch (error) {
      const e = error as { status?: number; stderr?: Buffer };
      expect(e.status).toBe(1);
      expect(String(e.stderr)).toMatch(/ENABLE_TEST_ROUTES/);
    }
  });
});

describe("dist/migrate.js", () => {
  it("applies migrations against the compose database", () => {
    execFileSync("npm", ["run", "build"], { stdio: "pipe" });
    const out = execFileSync("node", ["dist/migrate.js"], {
      env: { ...process.env, DATABASE_URL: url },
      encoding: "utf8",
    });
    expect(out).toContain("migrations applied");
  });

  it("fails without DATABASE_URL", () => {
    const env = { ...process.env };
    delete env.DATABASE_URL;
    expect(() => execFileSync("node", ["dist/migrate.js"], { env, stdio: "pipe" })).toThrow();
  });
});
