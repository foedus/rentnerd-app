import { and, asc, count, desc, eq, inArray, isNull } from "drizzle-orm";
import type { Context, Hono, MiddlewareHandler } from "hono";
import type { Db } from "../db/client";
import { invitation, session, user } from "../db/schema";
import { inviteLandlordSchema, listQuerySchema } from "../shared/schemas";
import type { EnqueueEmail } from "../worker/email";
import { writeAudit } from "./audit";
import { apiError } from "./api-guard";
import { INVITATION_SUBJECT, INVITATION_TEMPLATE, createInvitation, invitationEmail } from "./invitations";
import { validate, validateBody } from "./validation";

export type InvitationState = "valid" | "expired" | "revoked" | "accepted";
export type EnqueueInvitationEmail = (email: EnqueueEmail) => Promise<unknown>;

const requireAdmin: MiddlewareHandler = async (c, next) => {
  if (c.get("user").role !== "admin") return apiError(c, "FORBIDDEN", "Only the administrator can do this.");
  await next();
};

const stateOf = (i: { acceptedAt: Date | null; revokedAt: Date | null; expiresAt: Date }): InvitationState =>
  i.acceptedAt ? "accepted" : i.revokedAt ? "revoked" : i.expiresAt.getTime() <= Date.now() ? "expired" : "valid";

const invitationColumns = {
  id: invitation.id,
  userId: invitation.userId,
  email: user.email,
  name: user.name,
  invitedById: invitation.invitedById,
  expiresAt: invitation.expiresAt,
  acceptedAt: invitation.acceptedAt,
  revokedAt: invitation.revokedAt,
  createdAt: invitation.createdAt,
};

type InvitationRow = {
  id: string; userId: string; email: string; name: string; invitedById: string | null;
  expiresAt: Date; acceptedAt: Date | null; revokedAt: Date | null; createdAt: Date;
};
const present = ({ acceptedAt, revokedAt, ...i }: InvitationRow) => ({ ...i, state: stateOf({ acceptedAt, revokedAt, expiresAt: i.expiresAt }) });

/** Admin-only user management (SPEC §14.2, D-06, D-07): users list, invitations, deactivate/reactivate. */
export function mountUserRoutes(app: Hono, db: Db, enqueue: EnqueueInvitationEmail, appUrl: string) {
  const paging = (c: Context) => validate(c, listQuerySchema, { page: c.req.query("page"), pageSize: c.req.query("pageSize") });

  /** The newest invitation of each user that has one, keyed by user id. */
  const latestInvitations = async (userIds: string[]) => {
    const latest = new Map<string, InvitationRow>();
    if (userIds.length === 0) return latest;
    const rows = await db
      .select(invitationColumns)
      .from(invitation)
      .innerJoin(user, eq(user.id, invitation.userId))
      .where(inArray(invitation.userId, userIds))
      .orderBy(desc(invitation.createdAt));
    for (const r of rows) if (!latest.has(r.userId)) latest.set(r.userId, r);
    return latest;
  };

  app.get("/api/users", requireAdmin, async (c) => {
    const p = paging(c);
    if (!p.ok) return p.response;
    const { page, pageSize } = p.data;
    const [{ total = 0 } = {}] = await db.select({ total: count() }).from(user);
    const rows = await db
      .select({ id: user.id, name: user.name, email: user.email, role: user.role, status: user.status, lastSignInAt: user.lastSignInAt })
      .from(user)
      .orderBy(asc(user.name), asc(user.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const latest = await latestInvitations(rows.filter((r) => r.status === "invited").map((r) => r.id));
    const data = rows.map((r) => {
      const inv = latest.get(r.id);
      return { ...r, invitation: inv ? present(inv) : null };
    });
    return c.json({ data, page, pageSize, total });
  });

  app.get("/api/invitations", requireAdmin, async (c) => {
    const p = paging(c);
    if (!p.ok) return p.response;
    const { page, pageSize } = p.data;
    const unaccepted = isNull(invitation.acceptedAt);
    const [{ total = 0 } = {}] = await db.select({ total: count() }).from(invitation).where(unaccepted);
    const rows = await db
      .select(invitationColumns)
      .from(invitation)
      .innerJoin(user, eq(user.id, invitation.userId))
      .where(unaccepted)
      .orderBy(desc(invitation.createdAt), asc(invitation.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    return c.json({ data: rows.map(present), page, pageSize, total });
  });

  /** Creates the invitation for the user and queues the §10.1 email, naming the inviter. */
  const issue = async (c: Context, create: (tx: Pick<Db, "insert" | "update">) => Promise<{ userId: string }>, resend = false) => {
    const inviterId = c.get("user").id;
    const result = await db.transaction(async (tx) => {
      const made = await create(tx);
      const inv = await createInvitation(tx, made.userId, inviterId);
      const [inviter] = await tx.select({ name: user.name }).from(user).where(eq(user.id, inviterId));
      const [row] = await tx.select(invitationColumns).from(invitation).innerJoin(user, eq(user.id, invitation.userId)).where(eq(invitation.userId, made.userId)).orderBy(desc(invitation.createdAt)).limit(1);
      const invited = row as InvitationRow;
      await writeAudit(tx, { actorUserId: inviterId, action: "invite", entityType: "user", entityId: made.userId, summary: `${resend ? "Resent invitation to" : "Invited"} ${invited.name} (${invited.email})` });
      return { inv, inviter: inviter?.name ?? "The administrator", row: invited };
    });
    await enqueue({
      to: result.row.email,
      template: INVITATION_TEMPLATE,
      subject: INVITATION_SUBJECT,
      content: invitationEmail(result.inv.token, result.inv.expiresAt, result.inviter, appUrl),
    });
    return present(result.row);
  };

  app.post("/api/invitations", requireAdmin, async (c) => {
    const parsed = await validateBody(c, inviteLandlordSchema);
    if (!parsed.ok) return parsed.response;
    const { name, email } = parsed.data;
    try {
      return c.json(
        await issue(c, async (tx) => {
          const [row] = await tx.insert(user).values({ name, email, emailVerified: false, role: "landlord", status: "invited" }).returning({ userId: user.id });
          return row as { userId: string };
        }),
        201,
      );
    } catch (error) {
      if ((error as { code?: string; cause?: { code?: string } }).code === "23505" || (error as { cause?: { code?: string } }).cause?.code === "23505")
        return apiError(c, "CONFLICT", "A user with this email already exists.");
      throw error;
    }
  });

  const invitationOwner = async (id: string) => {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return undefined;
    const [row] = await db.select(invitationColumns).from(invitation).innerJoin(user, eq(user.id, invitation.userId)).where(eq(invitation.id, id));
    return row;
  };

  app.post("/api/invitations/:id/resend", requireAdmin, async (c) => {
    const inv = await invitationOwner(c.req.param("id"));
    if (!inv) return apiError(c, "NOT_FOUND", "Invitation not found.");
    const [target] = await db.select({ status: user.status }).from(user).where(eq(user.id, inv.userId));
    if (target?.status !== "invited") return apiError(c, "CONFLICT", "This person has already accepted their invitation.");
    return c.json(await issue(c, async () => ({ userId: inv.userId }), true));
  });

  app.post("/api/invitations/:id/revoke", requireAdmin, async (c) => {
    const inv = await invitationOwner(c.req.param("id"));
    if (!inv) return apiError(c, "NOT_FOUND", "Invitation not found.");
    const revoked = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(invitation)
        .set({ revokedAt: new Date() })
        .where(and(eq(invitation.id, inv.id), isNull(invitation.acceptedAt), isNull(invitation.revokedAt)))
        .returning({ id: invitation.id });
      if (row) await writeAudit(tx, { actorUserId: c.get("user").id, action: "invite_revoked", entityType: "user", entityId: inv.userId, summary: `Revoked the invitation for ${inv.name} (${inv.email})` });
      return row;
    });
    if (!revoked) return apiError(c, "CONFLICT", "This invitation can no longer be revoked.");
    return c.json(present({ ...inv, revokedAt: new Date() }));
  });

  const userId = (c: Context) => c.req.param("id") ?? "";
  const findUser = async (id: string) => {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return undefined;
    const [row] = await db.select({ id: user.id, role: user.role, status: user.status }).from(user).where(eq(user.id, id));
    return row;
  };
  const publicUser = { id: user.id, name: user.name, email: user.email, role: user.role, status: user.status, lastSignInAt: user.lastSignInAt };

  app.post("/api/users/:id/deactivate", requireAdmin, async (c) => {
    const target = await findUser(userId(c));
    if (!target) return apiError(c, "NOT_FOUND", "User not found.");
    if (target.role !== "landlord") return apiError(c, "FORBIDDEN", "This account can't be deactivated.");
    if (target.status !== "active") return apiError(c, "CONFLICT", "Only active landlords can be deactivated.");
    // Sessions are revoked in the same transaction (D-06). Responsible-landlord reassignment arrives with properties.
    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(user)
        .set({ status: "deactivated", updatedAt: new Date() })
        .where(and(eq(user.id, target.id), eq(user.status, "active")))
        .returning(publicUser);
      if (row) {
        await tx.delete(session).where(eq(session.userId, target.id));
        await writeAudit(tx, { actorUserId: c.get("user").id, action: "deactivate", entityType: "user", entityId: row.id, summary: `Deactivated ${row.name} (${row.email})` });
      }
      return row;
    });
    return updated ? c.json(updated) : apiError(c, "CONFLICT", "Only active landlords can be deactivated.");
  });

  app.post("/api/users/:id/reactivate", requireAdmin, async (c) => {
    const target = await findUser(userId(c));
    if (!target) return apiError(c, "NOT_FOUND", "User not found.");
    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(user)
        .set({ status: "active", updatedAt: new Date() })
        .where(and(eq(user.id, target.id), eq(user.status, "deactivated")))
        .returning(publicUser);
      if (row) await writeAudit(tx, { actorUserId: c.get("user").id, action: "reactivate", entityType: "user", entityId: row.id, summary: `Reactivated ${row.name} (${row.email})` });
      return row;
    });
    return updated ? c.json(updated) : apiError(c, "CONFLICT", "Only deactivated users can be reactivated.");
  });
}
