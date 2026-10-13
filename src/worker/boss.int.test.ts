import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "../db/client";
import { QUEUES, startWorker } from "./boss";

const url = "postgres://rentnerd:rentnerd@localhost:5432/rentnerd_test";
const { pool } = createDb(url);

beforeAll(() => {
  execFileSync("npm", ["run", "build"], { stdio: "pipe" });
  execFileSync("node", ["dist/migrate.js"], { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
});
afterAll(() => pool.end());

describe("startWorker", () => {
  it("registers every queue in the pgboss schema and stops gracefully, twice", async () => {
    const worker = await startWorker(url);
    const queues = (await worker.boss.getQueues()).map((q) => q.name);
    expect(queues).toEqual(expect.arrayContaining([...QUEUES]));
    const { rows } = await pool.query("select to_regclass('pgboss.job') as job, to_regclass('public.job') as stray");
    expect(rows[0]).toEqual({ job: "pgboss.job", stray: null });
    await worker.stop();
    await worker.stop();
  });

  it("is idempotent across restarts", async () => {
    for (let i = 0; i < 2; i++) await (await startWorker(url)).stop();
  });
});
