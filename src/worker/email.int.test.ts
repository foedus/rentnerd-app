import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb } from "../db/client";
import { resetAppData } from "../db/reset";
import { createApp } from "../server/app";
import { startWorker, type Worker } from "./boss";
import { enqueueEmail, sendEmailJob, startEmailConsumer, type Mailer } from "./email";

const url = "postgres://rentnerd:rentnerd@localhost:5432/rentnerd_test";
const { pool } = createDb(url);
const smtpEnv = { ...process.env, SMTP_HOST: "localhost", SMTP_PORT: "1025", SMTP_USER: "", ENABLE_TEST_ROUTES: "true" };
const mailpit = "http://localhost:8025/api/v1";

beforeAll(() => {
  execFileSync("npm", ["run", "build"], { stdio: "pipe" });
  execFileSync("node", ["dist/migrate.js"], { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
});
beforeEach(async () => {
  await resetAppData(pool);
  await fetch(`${mailpit}/messages`, { method: "DELETE" });
});
afterAll(() => pool.end());

const content = { heading: "Hi", paragraphs: ["Body text"] };
const logRows = async () => (await pool.query("select * from email_log order by created_at")).rows;
async function waitFor<T>(fn: () => Promise<T | undefined>, ms = 60_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const value = await fn();
    if (value !== undefined) return value;
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 250));
  }
}
async function inbox(): Promise<{ Snippet: string; Subject: string; ID: string }[]> {
  return (await (await fetch(`${mailpit}/messages`)).json()).messages;
}

describe("email.send queue", () => {
  let worker: Worker;
  beforeEach(async () => {
    worker = await startWorker(url);
    await startEmailConsumer(worker.boss, pool, true, smtpEnv);
  });

  it("sends through SMTP with text and html parts and marks the log sent", async () => {
    await enqueueEmail(pool, worker.boss, { to: "a@example.test", template: "test", subject: "Hello", content }, smtpEnv);
    expect((await logRows())[0]).toMatchObject({ status: "queued", to: "a@example.test", template: "test", subject: "Hello" });
    const [msg] = await waitFor(async () => {
      const m = await inbox();
      return m.length ? m : undefined;
    });
    const full = await (await fetch(`${mailpit}/message/${msg!.ID}`)).json();
    expect(full.Text).toContain("RentNerd · private landlord tools");
    expect(full.HTML).toContain("RentNerd · private landlord tools");
    expect(full.From.Address).toBe("noreply@mail.rentnerd.xyz");
    await waitFor(async () => ((await logRows())[0]?.status === "sent" ? true : undefined));
    expect((await logRows())[0]!.sent_at).not.toBeNull();
    await worker.stop();
  });

  it("fail-next-email fails every retry of the next email only, then later emails succeed", async () => {
    const app = createApp(pool, "dist/client", undefined, { testRoutesEnabled: true });
    expect((await app.request("/api/test/fail-next-email", { method: "POST" })).status).toBe(200);
    await enqueueEmail(pool, worker.boss, { to: "a@example.test", template: "test", subject: "Doomed", content }, smtpEnv);
    const failed = await waitFor(async () => {
      const row = (await logRows())[0];
      return row?.status === "failed" ? row : undefined;
    }, 100_000);
    expect(failed.error).toContain("fail-next-email");
    expect(await inbox()).toHaveLength(0);

    await enqueueEmail(pool, worker.boss, { to: "b@example.test", template: "test", subject: "Fine", content }, smtpEnv);
    await waitFor(async () => ((await inbox()).length ? true : undefined));
    expect((await logRows()).map((r) => r.status)).toEqual(["failed", "sent"]);
    await worker.stop();
  }, 150_000);
});

describe("sendEmailJob", () => {
  const job = (data: { emailLogId: string }, retryCount: number) => ({
    data: { ...data, text: "t", html: "<p>h</p>" },
    retryCount,
    retryLimit: 5,
  });
  const failing: Mailer = { sendMail: () => Promise.reject(new Error("smtp down")) };

  it("keeps the log queued with the error until the last retry, then marks it failed", async () => {
    const { rows } = await pool.query("insert into email_log (\"to\", template, subject) values ('a@example.test','t','s') returning id");
    const data = { emailLogId: rows[0].id as string };
    await expect(sendEmailJob(pool, failing, "x@example.test", job(data, 2), false)).rejects.toThrow("smtp down");
    expect((await logRows())[0]).toMatchObject({ status: "queued", error: "smtp down" });
    await expect(sendEmailJob(pool, failing, "x@example.test", job(data, 5), false)).rejects.toThrow("smtp down");
    expect((await logRows())[0]).toMatchObject({ status: "failed", error: "smtp down" });
  });

  it("does not send again once the log is sent", async () => {
    const { rows } = await pool.query("insert into email_log (\"to\", template, subject, status) values ('a@example.test','t','s','sent') returning id");
    await sendEmailJob(pool, failing, "x@example.test", job({ emailLogId: rows[0].id }, 1), false);
  });
});
