import { eq } from "drizzle-orm";
import type { Hono } from "hono";
import type { Db } from "../db/client";
import { user } from "../db/schema";
import { updateMeSchema } from "../shared/schemas";
import { apiError } from "./api-guard";
import { validateBody } from "./validation";

const columns = { id: user.id, name: user.name, email: user.email, role: user.role, status: user.status };

/** The signed-in user's own record (SPEC §14.2). Other users' data is never reachable from here. */
export function mountMeRoutes(app: Hono, db: Db) {
  app.get("/api/me", async (c) => {
    const [me] = await db.select(columns).from(user).where(eq(user.id, c.get("user").id));
    return me ? c.json(me) : apiError(c, "UNAUTHENTICATED", "Please sign in.");
  });

  app.patch("/api/me", async (c) => {
    const parsed = await validateBody(c, updateMeSchema);
    if (!parsed.ok) return parsed.response;
    const [me] = await db
      .update(user)
      .set({ name: parsed.data.name, updatedAt: new Date() })
      .where(eq(user.id, c.get("user").id))
      .returning(columns);
    return me ? c.json(me) : apiError(c, "UNAUTHENTICATED", "Please sign in.");
  });
}
