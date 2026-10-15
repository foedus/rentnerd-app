import { and, count, desc, eq, gte, lte, sql } from "drizzle-orm";
import type { Context, Hono } from "hono";
import type { Db } from "../db/client";
import { investmentEntry, property, unit } from "../db/schema";
import { formatCents, formatDate } from "../shared/format";
import { createInvestmentSchema, investmentListQuerySchema, updateInvestmentSchema } from "../shared/schemas";
import { apiError } from "./api-guard";
import { diffChanges, writeAudit } from "./audit";
import { validate, validateBody } from "./validation";

export type InvestmentRow = typeof investmentEntry.$inferSelect;

const LABELS = { entryDate: "Date", propertyId: "Property", unitId: "Unit", category: "Category", description: "Description", vendor: "Vendor", costCents: "Cost" } as const;
const isUuid = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

const notFound = (c: Context) => apiError(c, "NOT_FOUND", "Entry not found.");
const stale = (c: Context) => apiError(c, "CONFLICT", "This entry was changed by someone else. Reload and try again.");
const describe = (e: Pick<InvestmentRow, "category" | "description" | "costCents" | "entryDate">) => `${e.category} “${e.description}” ${formatCents(e.costCents)} dated ${formatDate(e.entryDate)}`;
const formatField = (v: unknown) => (typeof v === "number" ? formatCents(v) : String(v));

/** Investment log (§6.15, §14.2): list with filters and a filter-wide total, create, edit, hard-delete. */
export function mountInvestmentRoutes(app: Hono, db: Db) {
  const actor = (c: Context) => c.get("user").id;

  /** Property and unit names for audit text; the unit must belong to the property and neither may be archived (unless `allowArchived`). */
  async function checkTarget(tx: Pick<Db, "select">, c: Context, propertyId: string, unitId: string | null, allowArchived = false) {
    const [p] = await tx.select({ name: property.name, archivedAt: property.archivedAt }).from(property).where(eq(property.id, propertyId));
    if (!p) return { error: apiError(c, "VALIDATION_ERROR", "Please check the highlighted fields.", { propertyId: "Choose a property." }) };
    if (p.archivedAt && !allowArchived) return { error: apiError(c, "CONFLICT", "This property is archived. Restore it before adding entries.") };
    let unitLabel: string | null = null;
    if (unitId) {
      const [u] = await tx.select({ label: unit.label, propertyId: unit.propertyId, archivedAt: unit.archivedAt }).from(unit).where(eq(unit.id, unitId));
      if (!u || u.propertyId !== propertyId || (u.archivedAt && !allowArchived)) return { error: apiError(c, "VALIDATION_ERROR", "Please check the highlighted fields.", { unitId: "Choose a unit of this property." }) };
      unitLabel = u.label;
    }
    return { propertyName: p.name, unitLabel };
  }

  app.get("/api/investments", async (c) => {
    const q = validate(c, investmentListQuerySchema, Object.fromEntries(new URL(c.req.url).searchParams));
    if (!q.ok) return q.response;
    const { page, pageSize, propertyId, category, from, to } = q.data;
    const where = and(
      propertyId ? eq(investmentEntry.propertyId, propertyId) : undefined,
      category ? eq(investmentEntry.category, category) : undefined,
      from ? gte(investmentEntry.entryDate, from) : undefined,
      to ? lte(investmentEntry.entryDate, to) : undefined,
    );
    const [{ total = 0, totalCents = 0 } = {}] = await db.select({ total: count(), totalCents: sql<number>`coalesce(sum(${investmentEntry.costCents}), 0)::float8` }).from(investmentEntry).where(where);
    const data = await db.select().from(investmentEntry).where(where)
      .orderBy(desc(investmentEntry.entryDate), desc(investmentEntry.createdAt), desc(investmentEntry.id)).limit(pageSize).offset((page - 1) * pageSize);
    return c.json({ data, page, pageSize, total, totalCents });
  });

  app.post("/api/investments", async (c) => {
    const parsed = await validateBody(c, createInvestmentSchema);
    if (!parsed.ok) return parsed.response;
    const input = { ...parsed.data, unitId: parsed.data.unitId ?? null };
    const result = await db.transaction(async (tx) => {
      await tx.select({ id: property.id }).from(property).where(eq(property.id, input.propertyId)).for("update");
      const target = await checkTarget(tx, c, input.propertyId, input.unitId);
      if ("error" in target) return target.error;
      const [row] = await tx.insert(investmentEntry).values({ ...input, createdById: actor(c), updatedById: actor(c) }).returning();
      const created = row as InvestmentRow;
      await writeAudit(tx, { actorUserId: actor(c), action: "create", entityType: "investment_entry", entityId: created.id, summary: `Added ${describe(created)} to ${target.propertyName}${target.unitLabel ? ` unit ${target.unitLabel}` : ""}` });
      return created;
    });
    return result instanceof Response ? result : c.json(result, 201);
  });

  app.patch("/api/investments/:id", async (c) => {
    const parsed = await validateBody(c, updateInvestmentSchema);
    if (!parsed.ok) return parsed.response;
    const id = c.req.param("id");
    if (!isUuid(id)) return notFound(c);
    const { version, ...fields } = parsed.data;
    const result = await db.transaction(async (tx) => {
      const [current] = await tx.select().from(investmentEntry).where(eq(investmentEntry.id, id)).for("update");
      if (!current) return notFound(c);
      if (current.version !== version) return stale(c);
      const next = { ...fields, unitId: fields.unitId === undefined ? undefined : fields.unitId };
      const unchanged = (Object.keys(next) as (keyof typeof next)[]).every((k) => next[k] === undefined || (next[k] ?? null) === current[k]);
      if (unchanged) return current;
      // Moving to another property without naming a unit drops the old unit (it can't belong to the new property).
      const propertyId = next.propertyId ?? current.propertyId;
      const unitId = next.unitId !== undefined ? next.unitId : propertyId === current.propertyId ? current.unitId : null;
      // Entries on an archived property or unit stay editable; only a new target must be active.
      const target = await checkTarget(tx, c, propertyId, unitId, propertyId === current.propertyId && unitId === current.unitId);
      if ("error" in target) return target.error;
      const [row] = await tx.update(investmentEntry).set({ ...next, propertyId, unitId, version: current.version + 1, updatedById: actor(c), updatedAt: new Date() }).where(eq(investmentEntry.id, id)).returning();
      const updated = row as InvestmentRow;
      const changes = diffChanges(current, updated, LABELS, formatField);
      await writeAudit(tx, { actorUserId: actor(c), action: "update", entityType: "investment_entry", entityId: id, summary: `Updated ${describe(updated)} on ${target.propertyName}`, changes });
      return updated;
    });
    return result instanceof Response ? result : c.json(result);
  });

  app.delete("/api/investments/:id", async (c) => {
    const id = c.req.param("id");
    if (!isUuid(id)) return notFound(c);
    return db.transaction(async (tx) => {
      const [current] = await tx.select().from(investmentEntry).where(eq(investmentEntry.id, id)).for("update");
      if (!current) return notFound(c);
      const [p] = await tx.select({ name: property.name }).from(property).where(eq(property.id, current.propertyId));
      await tx.delete(investmentEntry).where(eq(investmentEntry.id, id));
      await writeAudit(tx, { actorUserId: actor(c), action: "delete", entityType: "investment_entry", entityId: id, summary: `Deleted ${describe(current)} from ${p?.name ?? "a property"}` });
      return c.body(null, 204);
    });
  });
}
