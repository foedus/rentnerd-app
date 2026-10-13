import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createDb } from "../db/client";
import { bootstrapAdmin } from "./bootstrap";
import { hashToken, invitationEmail } from "./invitations";

const url = "postgres://rentnerd:rentnerd@localhost:5432/rentnerd_test";
const { pool, db } = createDb(url);
const env = { ADMIN_EMAIL: "Admin@Example.Test", APP_URL: "http://localhost:8080", ENABLE_TEST_ROUTES: "true" };
const send = vi.fn(async () => "job");

beforeAll(() => {
  execFileSync("npm", ["run", "build"], { stdio: "pipe" });
  execFileSync("node", ["dist/migrate.js"], { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
});
beforeEach(async () => {
  send.mockClear();
  await pool.query('truncate "user", email_log cascade');
});
afterAll(() => pool.end());

const run = (e: NodeJS.ProcessEnv = env) => bootstrapAdmin(db, pool, { send } as never, e);
const q = async (sql: string) => (await pool.query(sql)).rows;

describe("bootstrapAdmin", () => {
  it("creates the invited admin with one invitation and one email, and is idempotent", async () => {
    expect(await run()).toEqual({ status: "created", email: "admin@example.test" });
    expect(await run()).toMatchObject({ status: "exists", differs: false });
    expect(send).toHaveBeenCalledTimes(1);
    expect(await q('select role, status, email_verified from "user"')).toEqual([
      { role: "admin", status: "invited", email_verified: false },
    ]);
    const [inv] = await q("select * from invitation");
    expect(inv.invited_by_id).toBeNull();
    expect(inv.expires_at.getTime() - inv.created_at.getTime()).toBeGreaterThan(6.99 * 86400_000);
    expect(await q("select template, subject, status from email_log")).toEqual([
      { template: "invitation", subject: "You're invited to RentNerd", status: "queued" },
    ]);
  });

  it("emails a link whose token matches the stored hash, with the administrator wording", async () => {
    await run();
    const job = send.mock.calls[0] as unknown as [string, { text: string }];
    const token = /accept-invite\?token=([\w-]+)/.exec(job[1].text)?.[1];
    expect(token).toBeTruthy();
    expect(job[1].text).toContain("You've been set up as the administrator of RentNerd");
    expect((await q("select token_hash from invitation"))[0]!.token_hash).toBe(hashToken(token!));
  });

  it("warns and creates no second admin when ADMIN_EMAIL differs", async () => {
    await run();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await run({ ...env, ADMIN_EMAIL: "other@example.test" })).toMatchObject({ differs: true });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    expect(await q('select 1 from "user"')).toHaveLength(1);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("sends exactly one invitation when several starts race", async () => {
    const results = await Promise.all([run(), run(), run(), run()]);
    expect(results.filter((r) => r.status === "created")).toHaveLength(1);
    expect(await q('select 1 from "user"')).toHaveLength(1);
    expect(await q("select 1 from invitation")).toHaveLength(1);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("does nothing without ADMIN_EMAIL and no admin", async () => {
    expect(await run({ APP_URL: env.APP_URL })).toEqual({ status: "skipped" });
    expect(send).not.toHaveBeenCalled();
  });

  it("fails clearly when ADMIN_EMAIL belongs to a non-admin user", async () => {
    await pool.query(`insert into "user" (name, email, role, status) values ('L', 'admin@example.test', 'landlord', 'active')`);
    await expect(run()).rejects.toThrow(/not the admin/);
  });
});

describe("invitationEmail", () => {
  it("uses the inviter wording and the expiry date", () => {
    const c = invitationEmail("tok", new Date("2026-10-20T12:00:00Z"), "Pat", "http://x/");
    expect(c.paragraphs[0]).toBe("Pat has invited you to RentNerd, the shared tool for managing your properties.");
    expect(c.paragraphs[1]).toContain("October 20, 2026");
    expect(c.action).toEqual({ label: "Set your password", url: "http://x/accept-invite?token=tok" });
  });
});
