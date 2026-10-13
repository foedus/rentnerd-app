import { eq } from "drizzle-orm";
import type pg from "pg";
import type { PgBoss } from "pg-boss";
import type { Db } from "../db/client";
import { user } from "../db/schema";
import { enqueueEmail } from "../worker/email";
import { INVITATION_SUBJECT, INVITATION_TEMPLATE, createInvitation, invitationEmail } from "./invitations";

export type AdminBootstrapResult =
  | { status: "skipped" }
  | { status: "created"; email: string }
  | { status: "exists"; email: string; differs: boolean };

/**
 * Ensures the Admin exists (D-05, D-34): if none does, creates it from ADMIN_EMAIL (role admin, status
 * invited) with one invitation and sends the §10.1 email once. Concurrent starts are safe: the unique
 * "one admin" index lets exactly one insert win, and only the winner sends the email.
 */
export async function bootstrapAdmin(
  db: Db,
  pool: pg.Pool,
  boss: Pick<PgBoss, "send">,
  env: NodeJS.ProcessEnv = process.env,
): Promise<AdminBootstrapResult> {
  const email = env.ADMIN_EMAIL?.trim().toLowerCase();
  const [existing] = await db.select({ email: user.email }).from(user).where(eq(user.role, "admin"));
  if (existing) return adminExists(existing.email, email);
  if (!email) return { status: "skipped" };

  const created = await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(user)
      .values({ name: "Administrator", email, emailVerified: false, role: "admin", status: "invited" })
      .onConflictDoNothing()
      .returning({ id: user.id });
    const row = inserted[0];
    if (!row) return undefined;
    return createInvitation(tx, row.id, null);
  });

  if (!created) {
    const [admin] = await db.select({ email: user.email }).from(user).where(eq(user.role, "admin"));
    if (admin) return adminExists(admin.email, email); // lost a race with a concurrent start
    throw new Error("ADMIN_EMAIL belongs to an existing user who is not the admin");
  }

  const appUrl = env.APP_URL ?? "";
  await enqueueEmail(
    pool,
    boss,
    {
      to: email,
      template: INVITATION_TEMPLATE,
      subject: INVITATION_SUBJECT,
      content: invitationEmail(created.token, created.expiresAt, null, appUrl),
    },
    env,
  );
  return { status: "created", email };
}

function adminExists(adminEmail: string, configured: string | undefined): AdminBootstrapResult {
  const differs = configured !== undefined && configured !== adminEmail;
  if (differs) console.warn(`[web] ADMIN_EMAIL differs from the existing admin (${adminEmail}); ignoring it.`);
  return { status: "exists", email: adminEmail, differs };
}
