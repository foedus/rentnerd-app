import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { account, user } from "../db/schema";
import type { Auth } from "./auth";

const SMOKE_NAME = "Smoke Test";

/**
 * Creates the read-only smoke user if absent and re-syncs its password on every start
 * (SPEC §15.3, D-34). Safe to run twice at once: inserts use the unique email index and
 * the loser of a race falls through to the update path.
 */
export async function seedSmokeUser(auth: Auth, db: Db, env: NodeJS.ProcessEnv = process.env) {
  const email = env.SMOKE_USER_EMAIL?.trim().toLowerCase();
  const password = env.SMOKE_USER_PASSWORD;
  if (!email || !password) return { seeded: false as const };

  const hash = await (await auth.$context).password.hash(password);

  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(user)
      .values({ name: SMOKE_NAME, email, emailVerified: true, role: "smoke", status: "active" })
      .onConflictDoNothing({ target: user.email })
      .returning({ id: user.id });
    const created = inserted.length > 0;

    const [row] = await tx.select().from(user).where(eq(user.email, email));
    if (!row || row.role !== "smoke") {
      throw new Error("SMOKE_USER_EMAIL belongs to a user who is not the smoke user");
    }
    if (!row.emailVerified || row.status !== "active") {
      await tx.update(user).set({ emailVerified: true, status: "active" }).where(eq(user.id, row.id));
    }
    const credential = and(eq(account.userId, row.id), eq(account.providerId, "credential"));
    const updated = await tx
      .update(account)
      .set({ password: hash, updatedAt: new Date() })
      .where(credential)
      .returning({ id: account.id });
    if (updated.length === 0) {
      await tx
        .insert(account)
        .values({ userId: row.id, providerId: "credential", accountId: row.id, password: hash });
    }
    return { seeded: true as const, created };
  });
}
