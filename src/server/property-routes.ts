import { and, asc, count, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import type { Context, Hono } from "hono";
import type { Db } from "../db/client";
import { owner, property, propertyResponsible, unit, user } from "../db/schema";
import { createPropertyWithUnitSchema, propertyListQuerySchema, propertyType, updatePropertySchema } from "../shared/schemas";
import { formatCents } from "../shared/format";
import { diffChanges, writeAudit, type AuditChanges } from "./audit";
import { apiError } from "./api-guard";
import { validate, validateBody } from "./validation";

type Tx = Pick<Db, "select" | "insert" | "update" | "delete">;
export type PropertyRow = typeof property.$inferSelect;
type Person = { id: string; name: string; email: string };

const LABELS = {
  name: "Property name", street: "Street address", city: "City", state: "State", zip: "ZIP code", inNyc: "Located in New York City",
  bbl: "Borough-Block-Lot (BBL)", yearBuilt: "Year built", purchasePriceCents: "Purchase price", purchaseDate: "Purchase date", notes: "Notes",
} as const;

const SORT = { name: property.name, city: property.city, createdAt: property.createdAt } as const;
const isUuid = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
const escapeLike = (q: string) => q.replace(/[\\%_]/g, "\\$&");
const ENTIRE_PROPERTY = "Entire property";
const DUPLICATE_NAME = "A property with this name already exists.";

const notFound = (c: Context) => apiError(c, "NOT_FOUND", "Property not found.");
const stale = (c: Context) => apiError(c, "CONFLICT", "This property was changed by someone else. Reload and try again.");
const duplicateName = (c: Context) => apiError(c, "CONFLICT", DUPLICATE_NAME, { name: DUPLICATE_NAME });
const isUniqueViolation = (e: unknown) => (e as { code?: string; cause?: { code?: string } })?.code === "23505" || (e as { cause?: { code?: string } })?.cause?.code === "23505";

/** Active Admin/Landlord users: the only people who can be responsible for a property (§6.4, §14.2). */
const activeEditors = (tx: Tx) =>
  tx.select({ id: user.id, name: user.name, email: user.email }).from(user).where(and(eq(user.status, "active"), inArray(user.role, ["admin", "landlord"]))).orderBy(asc(user.name), asc(user.email));

/** Properties CRUD-lite (§6.4, §14.2): list, create (optionally with the single "Entire property" unit), read, edit. Archive, restore and delete come with later tasks. */
export function mountPropertyRoutes(app: Hono, db: Db) {
  const actor = (c: Context) => c.get("user").id;

  /** Responsible landlords for the given properties, ordered by name. */
  const responsibleFor = async (tx: Tx, ids: string[]): Promise<Map<string, Person[]>> => {
    const out = new Map<string, Person[]>(ids.map((id) => [id, []]));
    if (ids.length === 0) return out;
    const rows = await tx
      .select({ propertyId: propertyResponsible.propertyId, id: user.id, name: user.name, email: user.email })
      .from(propertyResponsible)
      .innerJoin(user, eq(user.id, propertyResponsible.userId))
      .where(inArray(propertyResponsible.propertyId, ids))
      .orderBy(asc(user.name), asc(user.email));
    for (const { propertyId, ...p } of rows) out.get(propertyId)?.push(p);
    return out;
  };

  const ownerSummary = async (tx: Tx, ids: string[]) => {
    const rows = ids.length === 0 ? [] : await tx.select({ id: owner.id, name: owner.name }).from(owner).where(inArray(owner.id, ids));
    return new Map(rows.map((o) => [o.id, o]));
  };

  /** Uses of each property's non-archived units, for the derived type (§6.4). */
  const usesFor = async (tx: Tx, ids: string[]): Promise<Map<string, ("Residential" | "Commercial")[]>> => {
    const out = new Map<string, ("Residential" | "Commercial")[]>(ids.map((id) => [id, []]));
    if (ids.length === 0) return out;
    const rows = await tx.select({ propertyId: unit.propertyId, use: unit.use }).from(unit).where(and(inArray(unit.propertyId, ids), isNull(unit.archivedAt)));
    for (const r of rows) out.get(r.propertyId)?.push(r.use);
    return out;
  };

  /** Rows plus owner, responsible landlords and the derived type. */
  const present = async (tx: Tx, rows: PropertyRow[]) => {
    const ids = rows.map((r) => r.id);
    const [people, owners, uses] = await Promise.all([responsibleFor(tx, ids), ownerSummary(tx, [...new Set(rows.map((r) => r.ownerId))]), usesFor(tx, ids)]);
    return rows.map((r) => {
      const responsible = people.get(r.id) ?? [];
      return { ...r, owner: owners.get(r.ownerId) ?? null, responsible, responsibleUserIds: responsible.map((p) => p.id), propertyType: propertyType(uses.get(r.id) ?? []) };
    });
  };

  /** Checks the owner (must exist and not be archived) and the responsible users (active Admin/Landlord only; the Smoke user never qualifies). */
  const checkReferences = async (tx: Tx, refs: { ownerId?: string; responsibleUserIds?: string[] }): Promise<Record<string, string>> => {
    const fields: Record<string, string> = {};
    if (refs.ownerId) {
      const [o] = await tx.select({ archivedAt: owner.archivedAt }).from(owner).where(eq(owner.id, refs.ownerId));
      if (!o) fields.ownerId = "Choose an owner.";
      else if (o.archivedAt) fields.ownerId = "Choose an owner that isn't archived.";
    }
    if (refs.responsibleUserIds) {
      const ok = new Set((await activeEditors(tx)).map((p) => p.id));
      if (!refs.responsibleUserIds.every((id) => ok.has(id))) fields.responsibleUserIds = "Choose only active Admin or Landlord users.";
    }
    return fields;
  };

  const nameTaken = async (tx: Tx, name: string, exceptId?: string) => {
    const same = sql`lower(${property.name}) = lower(${name})`;
    const [row] = await tx.select({ id: property.id }).from(property).where(and(isNull(property.archivedAt), same, exceptId ? sql`${property.id} <> ${exceptId}` : undefined)).limit(1);
    return Boolean(row);
  };

  const names = (people: Person[]) => people.map((p) => p.name).join(", ") || "—";

  app.get("/api/people", async (c) => c.json(await activeEditors(db)));

  app.get("/api/properties", async (c) => {
    const q = validate(c, propertyListQuerySchema, Object.fromEntries(new URL(c.req.url).searchParams));
    if (!q.ok) return q.response;
    const { page, pageSize, sort, order, q: search, archived } = q.data;
    const conditions: SQL[] = [];
    if (archived !== "true") conditions.push(isNull(property.archivedAt));
    if (search) {
      const like = `%${escapeLike(search)}%`;
      const address = sql`${property.street} || ', ' || ${property.city} || ', ' || ${property.state} || ' ' || ${property.zip}`;
      conditions.push(or(ilike(property.name, like), sql`${address} ilike ${like}`) as SQL);
    }
    const where = and(...conditions);
    const [{ total = 0 } = {}] = await db.select({ total: count() }).from(property).where(where);
    const dir = order === "desc" ? desc : asc;
    const rows = await db.select().from(property).where(where).orderBy(dir(SORT[sort]), asc(property.id)).limit(pageSize).offset((page - 1) * pageSize);
    return c.json({ data: await present(db, rows), page, pageSize, total });
  });

  app.post("/api/properties", async (c) => {
    const parsed = await validateBody(c, createPropertyWithUnitSchema);
    if (!parsed.ok) return parsed.response;
    const { responsibleUserIds = [actor(c)], singleUnitUse, ...fields } = parsed.data;
    try {
      const result = await db.transaction(async (tx) => {
        const bad = await checkReferences(tx, { ownerId: fields.ownerId, responsibleUserIds });
        if (Object.keys(bad).length > 0) return apiError(c, "VALIDATION_ERROR", "Please check the highlighted fields.", bad);
        if (await nameTaken(tx, fields.name)) return duplicateName(c);
        const [row] = await tx.insert(property).values({ ...fields, createdById: actor(c), updatedById: actor(c) }).returning();
        const created = row as PropertyRow;
        await tx.insert(propertyResponsible).values(responsibleUserIds.map((userId) => ({ propertyId: created.id, userId })));
        await writeAudit(tx, { actorUserId: actor(c), action: "create", entityType: "property", entityId: created.id, summary: `Created property ${created.name}` });
        if (singleUnitUse) {
          const [u] = await tx.insert(unit).values({ propertyId: created.id, label: ENTIRE_PROPERTY, use: singleUnitUse, createdById: actor(c), updatedById: actor(c) }).returning({ id: unit.id });
          await writeAudit(tx, { actorUserId: actor(c), action: "create", entityType: "unit", entityId: (u as { id: string }).id, summary: `Created unit ${ENTIRE_PROPERTY} (${singleUnitUse}) on ${created.name}` });
        }
        return (await present(tx, [created]))[0];
      });
      return result instanceof Response ? result : c.json(result, 201);
    } catch (e) {
      if (isUniqueViolation(e)) return duplicateName(c);
      throw e;
    }
  });

  app.get("/api/properties/:id", async (c) => {
    const id = c.req.param("id");
    if (!isUuid(id)) return notFound(c);
    const [row] = await db.select().from(property).where(eq(property.id, id));
    if (!row) return notFound(c);
    return c.json((await present(db, [row]))[0]);
  });

  app.patch("/api/properties/:id", async (c) => {
    const parsed = await validateBody(c, updatePropertySchema);
    if (!parsed.ok) return parsed.response;
    const id = c.req.param("id");
    if (!isUuid(id)) return notFound(c);
    const { version, responsibleUserIds, ...fields } = parsed.data;
    try {
      const result = await db.transaction(async (tx) => {
        const [current] = await tx.select().from(property).where(eq(property.id, id)).for("update");
        if (!current) return notFound(c);
        if (current.version !== version) return stale(c);
        const bad = await checkReferences(tx, { ownerId: fields.ownerId && fields.ownerId !== current.ownerId ? fields.ownerId : undefined, responsibleUserIds });
        if (Object.keys(bad).length > 0) return apiError(c, "VALIDATION_ERROR", "Please check the highlighted fields.", bad);
        if (fields.name && !current.archivedAt && (await nameTaken(tx, fields.name, id))) return duplicateName(c);
        const before = (await present(tx, [current]))[0] as NonNullable<Awaited<ReturnType<typeof present>>[0]>;
        const [row] = await tx
          .update(property)
          .set({ ...fields, version: sql`${property.version} + 1`, updatedById: actor(c), updatedAt: new Date() })
          .where(eq(property.id, id))
          .returning();
        const updated = row as PropertyRow;
        if (responsibleUserIds) {
          await tx.delete(propertyResponsible).where(eq(propertyResponsible.propertyId, id));
          await tx.insert(propertyResponsible).values(responsibleUserIds.map((userId) => ({ propertyId: id, userId })));
        }
        const after = (await present(tx, [updated]))[0] as typeof before;
        const changes: AuditChanges = diffChanges(current, updated, LABELS, (v) => String(v));
        if (current.purchasePriceCents !== updated.purchasePriceCents) {
          changes["Purchase price"] = [current.purchasePriceCents == null ? null : formatCents(current.purchasePriceCents), updated.purchasePriceCents == null ? null : formatCents(updated.purchasePriceCents)];
        }
        if (current.ownerId !== updated.ownerId) changes.Owner = [before.owner?.name ?? null, after.owner?.name ?? null];
        if (names(before.responsible) !== names(after.responsible)) changes["Responsible landlords"] = [names(before.responsible), names(after.responsible)];
        await writeAudit(tx, { actorUserId: actor(c), action: "update", entityType: "property", entityId: id, summary: `Updated property ${updated.name}`, changes });
        return after;
      });
      return result instanceof Response ? result : c.json(result);
    } catch (e) {
      if (isUniqueViolation(e)) return duplicateName(c);
      throw e;
    }
  });
}
