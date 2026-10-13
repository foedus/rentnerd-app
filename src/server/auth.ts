import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { and, eq, like } from "drizzle-orm";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { Db } from "../db/client";
import * as schema from "../db/schema";

import { BLANK_PASSWORD, PASSWORD_MAX, PASSWORD_MIN, notBlank } from "../shared/schemas";
import { RESET_TOKEN_TTL_SECONDS, sendPasswordChangedEmail, sendResetEmail, type PasswordMail } from "./password-emails";

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
        if (mail) await sendPasswordChangedEmail(mail, user);
      },
    },
    hooks: {
      // Better Auth only checks length. Sign-in is not listed, so it keeps its uniform 401 for every wrong password.
      before: createAuthMiddleware(async (ctx) => {
        if (!["/reset-password", "/change-password", "/set-password"].includes(ctx.path)) return;
        const body = ctx.body as { newPassword?: unknown } | undefined;
        if (typeof body?.newPassword === "string" && !notBlank(body.newPassword)) {
          throw new APIError("BAD_REQUEST", { code: "PASSWORD_BLANK", message: BLANK_PASSWORD });
        }
      }),
      // Same notice as after a reset (§10.4), sent only when Better Auth accepted the change.
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/change-password" || !mail) return;
        if (ctx.context.returned instanceof Error) return;
        const u = ctx.context.session?.user;
        if (u) await sendPasswordChangedEmail(mail, u);
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
