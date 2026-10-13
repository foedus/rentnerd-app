import { and, eq, gt, isNull } from "drizzle-orm";
import type { Hono } from "hono";
import type { Db } from "../db/client";
import { account, invitation, user } from "../db/schema";
import { acceptInvitationSchema, lookupInvitationSchema } from "../shared/schemas";
import { apiError } from "./api-guard";
import type { Auth } from "./auth";
import { hashToken } from "./invitations";
import { RateLimiter, rateLimit } from "./rate-limit";
import { validate, validateBody } from "./validation";

const INVALID = "This invitation is invalid or has expired. Ask the administrator to send a new one.";

/** Public invitation routes (SPEC §14.2), limited to 20 requests per IP per 15 minutes (§16). */
export function mountInvitationRoutes(app: Hono, db: Db, auth: Auth, limiter = new RateLimiter(20, 15 * 60_000)) {
  app.use("/api/invitations/lookup", rateLimit(limiter));
  app.use("/api/invitations/accept", rateLimit(limiter));

  const live = (tokenHash: string) =>
    and(
      eq(invitation.tokenHash, tokenHash),
      isNull(invitation.acceptedAt),
      isNull(invitation.revokedAt),
      gt(invitation.expiresAt, new Date()),
      eq(user.status, "invited"),
    );

  app.get("/api/invitations/lookup", async (c) => {
    const parsed = validate(c, lookupInvitationSchema, { token: c.req.query("token") });
    if (!parsed.ok) return apiError(c, "NOT_FOUND", INVALID);
    const [row] = await db
      .select({ email: user.email, name: user.name })
      .from(invitation)
      .innerJoin(user, eq(user.id, invitation.userId))
      .where(live(hashToken(parsed.data.token)));
    return row ? c.json(row) : apiError(c, "NOT_FOUND", INVALID);
  });

  app.post("/api/invitations/accept", async (c) => {
    const parsed = await validateBody(c, acceptInvitationSchema);
    if (!parsed.ok) return parsed.response;
    const { token, name, password } = parsed.data;
    const hash = await (await auth.$context).password.hash(password);

    // Claiming the invitation (accepted_at is null -> now) makes it single use even under concurrent requests.
    const email = await db.transaction(async (tx) => {
      const [row] = await tx
        .select({ id: invitation.id, userId: invitation.userId, email: user.email })
        .from(invitation)
        .innerJoin(user, eq(user.id, invitation.userId))
        .where(live(hashToken(token)));
      if (!row) return undefined;
      const claimed = await tx
        .update(invitation)
        .set({ acceptedAt: new Date() })
        .where(and(eq(invitation.id, row.id), isNull(invitation.acceptedAt), isNull(invitation.revokedAt)))
        .returning({ id: invitation.id });
      if (claimed.length === 0) return undefined;
      await tx.update(user).set({ name, emailVerified: true, status: "active", updatedAt: new Date() }).where(eq(user.id, row.userId));
      await tx.delete(account).where(and(eq(account.userId, row.userId), eq(account.providerId, "credential")));
      await tx.insert(account).values({ userId: row.userId, providerId: "credential", accountId: row.userId, password: hash });
      return row.email;
    });
    if (!email) return apiError(c, "NOT_FOUND", INVALID);

    // Sign in through Better Auth so the session cookie carries the standard attributes.
    const signedIn = await auth.api.signInEmail({ body: { email, password }, asResponse: true });
    const res = c.json({ ok: true });
    for (const cookie of signedIn.headers.getSetCookie()) res.headers.append("set-cookie", cookie);
    return res;
  });
}
