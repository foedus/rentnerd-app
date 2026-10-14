import { count, desc, eq } from "drizzle-orm";
import type { Context, Hono } from "hono";
import type { Db } from "../db/client";
import { property, propertyTax } from "../db/schema";
import { formatCents } from "../shared/format";
import { createPropertyTaxSchema, listQuerySchema, updatePropertyTaxSchema } from "../shared/schemas";
import { diffChanges, writeAudit } from "./audit";
import { apiError } from "./api-guard";
import { validate, validateBody } from "./validation";

export type PropertyTaxRow = typeof propertyTax.$inferSelect;

const DUPLICATE_YEAR = "This tax year already exists for this property.";
const isUuid = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
const isUniqueViolation = (e: unknown) => (e as { code?: string; cause?: { code?: string } })?.code === "23505" || (e as { cause?: { code?: string } })?.cause?.code === "23505";

const propertyNotFound = (c: Context) => apiError(c, "NOT_FOUND", "Property not found.");
const taxNotFound = (c: Context) => apiError(c, "NOT_FOUND", "Tax year not found.");
const stale = (c: Context) => apiError(c, "CONFLICT", "This tax year was changed by someone else. Reload and try again.");
const duplicateYear = (c: Context) => apiError(c, "CONFLICT", DUPLICATE_YEAR, { taxYear: DUPLICATE_YEAR });

const describe = (t: Pick<PropertyTaxRow, "taxYear" | "amountCents">) => `${t.taxYear} property tax of ${formatCents(t.amountCents)}`;
const changesOf = (before: PropertyTaxRow, after: PropertyTaxRow) => ({
  ...diffChanges(before, after, { taxYear: "Tax year" }),
  ...diffChanges(before, after, { amountCents: "Annual property tax" }, (v) => formatCents(Number(v))),
});

/** Property tax years (§6.6, §14.2): list and add under a property, edit and hard-delete by id. */
export function mountPropertyTaxRoutes(app: Hono, db: Db) {
  const actor = (c: Context) => c.get("user").id;

  app.get("/api/properties/:id/taxes", async (c) => {
    const propertyId = c.req.param("id");
    if (!isUuid(propertyId)) return propertyNotFound(c);
    const q = validate(c, listQuerySchema, Object.fromEntries(new URL(c.req.url).searchParams));
    if (!q.ok) return q.response;
    const { page, pageSize } = q.data;
    const [p] = await db.select({ id: property.id }).from(property).where(eq(property.id, propertyId));
    if (!p) return propertyNotFound(c);
    const where = eq(propertyTax.propertyId, propertyId);
    const [{ total = 0 } = {}] = await db.select({ total: count() }).from(propertyTax).where(where);
    const data = await db.select().from(propertyTax).where(where).orderBy(desc(propertyTax.taxYear)).limit(pageSize).offset((page - 1) * pageSize);
    return c.json({ data, page, pageSize, total });
  });

  app.post("/api/properties/:id/taxes", async (c) => {
    const propertyId = c.req.param("id");
    if (!isUuid(propertyId)) return propertyNotFound(c);
    const parsed = await validateBody(c, createPropertyTaxSchema);
    if (!parsed.ok) return parsed.response;
    try {
      const result = await db.transaction(async (tx) => {
        const [p] = await tx.select({ name: property.name, archivedAt: property.archivedAt }).from(property).where(eq(property.id, propertyId)).for("update");
        if (!p) return propertyNotFound(c);
        if (p.archivedAt) return apiError(c, "CONFLICT", "This property is archived. Restore it before adding tax years.");
        const [row] = await tx.insert(propertyTax).values({ ...parsed.data, propertyId, createdById: actor(c), updatedById: actor(c) }).returning();
        const created = row as PropertyTaxRow;
        await writeAudit(tx, { actorUserId: actor(c), action: "create", entityType: "property_tax", entityId: created.id, summary: `Added ${describe(created)} to ${p.name}` });
        return created;
      });
      return result instanceof Response ? result : c.json(result, 201);
    } catch (e) {
      if (isUniqueViolation(e)) return duplicateYear(c);
      throw e;
    }
  });

  app.patch("/api/property-taxes/:id", async (c) => {
    const parsed = await validateBody(c, updatePropertyTaxSchema);
    if (!parsed.ok) return parsed.response;
    const id = c.req.param("id");
    if (!isUuid(id)) return taxNotFound(c);
    const { version, ...fields } = parsed.data;
    try {
      const result = await db.transaction(async (tx) => {
        const [current] = await tx.select().from(propertyTax).where(eq(propertyTax.id, id)).for("update");
        if (!current) return taxNotFound(c);
        if (current.version !== version) return stale(c);
        const unchanged = (Object.keys(fields) as (keyof typeof fields)[]).every((k) => fields[k] === current[k]);
        if (unchanged) return current;
        const [row] = await tx.update(propertyTax).set({ ...fields, version: current.version + 1, updatedById: actor(c), updatedAt: new Date() }).where(eq(propertyTax.id, id)).returning();
        const updated = row as PropertyTaxRow;
        const [p] = await tx.select({ name: property.name }).from(property).where(eq(property.id, updated.propertyId));
        await writeAudit(tx, { actorUserId: actor(c), action: "update", entityType: "property_tax", entityId: id, summary: `Updated ${describe(updated)} on ${p?.name ?? "a property"}`, changes: changesOf(current, updated) });
        return updated;
      });
      return result instanceof Response ? result : c.json(result);
    } catch (e) {
      if (isUniqueViolation(e)) return duplicateYear(c);
      throw e;
    }
  });

  app.delete("/api/property-taxes/:id", async (c) => {
    const id = c.req.param("id");
    if (!isUuid(id)) return taxNotFound(c);
    // Refusing a tax year that is a lease's base tax year (§6.6) arrives with the lease tables.
    return db.transaction(async (tx) => {
      const [current] = await tx.select().from(propertyTax).where(eq(propertyTax.id, id)).for("update");
      if (!current) return taxNotFound(c);
      const [p] = await tx.select({ name: property.name }).from(property).where(eq(property.id, current.propertyId));
      await tx.delete(propertyTax).where(eq(propertyTax.id, id));
      await writeAudit(tx, { actorUserId: actor(c), action: "delete", entityType: "property_tax", entityId: id, summary: `Deleted ${describe(current)} from ${p?.name ?? "a property"}` });
      return c.body(null, 204);
    });
  });
}
