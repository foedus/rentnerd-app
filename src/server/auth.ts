import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { Db } from "../db/client";
import * as schema from "../db/schema";

import { PASSWORD_MAX, PASSWORD_MIN } from "../shared/schemas";

export function createAuth(db: Db, env: NodeJS.ProcessEnv = process.env) {
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
