import { and, asc, desc, eq, exists, inArray, isNull, or, type SQL } from "drizzle-orm";
import type { Context, Hono } from "hono";
import type { Db } from "../db/client";
import { extensionTenant, lease, leaseExtension, leaseRevision, leaseTenant, property, propertyTax, tenant, unit, user } from "../db/schema";
import { todayNy } from "../shared/dates";
import { lastRent, leaseStatus, leaseStatusLabel } from "../shared/lease";
import { currentTermSource, leaseRentSchedule, leaseSummary, leaseTermsOf } from "../shared/lease-view";
import { taxReimbursement } from "../shared/income";
import { leaseListQuerySchema } from "../shared/schemas";
import { apiError } from "./api-guard";
import { presentLeases } from "./lease-store";
import { tenantDisplayName } from "./tenant-routes";
import { validate } from "./validation";

const isUuid = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
const notFound = (c: Context) => apiError(c, "NOT_FOUND", "Lease not found.");
const envelope = <T>(data: T[], page = 1, pageSize = Math.max(data.length, 1)) => ({ data, page, pageSize, total: data.length });

/** Lease reads (§14.2): list with derived status, detail with current-term values, rent schedule and versions. */
export function mountLeaseReadRoutes(app: Hono, db: Db) {
  const describe = async (rows: (typeof lease.$inferSelect)[], detail: boolean) => {
    const today = todayNy();
    const leases = await presentLeases(db, rows);
    const unitIds = [...new Set(rows.map((r) => r.unitId))];
    const live = unitIds.length === 0 ? [] : await db.select({ id: lease.id, unitId: lease.unitId, startDate: lease.startDate }).from(lease).where(and(inArray(lease.unitId, unitIds), isNull(lease.archivedAt)));
    const units = unitIds.length === 0 ? [] : await db.select({ id: unit.id, label: unit.label, use: unit.use, propertyId: unit.propertyId, propertyName: property.name }).from(unit).innerJoin(property, eq(property.id, unit.propertyId)).where(inArray(unit.id, unitIds));
    const tenantIds = [...new Set(leases.flatMap((l) => [...l.tenants, ...l.extensions.flatMap((e) => e.tenants)].map((t) => t.tenantId)))];
    const people = tenantIds.length === 0 ? [] : await db.select().from(tenant).where(inArray(tenant.id, tenantIds));
    const person = new Map(people.map((t) => [t.id, t]));

    return Promise.all(leases.map(async (l) => {
      const terms = leaseTermsOf(l);
      const later = live.some((o) => o.unitId === l.unitId && o.id !== l.id && o.startDate > l.startDate);
      const result = leaseStatus(terms, today, later);
      const archived = l.archivedAt !== null;
      const label = leaseStatusLabel(result, l.moveOutDate);
      const source = currentTermSource(l, today);
      const u = units.find((x) => x.id === l.unitId);
      const currentTenants = source.tenants.map((t) => {
        const p = person.get(t.tenantId);
        return { tenantId: t.tenantId, isPrimary: t.isPrimary, displayName: p ? tenantDisplayName(p) : "", email: p?.email ?? null, phone: p?.phone ?? null };
      });
      const base = {
        ...l,
        status: result.status,
        statusLabel: archived ? `${label} · Archived` : label,
        movingOut: result.movingOut,
        unitLabel: u?.label ?? null,
        unitUse: u?.use ?? null,
        propertyId: u?.propertyId ?? null,
        propertyName: u?.propertyName ?? null,
        ...leaseSummary(l, today),
        lastRentCents: lastRent(terms),
        currentTenants,
      };
      if (!detail) return base;
      const current = {
        extensionId: source === l ? null : source.id,
        startDate: source.startDate, endDate: source.endDate, baseRentCents: source.baseRentCents,
        securityDepositCents: source.securityDepositCents, rentDueDay: source.rentDueDay, lateFeeCents: source.lateFeeCents,
        lateFeeGraceDays: source.lateFeeGraceDays, pets: source.pets, parking: source.parking, parkingChargeCents: source.parkingChargeCents,
        childrenReside: source.childrenReside, breakClause: source.breakClause, otherTerms: source.otherTerms,
        baseTaxYear: source.baseTaxYear, taxSharePercent: source.taxSharePercent, tenants: currentTenants,
      };
      const taxes = current.baseTaxYear === null ? [] : await db.select({ taxYear: propertyTax.taxYear, amountCents: propertyTax.amountCents }).from(propertyTax).where(eq(propertyTax.propertyId, u?.propertyId ?? ""));
      const tax = taxReimbursement(taxes, current.baseTaxYear, current.taxSharePercent === null ? null : String(current.taxSharePercent));
      const masterTenants = l.tenants.map((t) => {
        const p = person.get(t.tenantId);
        return { tenantId: t.tenantId, isPrimary: t.isPrimary, displayName: p ? tenantDisplayName(p) : "" };
      });
      return { ...base, masterTenants, current: { ...current, taxReimbursementCents: tax?.cents ?? null, taxReimbursementExplanation: tax?.explanation ?? null }, rentSchedule: leaseRentSchedule(l) };
    }));
  };

  const detail = async (c: Context) => {
    const id = c.req.param("id") ?? "";
    if (!isUuid(id)) return null;
    const [row] = await db.select().from(lease).where(eq(lease.id, id));
    return row ?? null;
  };

  app.get("/api/leases", async (c) => {
    const params = new URL(c.req.url).searchParams;
    const input = { ...Object.fromEntries(params), status: params.getAll("status") };
    const q = validate(c, leaseListQuerySchema, input);
    if (!q.ok) return q.response;
    const { page, pageSize, sort, order, status, propertyId, unitId, tenantId, archived } = q.data;
    const conditions: SQL[] = [];
    if (archived !== "true") conditions.push(isNull(lease.archivedAt));
    if (unitId) conditions.push(eq(lease.unitId, unitId));
    if (propertyId) conditions.push(exists(db.select({ x: unit.id }).from(unit).where(and(eq(unit.id, lease.unitId), eq(unit.propertyId, propertyId)))));
    if (tenantId) {
      const onLease = db.select({ x: leaseTenant.leaseId }).from(leaseTenant).where(and(eq(leaseTenant.leaseId, lease.id), eq(leaseTenant.tenantId, tenantId)));
      const onExtension = db
        .select({ x: extensionTenant.extensionId })
        .from(extensionTenant)
        .innerJoin(leaseExtension, eq(leaseExtension.id, extensionTenant.extensionId))
        .where(and(eq(leaseExtension.leaseId, lease.id), eq(extensionTenant.tenantId, tenantId)));
      conditions.push(or(exists(onLease), exists(onExtension)) as SQL);
    }
    const dir = order === "asc" ? asc : desc;
    const column = { startDate: lease.startDate, endDate: lease.endDate, createdAt: lease.createdAt, property: lease.startDate }[sort];
    const rows = await db.select().from(lease).where(and(...conditions)).orderBy(dir(column), asc(lease.id));
    // Status is derived, so it is filtered (and the page cut) in code after loading the candidates (D-32).
    const described = await describe(rows, false);
    // "property" orders by property name, then unit label (numbers in natural order), then newest start first.
    const byUnit = (a: (typeof described)[number], b: (typeof described)[number]) =>
      (a.propertyName ?? "").localeCompare(b.propertyName ?? "") || (a.unitLabel ?? "").localeCompare(b.unitLabel ?? "", undefined, { numeric: true }) || b.startDate.localeCompare(a.startDate);
    const all = sort === "property" ? [...described].sort((a, b) => (order === "asc" ? byUnit(a, b) : byUnit(b, a))) : described;
    const matching = status.length === 0 ? all : all.filter((l) => status.includes(l.status));
    return c.json({ data: matching.slice((page - 1) * pageSize, page * pageSize), page, pageSize, total: matching.length });
  });

  app.get("/api/leases/:id", async (c) => {
    const row = await detail(c);
    if (!row) return notFound(c);
    return c.json((await describe([row], true))[0]);
  });

  app.get("/api/leases/:id/rent-schedule", async (c) => {
    const row = await detail(c);
    if (!row) return notFound(c);
    const [presented] = await presentLeases(db, [row]);
    return c.json(envelope(leaseRentSchedule(presented!)));
  });

  const revisions = (leaseId: string, versionNumber?: number) =>
    db
      .select({ versionNumber: leaseRevision.versionNumber, changedAt: leaseRevision.changedAt, changedById: leaseRevision.changedById, changedByName: user.name, summary: leaseRevision.summary, snapshot: leaseRevision.snapshot })
      .from(leaseRevision)
      .leftJoin(user, eq(user.id, leaseRevision.changedById))
      .where(and(eq(leaseRevision.leaseId, leaseId), versionNumber === undefined ? undefined : eq(leaseRevision.versionNumber, versionNumber)));

  app.get("/api/leases/:id/versions", async (c) => {
    const row = await detail(c);
    if (!row) return notFound(c);
    const rows = await revisions(row.id).orderBy(desc(leaseRevision.versionNumber));
    return c.json(envelope(rows.map((v) => ({ versionNumber: v.versionNumber, changedAt: v.changedAt, changedById: v.changedById, changedByName: v.changedByName, summary: v.summary }))));
  });

  app.get("/api/leases/:id/versions/:n", async (c) => {
    const row = await detail(c);
    const n = Number(c.req.param("n"));
    if (!row || !Number.isInteger(n) || n < 1 || n > 2_147_483_647) return notFound(c);
    const [version] = await revisions(row.id, n);
    if (!version) return apiError(c, "NOT_FOUND", "Version not found.");
    const snapshot = version.snapshot as { tenants?: { tenantId: string; isPrimary: boolean }[] };
    const members = snapshot.tenants ?? [];
    const people = members.length === 0 ? [] : await db.select().from(tenant).where(inArray(tenant.id, members.map((t) => t.tenantId)));
    const snapshotTenants = members.map((t) => {
      const p = people.find((x) => x.id === t.tenantId);
      return { ...t, displayName: p ? tenantDisplayName(p) : "" };
    });
    return c.json({ ...version, snapshotTenants });
  });
}
