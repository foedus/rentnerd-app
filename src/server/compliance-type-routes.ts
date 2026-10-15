import { asc, count, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Context, Hono } from "hono";
import type { Db } from "../db/client";
import { complianceCompletion, complianceItemType, property, propertyComplianceItem } from "../db/schema";
import { COMPLIANCE_SCHEDULE_LABELS } from "../shared/compliance-rules";
import { complianceTypeListQuerySchema, createComplianceTypeSchema, normalizeSchedule, scheduleProblems, updateComplianceTypeSchema } from "../shared/compliance-schemas";
import { diffChanges, writeAudit } from "./audit";
import { apiError } from "./api-guard";
import { syncPropertyCompliance, syncTypeOnAllProperties } from "./compliance-items";
import { validate, validateBody } from "./validation";

type TypeRow = typeof complianceItemType.$inferSelect;
type Tx = Pick<Db, "select" | "insert" | "update" | "delete">;

const DUPLICATE_NAME = "An item type with this name already exists.";
const isUuid = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
const isUniqueViolation = (e: unknown) => (e as { code?: string; cause?: { code?: string } })?.code === "23505" || (e as { cause?: { code?: string } })?.cause?.code === "23505";

const notFound = (c: Context) => apiError(c, "NOT_FOUND", "Item type not found.");
const stale = (c: Context) => apiError(c, "CONFLICT", "This item type was changed by someone else. Reload and try again.");
const duplicateName = (c: Context) => apiError(c, "CONFLICT", DUPLICATE_NAME, { name: DUPLICATE_NAME });

const SCHEDULE_LABELS = COMPLIANCE_SCHEDULE_LABELS;
const FIELD_LABELS = { name: "Name", description: "Description", appliesTo: "Applies to", nycOnly: "New York City properties only", dueMonth: "Month", dueDay: "Day", intervalMonths: "Repeat every (months)" };
const changesOf = (before: TypeRow, after: TypeRow) => ({
  ...diffChanges(before, after, FIELD_LABELS, (v) => (typeof v === "boolean" ? (v ? "Yes" : "No") : String(v))),
  ...diffChanges(before, after, { scheduleType: "Schedule" }, (v) => SCHEDULE_LABELS[v as TypeRow["scheduleType"]]),
});

/** Compliance item types (§6.13, §14.2): list, create, edit, archive, restore, delete. Items follow the type onto every property (§6.14). */
export function mountComplianceTypeRoutes(app: Hono, db: Db) {
  const actor = (c: Context) => c.get("user").id;

  const withUsage = async (tx: Tx, rows: TypeRow[]) => {
    const used = new Set<string>();
    if (rows.length > 0) {
      const found = await tx
        .select({ typeId: propertyComplianceItem.typeId })
        .from(complianceCompletion)
        .innerJoin(propertyComplianceItem, eq(propertyComplianceItem.id, complianceCompletion.itemId))
        .where(inArray(propertyComplianceItem.typeId, rows.map((r) => r.id)))
        .groupBy(propertyComplianceItem.typeId);
      for (const f of found) used.add(f.typeId);
    }
    return rows.map((r) => ({ ...r, hasCompletions: used.has(r.id) }));
  };

  /** Applicability of existing items can change with the rules or when a type returns from the archive. */
  const resyncAllProperties = async (tx: Tx) => {
    for (const { id } of await tx.select({ id: property.id }).from(property)) await syncPropertyCompliance(tx, id);
  };

  app.get("/api/compliance/types", async (c) => {
    const q = validate(c, complianceTypeListQuerySchema, Object.fromEntries(new URL(c.req.url).searchParams));
    if (!q.ok) return q.response;
    const { page, pageSize, archived } = q.data;
    const where = archived === "true" ? undefined : isNull(complianceItemType.archivedAt);
    const [{ total = 0 } = {}] = await db.select({ total: count() }).from(complianceItemType).where(where);
    const rows = await db.select().from(complianceItemType).where(where).orderBy(asc(sql`lower(${complianceItemType.name})`)).limit(pageSize).offset((page - 1) * pageSize);
    return c.json({ data: await withUsage(db, rows), page, pageSize, total });
  });

  app.post("/api/compliance/types", async (c) => {
    const parsed = await validateBody(c, createComplianceTypeSchema);
    if (!parsed.ok) return parsed.response;
    const values = normalizeSchedule(parsed.data);
    try {
      const created = await db.transaction(async (tx) => {
        const [row] = await tx.insert(complianceItemType).values({ ...values, createdById: actor(c), updatedById: actor(c) }).returning();
        const type = row as TypeRow;
        await syncTypeOnAllProperties(tx, type.id);
        await writeAudit(tx, { actorUserId: actor(c), action: "create", entityType: "compliance_item_type", entityId: type.id, summary: `Added compliance item type ${type.name}` });
        return type;
      });
      return c.json({ ...created, hasCompletions: false }, 201);
    } catch (e) {
      if (isUniqueViolation(e)) return duplicateName(c);
      throw e;
    }
  });

  app.patch("/api/compliance/types/:id", async (c) => {
    const parsed = await validateBody(c, updateComplianceTypeSchema);
    if (!parsed.ok) return parsed.response;
    const id = c.req.param("id");
    if (!isUuid(id)) return notFound(c);
    const { version, ...fields } = parsed.data;
    try {
      const result = await db.transaction(async (tx) => {
        const [current] = await tx.select().from(complianceItemType).where(eq(complianceItemType.id, id)).for("update");
        if (!current) return notFound(c);
        if (current.version !== version) return stale(c);
        const merged = normalizeSchedule({ ...current, ...fields });
        const problems = scheduleProblems(merged);
        if (Object.keys(problems).length > 0) return apiError(c, "VALIDATION_ERROR", "Please check the highlighted fields.", problems);
        const next = { ...fields, scheduleType: merged.scheduleType, dueMonth: merged.dueMonth, dueDay: merged.dueDay, intervalMonths: merged.intervalMonths };
        const unchanged = (Object.keys(next) as (keyof typeof next)[]).every((k) => next[k] === current[k]);
        if (unchanged) return (await withUsage(tx, [current]))[0];
        const [row] = await tx.update(complianceItemType).set({ ...next, version: current.version + 1, updatedById: actor(c), updatedAt: new Date() }).where(eq(complianceItemType.id, id)).returning();
        const updated = row as TypeRow;
        if (updated.appliesTo !== current.appliesTo || updated.nycOnly !== current.nycOnly) await resyncAllProperties(tx);
        await writeAudit(tx, { actorUserId: actor(c), action: "update", entityType: "compliance_item_type", entityId: id, summary: `Updated compliance item type ${updated.name}`, changes: changesOf(current, updated) });
        return (await withUsage(tx, [updated]))[0];
      });
      return result instanceof Response ? result : c.json(result);
    } catch (e) {
      if (isUniqueViolation(e)) return duplicateName(c);
      throw e;
    }
  });

  const setArchived = (archive: boolean) => async (c: Context) => {
    const id = c.req.param("id") ?? "";
    if (!isUuid(id)) return notFound(c);
    return db.transaction(async (tx) => {
      const [current] = await tx.select().from(complianceItemType).where(eq(complianceItemType.id, id)).for("update");
      if (!current) return notFound(c);
      const expected = (await c.req.json().catch(() => ({})) as { version?: unknown }).version;
      if (expected !== undefined && expected !== current.version) return stale(c);
      if (archive && current.archivedAt) return apiError(c, "CONFLICT", "This item type is already archived.");
      if (!archive && !current.archivedAt) return apiError(c, "CONFLICT", "This item type isn't archived.");
      const [row] = await tx
        .update(complianceItemType)
        .set({ archivedAt: archive ? new Date() : null, version: current.version + 1, updatedById: actor(c), updatedAt: new Date() })
        .where(eq(complianceItemType.id, id))
        .returning();
      if (!archive) await resyncAllProperties(tx);
      await writeAudit(tx, { actorUserId: actor(c), action: archive ? "archive" : "restore", entityType: "compliance_item_type", entityId: id, summary: `${archive ? "Archived" : "Restored"} compliance item type ${current.name}` });
      return c.json((await withUsage(tx, [row as TypeRow]))[0]);
    });
  };
  app.post("/api/compliance/types/:id/archive", setArchived(true));
  app.post("/api/compliance/types/:id/restore", setArchived(false));

  app.delete("/api/compliance/types/:id", async (c) => {
    const id = c.req.param("id");
    if (!isUuid(id)) return notFound(c);
    return db.transaction(async (tx) => {
      const [current] = await tx.select().from(complianceItemType).where(eq(complianceItemType.id, id)).for("update");
      if (!current) return notFound(c);
      // Lock the items so a completion can't be added between the check and the delete.
      await tx.select({ id: propertyComplianceItem.id }).from(propertyComplianceItem).where(eq(propertyComplianceItem.typeId, id)).for("update");
      if ((await withUsage(tx, [current]))[0]?.hasCompletions) {
        return apiError(c, "CONFLICT", "This item type has completions, so it can't be deleted. Archive it instead.");
      }
      await tx.delete(propertyComplianceItem).where(eq(propertyComplianceItem.typeId, id));
      await tx.delete(complianceItemType).where(eq(complianceItemType.id, id));
      await writeAudit(tx, { actorUserId: actor(c), action: "delete", entityType: "compliance_item_type", entityId: id, summary: `Deleted compliance item type ${current.name}` });
      return c.body(null, 204);
    });
  });
}
