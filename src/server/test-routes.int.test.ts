import { execFileSync } from "node:child_process";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "../db/client";
import { startWorker } from "../worker/boss";
import { loadClock, readClockOffset } from "../db/test-clock";
import { getClockOffset, installClock, setClockNow } from "../shared/clock";
import { createApp } from "./app";

const url = "postgres://rentnerd:rentnerd@localhost:5432/rentnerd_test";
const { pool } = createDb(url);
const app = createApp(pool, "dist/client", undefined, { testRoutesEnabled: true });

installClock();
beforeAll(() => {
  execFileSync("npm", ["run", "build"], { stdio: "pipe" });
  execFileSync("node", ["dist/migrate.js"], { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
});
afterEach(async () => {
  await app.request("/api/test/clock", { method: "POST", body: JSON.stringify({ now: null }) });
});
afterAll(() => pool.end());

const post = (now: unknown) => app.request("/api/test/clock", { method: "POST", body: JSON.stringify({ now }) });

describe("POST /api/test/clock", () => {
  it("moves the app clock, persists the offset and lets another process load it", async () => {
    const res = await post("2030-03-01T12:00:00.000Z");
    expect(res.status).toBe(200);
    expect(Math.abs(Date.parse((await res.json()).now) - Date.parse("2030-03-01T12:00:00.000Z"))).toBeLessThan(2000);
    const stored = await readClockOffset(pool);
    expect(stored).toBeGreaterThan(Date.parse("2029-01-01") - Date.now());

    setClockNow(null); // simulate a freshly started worker/cli
    expect(getClockOffset()).toBe(0);
    await loadClock(pool);
    expect(getClockOffset()).toBe(stored);
  });

  it("clears the offset with null", async () => {
    await post("2030-03-01T12:00:00.000Z");
    expect((await post(null)).status).toBe(200);
    expect(await readClockOffset(pool)).toBe(0);
    expect(getClockOffset()).toBe(0);
  });

  it("rejects a malformed body with the error envelope", async () => {
    for (const body of ["not json", JSON.stringify({}), JSON.stringify({ now: "yesterday" })]) {
      const res = await app.request("/api/test/clock", { method: "POST", body });
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe("VALIDATION_ERROR");
    }
  });
});

describe("POST /api/test/reset", () => {
  it("empties app tables and queued jobs but keeps the schema, queues and migrations", async () => {
    await pool.query("insert into \"user\" (name, email) values ('A', 'a@example.test')");
    await post("2030-03-01T12:00:00.000Z");
    const worker = await startWorker(url);
    await worker.boss.send("email.send", { to: "x" });
    const res = await app.request("/api/test/reset", { method: "POST" });
    expect(res.status).toBe(200);
    expect((await pool.query('select count(*)::int as n from "user"')).rows[0].n).toBe(0);
    expect((await pool.query("select count(*)::int as n from pgboss.job")).rows[0].n).toBe(0);
    expect(await readClockOffset(pool)).toBe(0);
    expect(getClockOffset()).toBe(0);
    expect((await worker.boss.getQueues()).map((q) => q.name)).toContain("email.send");
    expect((await pool.query("select count(*)::int as n from drizzle.__drizzle_migrations")).rows[0].n).toBeGreaterThan(0);
    await worker.stop();
  });

  it("does not exist when test routes are disabled", async () => {
    const off = createApp(pool, "dist/client", undefined, { testRoutesEnabled: false });
    expect((await off.request("/api/test/reset", { method: "POST" })).status).toBe(404);
  });
});

describe("POST /api/test/fail-next-email", () => {
  it("arms a one-shot flag (idempotent) that reset clears", async () => {
    for (let i = 0; i < 2; i++) {
      const res = await app.request("/api/test/fail-next-email", { method: "POST" });
      expect(res.status).toBe(200);
    }
    expect((await pool.query("select name from test_flag")).rows).toEqual([{ name: "fail-next-email" }]);
    await app.request("/api/test/reset", { method: "POST" });
    expect((await pool.query("select name from test_flag")).rowCount).toBe(0);
  });
});
