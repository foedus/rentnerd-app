import { count, desc, eq } from "drizzle-orm";
import type { Context, Hono } from "hono";
import type { Db } from "../db/client";
import { property, propertyValue } from "../db/schema";
import { formatCents, formatDate } from "../shared/format";
import { createPropertyValueSchema, listQuerySchema, updatePropertyValueSchema, VALUE_KIND_LABELS } from "../shared/schemas";
import { diffChanges, writeAudit } from "./audit";
import { apiError } from "./api-guard";
import { validate, validateBody } from "./validation";

export type PropertyValueRow = typeof propertyValue.$inferSelect;

const LABELS = { valueDate: "Date", kind: "Value type", amountCents: "Amount", source: "Source / notes" } as const;
const isUuid = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

const propertyNotFound = (c: Context) => apiError(c, "NOT_FOUND", "Property not found.");
const valueNotFound = (c: Context) => apiError(c, "NOT_FOUND", "Value not found.");
const stale = (c: Context) => apiError(c, "CONFLICT", "This value was changed by someone else. Reload and try again.");

const describe = (v: Pick<PropertyValueRow, "kind" | "amountCents" | "valueDate">) => `${VALUE_KIND_LABELS[v.kind]} ${formatCents(v.amountCents)} dated ${formatDate(v.valueDate)}`;
const formatField = (v: unknown) => (typeof v === "number" ? formatCents(v) : typeof v === "string" && v in VALUE_KIND_LABELS ? VALUE_KIND_LABELS[v as keyof typeof VALUE_KIND_LABELS] : String(v));

/** Property value history (§6.5, §14.2): list and add under a property, edit and hard-delete by id. */
export function mountPropertyValueRoutes(app: Hono, db: Db) {
  const actor = (c: Context) => c.get("user").id;

  app.get("/api/properties/:id/values", async (c) => {
    const propertyId = c.req.param("id");
    if (!isUuid(propertyId)) return propertyNotFound(c);
    const q = validate(c, listQuerySchema, Object.fromEntries(new URL(c.req.url).searchParams));
    if (!q.ok) return q.response;
    const { page, pageSize } = q.data;
    const [p] = await db.select({ id: property.id }).from(property).where(eq(property.id, propertyId));
    if (!p) return propertyNotFound(c);
    const where = eq(propertyValue.propertyId, propertyId);
    const [{ total = 0 } = {}] = await db.select({ total: count() }).from(propertyValue).where(where);
    const data = await db.select().from(propertyValue).where(where).orderBy(desc(propertyValue.valueDate), desc(propertyValue.createdAt), desc(propertyValue.id)).limit(pageSize).offset((page - 1) * pageSize);
    return c.json({ data, page, pageSize, total });
  });

  app.post("/api/properties/:id/values", async (c) => {
    const propertyId = c.req.param("id");
    if (!isUuid(propertyId)) return propertyNotFound(c);
    const parsed = await validateBody(c, createPropertyValueSchema);
    if (!parsed.ok) return parsed.response;
    const result = await db.transaction(async (tx) => {
      const [p] = await tx.select({ name: property.name, archivedAt: property.archivedAt }).from(property).where(eq(property.id, propertyId)).for("update");
      if (!p) return propertyNotFound(c);
      if (p.archivedAt) return apiError(c, "CONFLICT", "This property is archived. Restore it before adding values.");
      const [row] = await tx.insert(propertyValue).values({ ...parsed.data, propertyId, createdById: actor(c), updatedById: actor(c) }).returning();
      const created = row as PropertyValueRow;
      await writeAudit(tx, { actorUserId: actor(c), action: "create", entityType: "property_value", entityId: created.id, summary: `Added ${describe(created)} to ${p.name}` });
      return created;
    });
    return result instanceof Response ? result : c.json(result, 201);
  });

  app.patch("/api/property-values/:id", async (c) => {
    const parsed = await validateBody(c, updatePropertyValueSchema);
    if (!parsed.ok) return parsed.response;
    const id = c.req.param("id");
    if (!isUuid(id)) return valueNotFound(c);
    const { version, ...fields } = parsed.data;
    const result = await db.transaction(async (tx) => {
      const [current] = await tx.select().from(propertyValue).where(eq(propertyValue.id, id)).for("update");
      if (!current) return valueNotFound(c);
      if (current.version !== version) return stale(c);
      const unchanged = (Object.keys(fields) as (keyof typeof fields)[]).every((k) => (fields[k] ?? null) === current[k]);
      if (unchanged) return current;
      const [row] = await tx.update(propertyValue).set({ ...fields, version: current.version + 1, updatedById: actor(c), updatedAt: new Date() }).where(eq(propertyValue.id, id)).returning();
      const updated = row as PropertyValueRow;
      const [p] = await tx.select({ name: property.name }).from(property).where(eq(property.id, updated.propertyId));
      await writeAudit(tx, { actorUserId: actor(c), action: "update", entityType: "property_value", entityId: id, summary: `Updated ${describe(updated)} on ${p?.name ?? "a property"}`, changes: diffChanges(current, updated, LABELS, formatField) });
      return updated;
    });
    return result instanceof Response ? result : c.json(result);
  });

  app.delete("/api/property-values/:id", async (c) => {
    const id = c.req.param("id");
    if (!isUuid(id)) return valueNotFound(c);
    return db.transaction(async (tx) => {
      const [current] = await tx.select().from(propertyValue).where(eq(propertyValue.id, id)).for("update");
      if (!current) return valueNotFound(c);
      const [p] = await tx.select({ name: property.name }).from(property).where(eq(property.id, current.propertyId));
      await tx.delete(propertyValue).where(eq(propertyValue.id, id));
      await writeAudit(tx, { actorUserId: actor(c), action: "delete", entityType: "property_value", entityId: id, summary: `Deleted ${describe(current)} from ${p?.name ?? "a property"}` });
      return c.body(null, 204);
    });
  });
}
