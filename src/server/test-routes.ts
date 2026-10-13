import type { Hono } from "hono";
import type pg from "pg";
import { z } from "zod";
import { applyClock } from "../db/test-clock";

const clockBody = z.object({ now: z.union([z.iso.datetime({ offset: true }), z.null()]) });

const error = (code: string, message: string) => ({ error: { code, message } });

/** Test-only routes (D-25). Only mounted when the config allows them; they never bypass business rules. */
export function mountTestRoutes(app: Hono, pool: Pick<pg.Pool, "query">) {
  app.post("/api/test/clock", async (c) => {
    const parsed = clockBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json(error("VALIDATION_ERROR", 'Body must be {"now": ISO timestamp | null}'), 400);
    await applyClock(pool, parsed.data.now);
    return c.json({ now: new Date().toISOString() });
  });
}
