import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { and, eq, like } from "drizzle-orm";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { Db } from "../db/client";
import * as schema from "../db/schema";

import { BLANK_PASSWORD, PASSWORD_MAX, PASSWORD_MIN, notBlank } from "../shared/schemas";
import { writeAudit } from "./audit";
import { RESET_TOKEN_TTL_SECONDS, sendPasswordChangedEmail, sendResetEmail, type PasswordMail } from "./password-emails";

/** Smoke user sign-in/out is not recorded (§6.16, D-24). */
async function recordSignIn(db: Db, userId: string) {
  const [u] = await db.select({ name: schema.user.name, role: schema.user.role }).from(schema.user).where(eq(schema.user.id, userId));
  if (!u || u.role === "smoke") return;
  await writeAudit(db, { actorUserId: userId, action: "sign_in", entityType: "user", entityId: userId, summary: `${u.name} signed in` });
}

/** Failed attempts for an unknown email are logged without the typed address (§6.16). */
async function recordFailedSignIn(db: Db, typedEmail: unknown) {
  const email = typeof typedEmail === "string" ? typedEmail.trim().toLowerCase() : "";
  const [u] = email ? await db.select({ id: schema.user.id, name: schema.user.name }).from(schema.user).where(eq(schema.user.email, email)) : [];
  await writeAudit(db, u
    ? { actorUserId: u.id, action: "sign_in_failed", entityType: "user", entityId: u.id, summary: `Failed sign-in for ${u.name}` }
    : { action: "sign_in_failed", entityType: "user", summary: "Failed sign-in for an unknown email address" });
}

export function createAuth(db: Db, env: NodeJS.ProcessEnv = process.env, mail?: PasswordMail) {
  return betterAuth({
    secret: env.AUTH_SECRET,
    baseURL: env.APP_URL,
    database: drizzleAdapter(db, { provider: "pg", schema }),
    advanced: {
      database: { generateId: "uuid" },
      useSecureCookies: env.APP_URL?.startsWith("https://") === true,
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax" },
    },
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      requireEmailVerification: true,
      minPasswordLength: PASSWORD_MIN,
      maxPasswordLength: PASSWORD_MAX,
      resetPasswordTokenExpiresIn: RESET_TOKEN_TTL_SECONDS,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, token }) => {
        if (mail) await sendResetEmail(mail, user as typeof user & { status?: unknown }, token);
      },
      onPasswordReset: async ({ user }) => {
        // Any other reset link issued earlier must die with this reset (single use, §11.3).
        await db
          .delete(schema.verification)
          .where(and(eq(schema.verification.value, user.id), like(schema.verification.identifier, "reset-password:%")));
        await writeAudit(db, { actorUserId: user.id, action: "password_reset", entityType: "user", entityId: user.id, summary: `${user.name} reset their password` });
        if (mail) await sendPasswordChangedEmail(mail, user);
      },
    },
    hooks: {
      // Better Auth only checks length. Sign-in is not listed, so it keeps its uniform 401 for every wrong password.
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === "/sign-out") {
          const current = await getSessionFromCtx(ctx);
          if (current && current.user.role !== "smoke") {
            await writeAudit(db, { actorUserId: current.user.id, action: "sign_out", entityType: "user", entityId: current.user.id, summary: `${current.user.name} signed out` });
          }
          return;
        }
        if (!["/reset-password", "/change-password", "/set-password"].includes(ctx.path)) return;
        const body = ctx.body as { newPassword?: unknown } | undefined;
        if (typeof body?.newPassword === "string" && !notBlank(body.newPassword)) {
          throw new APIError("BAD_REQUEST", { code: "PASSWORD_BLANK", message: BLANK_PASSWORD });
        }
      }),
      // Same notice as after a reset (§10.4), sent only when Better Auth accepted the change.
      after: createAuthMiddleware(async (ctx) => {
        const failed = ctx.context.returned instanceof Error;
        if (ctx.path === "/sign-in/email" && failed) return recordFailedSignIn(db, (ctx.body as { email?: unknown } | undefined)?.email);
        if (ctx.path !== "/change-password" || failed) return;
        const u = ctx.context.session?.user;
        if (!u) return;
        await writeAudit(db, { actorUserId: u.id, action: "password_changed", entityType: "user", entityId: u.id, summary: `${u.name} changed their password` });
        if (mail) await sendPasswordChangedEmail(mail, u);
      }),
    },
    databaseHooks: {
      session: {
        create: {
          // Only active users may start a session; deactivated accounts get the same answer as a wrong password (§11.1).
          before: async (session) => {
            const [u] = await db.select({ status: schema.user.status }).from(schema.user).where(eq(schema.user.id, session.userId));
            if (u?.status !== "active") {
              throw new APIError("UNAUTHORIZED", { code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid email or password" });
            }
          },
          after: async (session) => {
            await db.update(schema.user).set({ lastSignInAt: new Date() }).where(eq(schema.user.id, session.userId));
            await recordSignIn(db, session.userId);
          },
        },
      },
    },
    session: { expiresIn: 7 * 24 * 60 * 60, updateAge: 24 * 60 * 60 },
    user: {
      additionalFields: {
        role: { type: ["admin", "landlord", "smoke"], required: true, defaultValue: "landlord", input: false },
        status: { type: ["invited", "active", "deactivated"], required: true, defaultValue: "invited", input: false },
        lastSignInAt: { type: "date", required: false, input: false },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
