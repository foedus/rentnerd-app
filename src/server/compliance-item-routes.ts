import { and, asc, desc, eq, inArray, isNull, max, sql } from "drizzle-orm";
import type { Context, Hono } from "hono";
import type { Db } from "../db/client";
import { complianceCompletion, complianceItemType, property, propertyComplianceItem, propertyResponsible, user } from "../db/schema";
import { complianceStatus } from "../shared/compliance";
import { complianceItemListQuerySchema, createComplianceCompletionSchema, updateComplianceItemSchema } from "../shared/compliance-schemas";
import { initialDueDate } from "../shared/compliance-rules";
import { compareYmd, todayNy } from "../shared/dates";
import { listQuerySchema } from "../shared/schemas";
import { diffChanges, writeAudit } from "./audit";
import { apiError } from "./api-guard";
import { validate, validateBody } from "./validation";

type Tx = Pick<Db, "select" | "insert" | "update" | "delete">;
type ItemRow = typeof propertyComplianceItem.$inferSelect;
type TypeRow = typeof complianceItemType.$inferSelect;
type Person = { id: string; name: string; email: string };

const isUuid = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
const itemNotFound = (c: Context) => apiError(c, "NOT_FOUND", "Compliance item not found.");
const completionNotFound = (c: Context) => apiError(c, "NOT_FOUND", "Completion not found.");
const stale = (c: Context) => apiError(c, "CONFLICT", "This item was changed by someone else. Reload and try again.");

/** An item as the screens show it: the stored row, its type's schedule, and the derived status (§9.2, D-32). */
async function presentItems(tx: Tx, rows: { item: ItemRow; type: TypeRow; propertyName: string }[], today: string) {
  const ids = rows.map((r) => r.item.id);
  const propertyIds = [...new Set(rows.map((r) => r.item.propertyId))];
  const stats = new Map<string, { count: number; last: string | null }>();
  const people = new Map<string, Person[]>(propertyIds.map((id) => [id, []]));
  if (ids.length > 0) {
    const found = await tx
      .select({ itemId: complianceCompletion.itemId, n: sql<number>`count(*)::int`, last: max(complianceCompletion.completedOn) })
      .from(complianceCompletion)
      .where(inArray(complianceCompletion.itemId, ids))
      .groupBy(complianceCompletion.itemId);
    for (const f of found) stats.set(f.itemId, { count: f.n, last: f.last });
    const responsible = await tx
      .select({ propertyId: propertyResponsible.propertyId, id: user.id, name: user.name, email: user.email })
      .from(propertyResponsible)
      .innerJoin(user, eq(user.id, propertyResponsible.userId))
      .where(inArray(propertyResponsible.propertyId, propertyIds))
      .orderBy(asc(user.name), asc(user.email));
    for (const { propertyId, ...p } of responsible) people.get(propertyId)?.push(p);
  }
  return rows.map(({ item, type, propertyName }) => {
    const s = stats.get(item.id) ?? { count: 0, last: null };
    return {
      ...item,
      propertyName,
      type: { id: type.id, name: type.name, description: type.description, scheduleType: type.scheduleType, dueMonth: type.dueMonth, dueDay: type.dueDay, intervalMonths: type.intervalMonths },
      completionCount: s.count,
      lastCompletedOn: s.last,
      status: complianceStatus({ applicable: item.applicable, scheduleType: type.scheduleType, nextDueDate: item.nextDueDate, completionCount: s.count }, today),
      responsible: people.get(item.propertyId) ?? [],
    };
  });
}

/** By due date (so overdue items come first); items without one last; ties by property and item name. */
const byDue = (a: { nextDueDate: string | null; propertyName: string; type: { name: string } }, b: typeof a) =>
  (a.nextDueDate === null ? 1 : 0) - (b.nextDueDate === null ? 1 : 0) ||
  (a.nextDueDate && b.nextDueDate ? compareYmd(a.nextDueDate, b.nextDueDate) : 0) ||
  a.propertyName.localeCompare(b.propertyName) ||
  a.type.name.localeCompare(b.type.name);

/** Compliance items and their completions (§6.14, §14.2). Items are only switched, rescheduled and completed, never created or deleted here. */
export function mountComplianceItemRoutes(app: Hono, db: Db) {
  const actor = (c: Context) => c.get("user").id;

  const candidates = (tx: Tx, where: ReturnType<typeof and>) =>
    tx
      .select({ item: propertyComplianceItem, type: complianceItemType, propertyName: property.name })
      .from(propertyComplianceItem)
      .innerJoin(complianceItemType, eq(complianceItemType.id, propertyComplianceItem.typeId))
      .innerJoin(property, eq(property.id, propertyComplianceItem.propertyId))
      .where(and(isNull(complianceItemType.archivedAt), where));

  app.get("/api/properties/:id/compliance", async (c) => {
    const propertyId = c.req.param("id");
    if (!isUuid(propertyId)) return apiError(c, "NOT_FOUND", "Property not found.");
    const [p] = await db.select({ id: property.id }).from(property).where(eq(property.id, propertyId));
    if (!p) return apiError(c, "NOT_FOUND", "Property not found.");
    const rows = (await candidates(db, eq(propertyComplianceItem.propertyId, propertyId))).sort((a, b) => a.type.name.localeCompare(b.type.name));
    const data = await presentItems(db, rows, todayNy());
    return c.json({ data, page: 1, pageSize: data.length, total: data.length });
  });

  app.get("/api/compliance/items", async (c) => {
    const q = validate(c, complianceItemListQuerySchema, Object.fromEntries(new URL(c.req.url).searchParams));
    if (!q.ok) return q.response;
    const { page, pageSize, propertyId, responsibleUserId, status } = q.data;
    const conditions = [isNull(property.archivedAt)];
    if (propertyId) conditions.push(eq(propertyComplianceItem.propertyId, propertyId));
    if (responsibleUserId) {
      conditions.push(inArray(propertyComplianceItem.propertyId, db.select({ id: propertyResponsible.propertyId }).from(propertyResponsible).where(eq(propertyResponsible.userId, responsibleUserId))));
    }
    // Status is derived (D-32), so it is filtered here after loading the candidates.
    const rows = await candidates(db, and(...conditions));
    const today = todayNy();
    const all = (await presentItems(db, rows, today)).filter((i) => !status || status.includes(i.status)).sort(byDue);
    return c.json({ data: all.slice((page - 1) * pageSize, page * pageSize), page, pageSize, total: all.length });
  });

  /** One item with everything the screens show, for the responses of the write routes. */
  const itemView = async (tx: Tx, id: string) => {
    const [row] = await candidates(tx, eq(propertyComplianceItem.id, id)).limit(1);
    return row ? (await presentItems(tx, [row], todayNy()))[0] : undefined;
  };
  const label = async (tx: Tx, item: ItemRow) => {
    const [r] = await tx
      .select({ type: complianceItemType.name, property: property.name })
      .from(complianceItemType)
      .innerJoin(property, eq(property.id, item.propertyId))
      .where(eq(complianceItemType.id, item.typeId));
    return `${r?.type ?? "item"} on ${r?.property ?? "a property"}`;
  };

  /** Items of an archived type are hidden everywhere (§6.13), so they can't be changed either. */
  const typeArchived = async (tx: Tx, item: ItemRow) => {
    const [t] = await tx.select({ archivedAt: complianceItemType.archivedAt }).from(complianceItemType).where(eq(complianceItemType.id, item.typeId));
    return !t || t.archivedAt !== null;
  };

  app.patch("/api/compliance/items/:id", async (c) => {
    const parsed = await validateBody(c, updateComplianceItemSchema);
    if (!parsed.ok) return parsed.response;
    const id = c.req.param("id");
    if (!isUuid(id)) return itemNotFound(c);
    const { version, ...fields } = parsed.data;
    return db.transaction(async (tx) => {
      const [current] = await tx.select().from(propertyComplianceItem).where(eq(propertyComplianceItem.id, id)).for("update");
      if (!current || (await typeArchived(tx, current))) return itemNotFound(c);
      if (current.version !== version) return stale(c);
      const next: Partial<ItemRow> = {};
      if (fields.nextDueDate !== undefined) next.nextDueDate = fields.nextDueDate;
      if (fields.notes !== undefined) next.notes = fields.notes;
      if (fields.applicable !== undefined && fields.applicable !== current.applicable) {
        next.applicable = fields.applicable;
        // An editor's choice sticks (§6.14); a switched-on annual item gets its date if it has none.
        if (fields.nextDueDate === undefined && fields.applicable && current.nextDueDate === null) {
          const [type] = await tx.select().from(complianceItemType).where(eq(complianceItemType.id, current.typeId));
          if (type) next.nextDueDate = initialDueDate(type, todayNy());
        }
      }
      if (fields.applicable !== undefined) next.applicableSetByUser = true;
      const changed = (Object.keys(next) as (keyof ItemRow)[]).some((k) => next[k] !== current[k]);
      if (changed) {
        const [row] = await tx.update(propertyComplianceItem).set({ ...next, version: current.version + 1, updatedAt: new Date() }).where(eq(propertyComplianceItem.id, id)).returning();
        const updated = row as ItemRow;
        await writeAudit(tx, {
          actorUserId: actor(c),
          action: "update",
          entityType: "compliance_item",
          entityId: id,
          summary: `Updated compliance item ${await label(tx, updated)}`,
          changes: {
            ...diffChanges(current, updated, { applicable: "Applies to this property" }, (v) => (v ? "Yes" : "No")),
            ...diffChanges(current, updated, { nextDueDate: "Next due date", notes: "Notes" }),
          },
        });
      }
      return c.json(await itemView(tx, id));
    });
  });

  const completionRows = (tx: Tx, itemId: string) =>
    tx
      .select({ id: complianceCompletion.id, itemId: complianceCompletion.itemId, completedOn: complianceCompletion.completedOn, notes: complianceCompletion.notes, completedById: complianceCompletion.completedById, completedByName: user.name, createdAt: complianceCompletion.createdAt })
      .from(complianceCompletion)
      .leftJoin(user, eq(user.id, complianceCompletion.completedById))
      .where(eq(complianceCompletion.itemId, itemId))
      .orderBy(desc(complianceCompletion.completedOn), desc(complianceCompletion.createdAt));

  app.get("/api/compliance/items/:id/completions", async (c) => {
    const id = c.req.param("id");
    if (!isUuid(id)) return itemNotFound(c);
    const q = validate(c, listQuerySchema, Object.fromEntries(new URL(c.req.url).searchParams));
    if (!q.ok) return q.response;
    const { page, pageSize } = q.data;
    const [item] = await db.select({ id: propertyComplianceItem.id }).from(propertyComplianceItem).where(eq(propertyComplianceItem.id, id));
    if (!item) return itemNotFound(c);
    const all = await completionRows(db, id);
    return c.json({ data: all.slice((page - 1) * pageSize, page * pageSize), page, pageSize, total: all.length });
  });

  app.post("/api/compliance/items/:id/completions", async (c) => {
    const parsed = await validateBody(c, createComplianceCompletionSchema);
    if (!parsed.ok) return parsed.response;
    const id = c.req.param("id");
    if (!isUuid(id)) return itemNotFound(c);
    const { completedOn, notes, nextDueDate, version } = parsed.data;
    return db.transaction(async (tx) => {
      const [current] = await tx.select().from(propertyComplianceItem).where(eq(propertyComplianceItem.id, id)).for("update");
      if (!current || (await typeArchived(tx, current))) return itemNotFound(c);
      if (version !== undefined && current.version !== version) return stale(c);
      const [created] = await tx.insert(complianceCompletion).values({ itemId: id, completedOn, notes: notes ?? null, completedById: actor(c) }).returning();
      const due = nextDueDate === undefined ? current.nextDueDate : nextDueDate;
      await tx.update(propertyComplianceItem).set({ nextDueDate: due, version: current.version + 1, updatedAt: new Date() }).where(eq(propertyComplianceItem.id, id));
      await writeAudit(tx, {
        actorUserId: actor(c),
        action: "compliance_complete",
        entityType: "compliance_item",
        entityId: id,
        summary: `Marked ${await label(tx, current)} done on ${completedOn}`,
        changes: diffChanges(current, { ...current, nextDueDate: due }, { nextDueDate: "Next due date" }),
      });
      const [row] = (await completionRows(tx, id)).filter((r) => r.id === (created as { id: string }).id);
      return c.json(row, 201);
    });
  });

  app.delete("/api/compliance/completions/:id", async (c) => {
    const id = c.req.param("id");
    if (!isUuid(id)) return completionNotFound(c);
    return db.transaction(async (tx) => {
      const [current] = await tx.select().from(complianceCompletion).where(eq(complianceCompletion.id, id)).for("update");
      if (!current) return completionNotFound(c);
      const [item] = await tx.select().from(propertyComplianceItem).where(eq(propertyComplianceItem.id, current.itemId));
      await tx.delete(complianceCompletion).where(eq(complianceCompletion.id, id));
      await writeAudit(tx, {
        actorUserId: actor(c),
        action: "delete",
        entityType: "compliance_completion",
        entityId: id,
        summary: `Deleted the ${current.completedOn} completion of ${item ? await label(tx, item) : "a compliance item"}`,
      });
      return c.body(null, 204);
    });
  });
}
