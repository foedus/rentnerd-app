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
