import { and, asc, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Context, Hono } from "hono";
import type { Db } from "../db/client";
import { owner, property, unit } from "../db/schema";
import { createUnitSchema, unitListQuerySchema, updateUnitSchema } from "../shared/schemas";
import { todayNy } from "../shared/dates";
import { syncPropertyCompliance } from "./compliance-items";
import { unitLeaseInfo } from "./unit-lease-info";
import { diffChanges, writeAudit } from "./audit";
import { apiError } from "./api-guard";
import { validate, validateBody } from "./validation";

type Tx = Pick<Db, "select" | "insert" | "update" | "delete">;
export type UnitRow = typeof unit.$inferSelect;

const LABELS = {
  label: "Unit label", bedrooms: "Bedrooms", bathrooms: "Bathrooms", squareFeet: "Square feet", notes: "Notes",
} as const;

const SORT = { label: unit.label, use: unit.use, createdAt: unit.createdAt } as const;
const isUuid = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
const DUPLICATE_LABEL = "A unit with this label already exists in this property.";
const USE_LOCKED = "Use can't be changed. To change it, archive this unit and add a new one.";

const unitNotFound = (c: Context) => apiError(c, "NOT_FOUND", "Unit not found.");
const propertyNotFound = (c: Context) => apiError(c, "NOT_FOUND", "Property not found.");
const stale = (c: Context) => apiError(c, "CONFLICT", "This unit was changed by someone else. Reload and try again.");
const duplicateLabel = (c: Context) => apiError(c, "CONFLICT", DUPLICATE_LABEL, { label: DUPLICATE_LABEL });
const isUniqueViolation = (e: unknown) => (e as { code?: string; cause?: { code?: string } })?.code === "23505" || (e as { cause?: { code?: string } })?.cause?.code === "23505";

/** Units (§6.7, §14.2): list and create under a property, read and edit. Archive, restore and delete come with later tasks. */
export function mountUnitRoutes(app: Hono, db: Db) {
  const actor = (c: Context) => c.get("user").id;

  /** Unit plus the owner who counts for it: the override if set, else the property's owner. */
  const present = async (tx: Tx, rows: UnitRow[]) => {
    const props = rows.length === 0 ? [] : await tx.select({ id: property.id, name: property.name, ownerId: property.ownerId }).from(property).where(inArray(property.id, [...new Set(rows.map((r) => r.propertyId))]));
    const propertyById = new Map(props.map((p) => [p.id, p]));
    const ownerIds = [...new Set(rows.map((r) => r.ownerOverrideId ?? propertyById.get(r.propertyId)?.ownerId).filter((id): id is string => Boolean(id)))];
    const owners = ownerIds.length === 0 ? [] : await tx.select({ id: owner.id, name: owner.name }).from(owner).where(inArray(owner.id, ownerIds));
    const ownerById = new Map(owners.map((o) => [o.id, o]));
    const info = await unitLeaseInfo(tx, rows.map((r) => r.id), todayNy());
    return rows.map((r) => {
      const p = propertyById.get(r.propertyId);
      const effectiveOwnerId = r.ownerOverrideId ?? p?.ownerId ?? null;
      return {
        ...r,
        lease: info.get(r.id),
        bathrooms: r.bathrooms === null ? null : Number(r.bathrooms),
        property: p ? { id: p.id, name: p.name } : null,
        owner: effectiveOwnerId ? (ownerById.get(effectiveOwnerId) ?? null) : null,
      };
    });
  };

  const checkOverride = async (tx: Tx, ownerId: string | null | undefined): Promise<Record<string, string>> => {
    if (!ownerId) return {};
    const [o] = await tx.select({ archivedAt: owner.archivedAt }).from(owner).where(eq(owner.id, ownerId));
    if (!o) return { ownerOverrideId: "Choose an owner." };
    return o.archivedAt ? { ownerOverrideId: "Choose an owner that isn't archived." } : {};
  };

  const labelTaken = async (tx: Tx, propertyId: string, label: string, exceptId?: string) => {
    const [row] = await tx
      .select({ id: unit.id })
      .from(unit)
      .where(and(eq(unit.propertyId, propertyId), isNull(unit.archivedAt), sql`lower(${unit.label}) = lower(${label})`, exceptId ? sql`${unit.id} <> ${exceptId}` : undefined))
      .limit(1);
    return Boolean(row);
  };

  app.get("/api/properties/:id/units", async (c) => {
    const propertyId = c.req.param("id");
    if (!isUuid(propertyId)) return propertyNotFound(c);
    const q = validate(c, unitListQuerySchema, Object.fromEntries(new URL(c.req.url).searchParams));
    if (!q.ok) return q.response;
    const { page, pageSize, sort, order, archived } = q.data;
    const [p] = await db.select({ id: property.id }).from(property).where(eq(property.id, propertyId));
    if (!p) return propertyNotFound(c);
    const where = and(eq(unit.propertyId, propertyId), archived === "true" ? undefined : isNull(unit.archivedAt));
    const [{ total = 0 } = {}] = await db.select({ total: count() }).from(unit).where(where);
    const dir = order === "desc" ? desc : asc;
    const rows = await db.select().from(unit).where(where).orderBy(dir(SORT[sort]), asc(unit.id)).limit(pageSize).offset((page - 1) * pageSize);
    return c.json({ data: await present(db, rows), page, pageSize, total });
  });

  app.post("/api/properties/:id/units", async (c) => {
    const propertyId = c.req.param("id");
    if (!isUuid(propertyId)) return propertyNotFound(c);
    const parsed = await validateBody(c, createUnitSchema);
    if (!parsed.ok) return parsed.response;
    const { bathrooms, ...fields } = parsed.data;
    try {
      const result = await db.transaction(async (tx) => {
        const [p] = await tx.select({ id: property.id, archivedAt: property.archivedAt }).from(property).where(eq(property.id, propertyId)).for("update");
        if (!p) return propertyNotFound(c);
        if (p.archivedAt) return apiError(c, "CONFLICT", "This property is archived. Restore it before adding units.");
        const bad = await checkOverride(tx, fields.ownerOverrideId);
        if (Object.keys(bad).length > 0) return apiError(c, "VALIDATION_ERROR", "Please check the highlighted fields.", bad);
        if (await labelTaken(tx, propertyId, fields.label)) return duplicateLabel(c);
        const [row] = await tx
          .insert(unit)
          .values({ ...fields, bathrooms: bathrooms == null ? null : bathrooms.toFixed(1), propertyId, createdById: actor(c), updatedById: actor(c) })
          .returning();
        const created = row as UnitRow;
        await writeAudit(tx, { actorUserId: actor(c), action: "create", entityType: "unit", entityId: created.id, summary: `Created unit ${created.label} (${created.use})` });
        await syncPropertyCompliance(tx, propertyId);
        return (await present(tx, [created]))[0];
      });
      return result instanceof Response ? result : c.json(result, 201);
    } catch (e) {
      if (isUniqueViolation(e)) return duplicateLabel(c);
      throw e;
    }
  });

  app.get("/api/units/:id", async (c) => {
    const id = c.req.param("id");
    if (!isUuid(id)) return unitNotFound(c);
    const [row] = await db.select().from(unit).where(eq(unit.id, id));
    if (!row) return unitNotFound(c);
    return c.json((await present(db, [row]))[0]);
  });

  app.patch("/api/units/:id", async (c) => {
    const parsed = await validateBody(c, updateUnitSchema);
    if (!parsed.ok) return parsed.response;
    const id = c.req.param("id");
    if (!isUuid(id)) return unitNotFound(c);
    const { version, use, bathrooms, ...fields } = parsed.data;
    try {
      const result = await db.transaction(async (tx) => {
        const [current] = await tx.select().from(unit).where(eq(unit.id, id)).for("update");
        if (!current) return unitNotFound(c);
        if (use !== undefined && use !== current.use) return apiError(c, "VALIDATION_ERROR", USE_LOCKED, { use: USE_LOCKED });
        if (current.version !== version) return stale(c);
        const bad = await checkOverride(tx, fields.ownerOverrideId && fields.ownerOverrideId !== current.ownerOverrideId ? fields.ownerOverrideId : null);
        if (Object.keys(bad).length > 0) return apiError(c, "VALIDATION_ERROR", "Please check the highlighted fields.", bad);
        if (fields.label && !current.archivedAt && (await labelTaken(tx, current.propertyId, fields.label, id))) return duplicateLabel(c);
        const [row] = await tx
          .update(unit)
          .set({ ...fields, ...(bathrooms === undefined ? {} : { bathrooms: bathrooms === null ? null : bathrooms.toFixed(1) }), version: sql`${unit.version} + 1`, updatedById: actor(c), updatedAt: new Date() })
          .where(eq(unit.id, id))
          .returning();
        const updated = row as UnitRow;
        const changes = diffChanges(current, updated, LABELS, (v) => String(v));
        if (current.ownerOverrideId !== updated.ownerOverrideId) {
          const names = new Map((await tx.select({ id: owner.id, name: owner.name }).from(owner)).map((o) => [o.id, o.name]));
          changes["Owner (if different from property)"] = [current.ownerOverrideId ? (names.get(current.ownerOverrideId) ?? null) : null, updated.ownerOverrideId ? (names.get(updated.ownerOverrideId) ?? null) : null];
        }
        await writeAudit(tx, { actorUserId: actor(c), action: "update", entityType: "unit", entityId: id, summary: `Updated unit ${updated.label}`, changes });
        return (await present(tx, [updated]))[0];
      });
      return result instanceof Response ? result : c.json(result);
    } catch (e) {
      if (isUniqueViolation(e)) return duplicateLabel(c);
      throw e;
    }
  });
}
