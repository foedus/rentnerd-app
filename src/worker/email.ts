import { eq } from "drizzle-orm";
import nodemailer from "nodemailer";
import type pg from "pg";
import type { PgBoss } from "pg-boss";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema";
import { emailLog } from "../db/schema";
import { renderEmail, type EmailContent } from "../shared/email-layout";

export const EMAIL_QUEUE = "email.send";
export const FAIL_NEXT_EMAIL = "fail-next-email";
const MAX_RETRIES = 5;

export interface EmailJob {
  emailLogId: string;
}

export interface Mailer {
  sendMail(message: { from: string; to: string; subject: string; text: string; html: string }): Promise<unknown>;
}

/** Nodemailer SMTP transport from the SPEC §4 variables (Mailpit locally, no auth when SMTP_USER is empty). */
export function createMailer(env: NodeJS.ProcessEnv = process.env): { mailer: Mailer; from: string } {
  const host = env.SMTP_HOST;
  if (!host) throw new Error("SMTP_HOST is not set");
  const port = Number(env.SMTP_PORT ?? 587);
  const mailer = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS ?? "" } : undefined,
  });
  return { mailer, from: env.MAIL_FROM ?? "RentNerd <noreply@mail.rentnerd.xyz>" };
}

export interface EnqueueEmail {
  to: string;
  template: string;
  subject: string;
  content: EmailContent;
  /** pg-boss singleton key, e.g. (recipient, date) for the digest. */
  singletonKey?: string;
}

/** Records the message in `email_log` (queued) and enqueues the send job: 5 retries, exponential backoff (D-28). */
export async function enqueueEmail(
  pool: pg.Pool,
  boss: Pick<PgBoss, "send">,
  email: EnqueueEmail,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const db = drizzle(pool, { schema });
  const { text, html } = renderEmail(email.content);
  const [row] = await db
    .insert(emailLog)
    .values({ to: email.to, template: email.template, subject: email.subject })
    .returning({ id: emailLog.id });
  if (!row) throw new Error("email_log insert returned no row");
  const job: EmailJob & { text: string; html: string } = { emailLogId: row.id, text, html };
  await boss.send(EMAIL_QUEUE, job, {
    retryLimit: MAX_RETRIES,
    retryDelay: env.ENABLE_TEST_ROUTES === "true" ? 1 : 30,
    retryBackoff: true,
    singletonKey: email.singletonKey,
  });
  return row.id;
}

async function shouldFailForTest(pool: pg.Pool, logId: string, firstAttempt: boolean): Promise<boolean> {
  const own = `${FAIL_NEXT_EMAIL}:${logId}`;
  if (firstAttempt) {
    // Claim the one-shot flag for this message so every retry of it fails, and no other message does.
    const claimed = await pool.query("delete from test_flag where name = $1 returning name", [FAIL_NEXT_EMAIL]);
    if (claimed.rowCount) {
      await pool.query("insert into test_flag (name) values ($1) on conflict do nothing", [own]);
      return true;
    }
  }
  const { rowCount } = await pool.query("select 1 from test_flag where name = $1", [own]);
  return Boolean(rowCount);
}

export interface SendEmailJob extends EmailJob {
  text: string;
  html: string;
}

/** Handles one attempt of an email.send job; throws on failure so pg-boss retries. */
export async function sendEmailJob(
  pool: pg.Pool,
  mailer: Mailer,
  from: string,
  job: { data: SendEmailJob; retryCount: number; retryLimit: number },
  testHooks: boolean,
): Promise<void> {
  const db = drizzle(pool, { schema });
  const [log] = await db.select().from(emailLog).where(eq(emailLog.id, job.data.emailLogId));
  if (!log || log.status === "sent") return;
  try {
    if (testHooks && (await shouldFailForTest(pool, log.id, job.retryCount === 0))) {
      throw new Error("Simulated email failure (fail-next-email)");
    }
    await mailer.sendMail({ from, to: log.to, subject: log.subject, text: job.data.text, html: job.data.html });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const final = job.retryCount >= job.retryLimit;
    await db
      .update(emailLog)
      .set({ error: message, ...(final ? { status: "failed" as const } : {}) })
      .where(eq(emailLog.id, log.id));
    throw error;
  }
  await db.update(emailLog).set({ status: "sent", sentAt: new Date(), error: null }).where(eq(emailLog.id, log.id));
}

/** Registers the email.send consumer. */
export async function startEmailConsumer(boss: PgBoss, pool: pg.Pool, testHooks: boolean, env: NodeJS.ProcessEnv = process.env) {
  const { mailer, from } = createMailer(env);
  await boss.work<SendEmailJob, void, { includeMetadata: true; pollingIntervalSeconds: number }>(EMAIL_QUEUE, { includeMetadata: true, pollingIntervalSeconds: 1 }, async (jobs) => {
    for (const job of jobs) await sendEmailJob(pool, mailer, from, job, testHooks);
  });
}
