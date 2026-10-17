import { and, asc, count, desc, eq, ilike, isNull, or, sql, type SQL } from "drizzle-orm";
import type { Context, Hono } from "hono";
import type { Db } from "../db/client";
import { extensionTenant, leaseTenant, tenant } from "../db/schema";
import { normalizeTenantNames, tenantListQuerySchema, tenantRuleIssues, createTenantSchema, updateTenantSchema, requiredVersionSchema } from "../shared/schemas";
import { diffChanges, writeAudit } from "./audit";
import { apiError } from "./api-guard";
import { validate, validateBody } from "./validation";

type Tx = Pick<Db, "select" | "insert" | "update" | "delete">;
export type TenantRow = typeof tenant.$inferSelect;

/** Whether a tenant is on any lease or extension (§6.8): such tenants can only be archived. */
export interface TenantUsage {
  isOnLease(tx: Tx, tenantId: string): Promise<boolean>;
}

export const dbTenantUsage: TenantUsage = {
  async isOnLease(tx, tenantId) {
    const [onLease] = await tx.select({ id: leaseTenant.leaseId }).from(leaseTenant).where(eq(leaseTenant.tenantId, tenantId)).limit(1);
    if (onLease) return true;
    const [onExtension] = await tx.select({ id: extensionTenant.extensionId }).from(extensionTenant).where(eq(extensionTenant.tenantId, tenantId)).limit(1);
    return Boolean(onExtension);
  },
};

const LABELS = {
  tenantType: "Tenant type", firstName: "First name", lastName: "Last name", businessName: "Business name",
  contactPerson: "Contact person", email: "Email", phone: "Phone", notes: "Notes",
} as const;

/** "First Last" or "Business name (Contact person)" (§6.8). */
export const tenantDisplayName = (t: Pick<TenantRow, "tenantType" | "firstName" | "lastName" | "businessName" | "contactPerson">) =>
  t.tenantType === "Business" ? `${t.businessName} (${t.contactPerson})` : `${t.firstName} ${t.lastName}`;

const isUuid = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
const escapeLike = (q: string) => q.replace(/[\\%_]/g, "\\$&");
const notFound = (c: Context) => apiError(c, "NOT_FOUND", "Tenant not found.");
const stale = (c: Context) => apiError(c, "CONFLICT", "This tenant was changed by someone else. Reload and try again.");

/** Tenants CRUD, archive and restore (SPEC §6.8, §14.2). Every editor may use them; the Smoke user is blocked by the session guard. */
export function mountTenantRoutes(app: Hono, db: Db, usage: TenantUsage = dbTenantUsage) {
  const actionVersion = async (c: Context) => validate(c, requiredVersionSchema, await c.req.json().catch(() => ({})));
  const present = (t: TenantRow) => ({ ...t, displayName: tenantDisplayName(t) });
  const actor = (c: Context) => c.get("user").id;

  const mutate = async (c: Context, version: number | undefined, change: (tx: Tx, current: TenantRow) => Promise<Response | TenantRow>) => {
    const id = c.req.param("id") ?? "";
    if (!isUuid(id)) return notFound(c);
    const result = await db.transaction(async (tx) => {
      const [current] = await tx.select().from(tenant).where(eq(tenant.id, id)).for("update");
      if (!current) return notFound(c);
      if (version !== undefined && current.version !== version) return stale(c);
      return change(tx, current);
    });
    return result instanceof Response ? result : c.json(present(result));
  };

  app.get("/api/tenants", async (c) => {
    const q = validate(c, tenantListQuerySchema, Object.fromEntries(new URL(c.req.url).searchParams));
    if (!q.ok) return q.response;
    const { page, pageSize, sort, order, q: search, archived } = q.data;
    const conditions: SQL[] = [];
    if (archived !== "true") conditions.push(isNull(tenant.archivedAt));
    if (search) {
      const like = `%${escapeLike(search)}%`;
      conditions.push(
        or(ilike(tenant.firstName, like), ilike(tenant.lastName, like), ilike(tenant.businessName, like), ilike(tenant.contactPerson, like), ilike(tenant.email, like)) as SQL,
      );
    }
    const where = and(...conditions);
    const [{ total = 0 } = {}] = await db.select({ total: count() }).from(tenant).where(where);
    const dir = order === "desc" ? desc : asc;
    const nameKey = sql`lower(coalesce(${tenant.businessName}, ${tenant.lastName}))`;
    const keys = { name: [dir(nameKey), dir(sql`lower(coalesce(${tenant.firstName}, ${tenant.contactPerson}))`)], email: [dir(tenant.email)], createdAt: [dir(tenant.createdAt)] }[sort];
    const rows = await db.select().from(tenant).where(where).orderBy(...keys, asc(tenant.id)).limit(pageSize).offset((page - 1) * pageSize);
    return c.json({ data: rows.map(present), page, pageSize, total });
  });

  app.post("/api/tenants", async (c) => {
    const parsed = await validateBody(c, createTenantSchema);
    if (!parsed.ok) return parsed.response;
    const created = await db.transaction(async (tx) => {
      const [row] = await tx.insert(tenant).values({ ...normalizeTenantNames(parsed.data), createdById: actor(c), updatedById: actor(c) }).returning();
      const t = row as TenantRow;
      await writeAudit(tx, { actorUserId: actor(c), action: "create", entityType: "tenant", entityId: t.id, summary: `Created tenant ${tenantDisplayName(t)}` });
      return t;
    });
    return c.json(present(created), 201);
  });

  app.get("/api/tenants/:id", async (c) => {
    const id = c.req.param("id");
    if (!isUuid(id)) return notFound(c);
    const [row] = await db.select().from(tenant).where(eq(tenant.id, id));
    if (!row) return notFound(c);
    return c.json({ ...present(row), onLease: await usage.isOnLease(db, id) });
  });

  app.patch("/api/tenants/:id", async (c) => {
    const parsed = await validateBody(c, updateTenantSchema);
    if (!parsed.ok) return parsed.response;
    const { version, ...fields } = parsed.data;
    return mutate(c, version, async (tx, current) => {
      const merged = normalizeTenantNames({ ...current, ...fields });
      const issues = tenantRuleIssues(merged);
      if (Object.keys(issues).length > 0) return apiError(c, "VALIDATION_ERROR", "Please check the highlighted fields.", issues);
      const [row] = await tx
        .update(tenant)
        .set({
          tenantType: merged.tenantType, firstName: merged.firstName, lastName: merged.lastName, businessName: merged.businessName,
          contactPerson: merged.contactPerson, email: merged.email, phone: merged.phone, notes: merged.notes,
          version: sql`${tenant.version} + 1`, updatedById: actor(c), updatedAt: new Date(),
        })
        .where(eq(tenant.id, current.id))
        .returning();
      const updated = row as TenantRow;
      const changes = diffChanges(current, updated, LABELS, (v) => String(v));
      await writeAudit(tx, { actorUserId: actor(c), action: "update", entityType: "tenant", entityId: updated.id, summary: `Updated tenant ${tenantDisplayName(updated)}`, changes });
      return updated;
    });
  });

  const setArchived = (archive: boolean) => async (c: Context) => {
    const parsed = await actionVersion(c);
    if (!parsed.ok) return parsed.response;
    return mutate(c, parsed.data.version, async (tx, current) => {
      if (Boolean(current.archivedAt) === archive) return apiError(c, "CONFLICT", archive ? "This tenant is already archived." : "This tenant is not archived.");
      const [row] = await tx
        .update(tenant)
        .set({ archivedAt: archive ? new Date() : null, version: sql`${tenant.version} + 1`, updatedById: actor(c), updatedAt: new Date() })
        .where(eq(tenant.id, current.id))
        .returning();
      const t = row as TenantRow;
      const verb = archive ? "archive" : "restore";
      await writeAudit(tx, { actorUserId: actor(c), action: verb, entityType: "tenant", entityId: t.id, summary: `${archive ? "Archived" : "Restored"} tenant ${tenantDisplayName(t)}` });
      return t;
    });
  };
  app.post("/api/tenants/:id/archive", setArchived(true));
  app.post("/api/tenants/:id/restore", setArchived(false));

  app.delete("/api/tenants/:id", async (c) => {
    const id = c.req.param("id");
    if (!isUuid(id)) return notFound(c);
    return db.transaction(async (tx) => {
      const [current] = await tx.select().from(tenant).where(eq(tenant.id, id)).for("update");
      if (!current) return notFound(c);
      if (await usage.isOnLease(tx, id)) return apiError(c, "CONFLICT", "Tenants on a lease can only be archived");
      await tx.delete(tenant).where(eq(tenant.id, id));
      await writeAudit(tx, { actorUserId: actor(c), action: "delete", entityType: "tenant", entityId: id, summary: `Deleted tenant ${tenantDisplayName(current)}` });
      return c.body(null, 204);
    });
  });
}
