import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "../db/client";
import { invitation } from "../db/schema";
import type { EmailContent } from "../shared/email-layout";

export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const INVITATION_SUBJECT = "You're invited to RentNerd";
export const INVITATION_TEMPLATE = "invitation";

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

type Tx = Pick<Db, "insert" | "update">;

/** Revokes any live invitation of the user and creates a new one (SPEC §6.2). Returns the raw token (never stored) and the expiry. */
export async function createInvitation(tx: Tx, userId: string, invitedById: string | null): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  await tx
    .update(invitation)
    .set({ revokedAt: now })
    .where(and(eq(invitation.userId, userId), isNull(invitation.acceptedAt), isNull(invitation.revokedAt)));
  const expiresAt = new Date(now.getTime() + INVITATION_TTL_MS);
  await tx.insert(invitation).values({ userId, tokenHash: hashToken(token), invitedById, expiresAt });
  return { token, expiresAt };
}

/** The §10.1 email. `inviterName` null means the administrator wording. */
export function invitationEmail(token: string, expiresAt: Date, inviterName: string | null, appUrl: string): EmailContent {
  const date = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(expiresAt);
  const intro = inviterName
    ? `${inviterName} has invited you to RentNerd, the shared tool for managing your properties.`
    : "You've been set up as the administrator of RentNerd, the shared tool for managing your properties.";
  return {
    heading: INVITATION_SUBJECT,
    paragraphs: [intro, `This link expires on ${date}. If you weren't expecting this, you can ignore this email.`],
    action: { label: "Set your password", url: `${appUrl.replace(/\/$/, "")}/accept-invite?token=${token}` },
  };
}
