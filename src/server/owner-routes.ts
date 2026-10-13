import { and, asc, count, desc, eq, ilike, isNull, or, sql, type SQL } from "drizzle-orm";
import type { Context, Hono } from "hono";
import type { Db } from "../db/client";
import { owner } from "../db/schema";
import { createOwnerSchema, ownerListQuerySchema, updateOwnerSchema, versionSchema } from "../shared/schemas";
import { diffChanges, writeAudit } from "./audit";
import { apiError } from "./api-guard";
import { validate, validateBody } from "./validation";

type Tx = Pick<Db, "select" | "insert" | "update" | "delete">;
export type OwnerRow = typeof owner.$inferSelect;
export type PropertyLink = { id: string; name: string };

/** What refers to an owner (§6.3): non-archived properties/units block archiving; any reference blocks deleting. */
export interface OwnerUsage {
  activeProperties(tx: Tx, ownerId: string): Promise<PropertyLink[]>;
  isReferenced(tx: Tx, ownerId: string): Promise<boolean>;
}

/** No property or unit tables exist yet; the Properties task replaces this with real lookups. */
export const noOwnerUsage: OwnerUsage = {
  activeProperties: async () => [],
  isReferenced: async () => false,
};

const LABELS = {
  name: "Owner name", ownerType: "Owner type", addressLine1: "Mailing address line 1", addressLine2: "Mailing address line 2",
  city: "City", state: "State", zip: "ZIP code", email: "Email", phone: "Phone", signatoryName: "Signatory name",
  signatoryTitle: "Signatory title", notes: "Notes",
} as const;

const SORT = { name: owner.name, ownerType: owner.ownerType, city: owner.city, createdAt: owner.createdAt } as const;
const isUuid = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
const escapeLike = (q: string) => q.replace(/[\\%_]/g, "\\$&");

const notFound = (c: Context) => apiError(c, "NOT_FOUND", "Owner not found.");
const stale = (c: Context) => apiError(c, "CONFLICT", "This owner was changed by someone else. Reload and try again.");

/** Owners CRUD, archive and restore (SPEC §6.3, §14.2). Every editor may use them; the Smoke user is blocked by the session guard. */
export function mountOwnerRoutes(app: Hono, db: Db, usage: OwnerUsage = noOwnerUsage) {
  /** Actions accept an optional `version` (§14); an empty body is fine. */
  const actionVersion = async (c: Context) => validate(c, versionSchema, await c.req.json().catch(() => ({})));
  const present = ({ archivedAt, ...o }: OwnerRow) => ({ ...o, archivedAt });
  const actor = (c: Context) => c.get("user").id;

  /** Runs `change` on the locked owner row once the version matches; maps missing and stale rows to 404 / 409. */
  const mutate = async (c: Context, version: number | undefined, change: (tx: Tx, current: OwnerRow) => Promise<Response | OwnerRow>) => {
    const id = c.req.param("id") ?? "";
    if (!isUuid(id)) return notFound(c);
    const result = await db.transaction(async (tx) => {
      const [current] = await tx.select().from(owner).where(eq(owner.id, id)).for("update");
      if (!current) return notFound(c);
      if (version !== undefined && current.version !== version) return stale(c);
      return change(tx, current);
    });
    return result instanceof Response ? result : c.json(present(result));
  };

  app.get("/api/owners", async (c) => {
    const q = validate(c, ownerListQuerySchema, Object.fromEntries(new URL(c.req.url).searchParams));
    if (!q.ok) return q.response;
    const { page, pageSize, sort, order, q: search, archived } = q.data;
    const conditions: SQL[] = [];
    if (archived !== "true") conditions.push(isNull(owner.archivedAt));
    if (search) {
      const like = `%${escapeLike(search)}%`;
      conditions.push(or(ilike(owner.name, like), ilike(owner.city, like), ilike(owner.email, like)) as SQL);
    }
    const where = and(...conditions);
    const [{ total = 0 } = {}] = await db.select({ total: count() }).from(owner).where(where);
    const dir = order === "desc" ? desc : asc;
    const rows = await db.select().from(owner).where(where).orderBy(dir(SORT[sort]), asc(owner.id)).limit(pageSize).offset((page - 1) * pageSize);
    const data = await Promise.all(rows.map(async (o) => ({ ...present(o), properties: await usage.activeProperties(db, o.id) })));
    return c.json({ data, page, pageSize, total });
  });

  app.post("/api/owners", async (c) => {
    const parsed = await validateBody(c, createOwnerSchema);
    if (!parsed.ok) return parsed.response;
    const created = await db.transaction(async (tx) => {
      const [row] = await tx.insert(owner).values({ ...parsed.data, createdById: actor(c), updatedById: actor(c) }).returning();
      const o = row as OwnerRow;
      await writeAudit(tx, { actorUserId: actor(c), action: "create", entityType: "owner", entityId: o.id, summary: `Created owner ${o.name}` });
      return o;
    });
    return c.json(present(created), 201);
  });

  app.get("/api/owners/:id", async (c) => {
    const id = c.req.param("id");
    if (!isUuid(id)) return notFound(c);
    const [row] = await db.select().from(owner).where(eq(owner.id, id));
    if (!row) return notFound(c);
    return c.json({ ...present(row), properties: await usage.activeProperties(db, id) });
  });

  app.patch("/api/owners/:id", async (c) => {
    const parsed = await validateBody(c, updateOwnerSchema);
    if (!parsed.ok) return parsed.response;
    const { version, ...fields } = parsed.data;
    return mutate(c, version, async (tx, current) => {
      const [row] = await tx
        .update(owner)
        .set({ ...fields, version: sql`${owner.version} + 1`, updatedById: actor(c), updatedAt: new Date() })
        .where(eq(owner.id, current.id))
        .returning();
      const updated = row as OwnerRow;
      const changes = diffChanges(current, updated, LABELS, (v) => String(v));
      await writeAudit(tx, { actorUserId: actor(c), action: "update", entityType: "owner", entityId: updated.id, summary: `Updated owner ${updated.name}`, changes });
      return updated;
    });
  });

  app.post("/api/owners/:id/archive", async (c) => {
    const parsed = await actionVersion(c);
    if (!parsed.ok) return parsed.response;
    return mutate(c, parsed.data.version, async (tx, current) => {
      if (current.archivedAt) return apiError(c, "CONFLICT", "This owner is already archived.");
      const blocking = await usage.activeProperties(tx, current.id);
      if (blocking.length > 0) {
        return c.json(
          { error: { code: "CONFLICT", message: "Change the owner on these properties before archiving this owner:", properties: blocking } },
          409,
        );
      }
      const [row] = await tx
        .update(owner)
        .set({ archivedAt: new Date(), version: sql`${owner.version} + 1`, updatedById: actor(c), updatedAt: new Date() })
        .where(eq(owner.id, current.id))
        .returning();
      const archived = row as OwnerRow;
      await writeAudit(tx, { actorUserId: actor(c), action: "archive", entityType: "owner", entityId: archived.id, summary: `Archived owner ${archived.name}` });
      return archived;
    });
  });

  app.post("/api/owners/:id/restore", async (c) => {
    const parsed = await actionVersion(c);
    if (!parsed.ok) return parsed.response;
    return mutate(c, parsed.data.version, async (tx, current) => {
      if (!current.archivedAt) return apiError(c, "CONFLICT", "This owner is not archived.");
      const [row] = await tx
        .update(owner)
        .set({ archivedAt: null, version: sql`${owner.version} + 1`, updatedById: actor(c), updatedAt: new Date() })
        .where(eq(owner.id, current.id))
        .returning();
      const restored = row as OwnerRow;
      await writeAudit(tx, { actorUserId: actor(c), action: "restore", entityType: "owner", entityId: restored.id, summary: `Restored owner ${restored.name}` });
      return restored;
    });
  });

  app.delete("/api/owners/:id", async (c) => {
    const id = c.req.param("id");
    if (!isUuid(id)) return notFound(c);
    return db.transaction(async (tx) => {
      const [current] = await tx.select().from(owner).where(eq(owner.id, id)).for("update");
      if (!current) return notFound(c);
      if (await usage.isReferenced(tx, id)) return apiError(c, "CONFLICT", "Owners used by properties or units can only be archived");
      await tx.delete(owner).where(eq(owner.id, id));
      await writeAudit(tx, { actorUserId: actor(c), action: "delete", entityType: "owner", entityId: id, summary: `Deleted owner ${current.name}` });
      return c.body(null, 204);
    });
  });
}
