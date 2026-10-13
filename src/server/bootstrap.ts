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

export type ResendAdminInviteResult = { status: "sent"; email: string } | { status: "active"; email: string } | { status: "no-admin" };

/** `resend-admin-invite` (D-05): sends the admin a fresh invitation link; does nothing once the admin is active. */
export async function resendAdminInvite(
  db: Db,
  pool: pg.Pool,
  boss: Pick<PgBoss, "send">,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ResendAdminInviteResult> {
  const created = await db.transaction(async (tx) => {
    const [admin] = await tx.select({ id: user.id, email: user.email, status: user.status }).from(user).where(eq(user.role, "admin")).for("update");
    if (!admin) return { status: "no-admin" as const };
    if (admin.status !== "invited") return { status: "active" as const, email: admin.email };
    return { status: "sent" as const, email: admin.email, ...(await createInvitation(tx, admin.id, null)) };
  });
  if (created.status !== "sent") return created;
  await enqueueEmail(
    pool,
    boss,
    {
      to: created.email,
      template: INVITATION_TEMPLATE,
      subject: INVITATION_SUBJECT,
      content: invitationEmail(created.token, created.expiresAt, null, env.APP_URL ?? ""),
    },
    env,
  );
  return { status: "sent", email: created.email };
}
