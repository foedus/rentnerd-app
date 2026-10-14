import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Context, Hono } from "hono";
import type { Db } from "../db/client";
import { lease, leaseExtension, leaseTenant, propertyTax, rentStep, tenant, unit } from "../db/schema";
import { addDays, todayNy } from "../shared/dates";
import { formatDate } from "../shared/format";
import { occupiedPeriod, periodsOverlap, unitLeaseStatuses, type LeaseTerms, type UnitLease } from "../shared/lease";
import { createLeaseSchema, leaseRuleIssues } from "../shared/schemas";
import { writeAudit } from "./audit";
import { apiError } from "./api-guard";
import { loadLease, writeRevision } from "./lease-store";
import { validateBody } from "./validation";

const isUuid = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
const OVERLAP = "This unit already has a lease for those dates.";
const fieldErrors = (c: Context, fields: Record<string, string>) => apiError(c, "VALIDATION_ERROR", "Please check the highlighted fields.", fields);
const decimal = (n: number | null | undefined) => (n == null ? null : n.toFixed(4));

/** Leases (§6.9, §14.2): create under a unit. Read, edit, delete and the lease actions come with later tasks. */
export function mountLeaseRoutes(app: Hono, db: Db) {
  const actor = (c: Context) => c.get("user").id;

  app.post("/api/units/:id/leases", async (c) => {
    const unitId = c.req.param("id");
    const parsed = await validateBody(c, createLeaseSchema);
    if (!parsed.ok) return parsed.response;
    if (!isUuid(unitId)) return apiError(c, "NOT_FOUND", "Unit not found.");
    const { replaceCurrentLease, tenants, rentSteps, increasePercent, taxSharePercent, ...fields } = parsed.data;

    const result = await db.transaction(async (tx) => {
      const [u] = await tx.select().from(unit).where(eq(unit.id, unitId)).for("update");
      if (!u) return apiError(c, "NOT_FOUND", "Unit not found.");
      if (u.archivedAt) return apiError(c, "CONFLICT", "This unit is archived. Restore it before adding leases.");

      const issues = leaseRuleIssues({ ...fields, increasePercent, taxSharePercent, rentSteps, tenants }, u.use);
      if (Object.keys(issues).length > 0) return fieldErrors(c, issues);

      const found = await tx.select({ id: tenant.id, archivedAt: tenant.archivedAt }).from(tenant).where(inArray(tenant.id, tenants.map((t) => t.tenantId)));
      const byId = new Map(found.map((t) => [t.id, t]));
      const missing = tenants.some((t) => !byId.has(t.tenantId));
      if (missing || found.some((t) => t.archivedAt)) {
        return fieldErrors(c, { tenants: missing ? "Choose a tenant." : "Choose tenants that aren't archived." });
      }
      if (fields.baseTaxYear != null) {
        const [year] = await tx.select({ id: propertyTax.id }).from(propertyTax).where(and(eq(propertyTax.propertyId, u.propertyId), eq(propertyTax.taxYear, fields.baseTaxYear)));
        if (!year) return fieldErrors(c, { baseTaxYear: "Choose a tax year that has been entered for this property." });
      }

      // Overlap rule (§6.9): against every other non-archived lease on this unit.
      const existing = await tx.select().from(lease).where(and(eq(lease.unitId, unitId), isNull(lease.archivedAt)));
      const extensions = existing.length === 0 ? [] : await tx.select().from(leaseExtension).where(inArray(leaseExtension.leaseId, existing.map((l) => l.id)));
      // Dates are all that status and overlap need, so terms carry no rent here.
      const dateTerm = (t: { startDate: string; endDate: string }) => ({ startDate: t.startDate, endDate: t.endDate, rentCents: 1, increaseType: "none" as const });
      const asTerms = (l: (typeof existing)[number]): UnitLease => ({
        id: l.id,
        master: dateTerm(l),
        extensions: extensions.filter((e) => e.leaseId === l.id).map(dateTerm),
        monthToMonth: l.monthToMonth,
        monthToMonthRentCents: l.monthToMonthRentCents,
        moveOutDate: l.moveOutDate,
      });
      const incoming: LeaseTerms = { master: dateTerm(fields), extensions: [], monthToMonth: fields.monthToMonth, monthToMonthRentCents: null, moveOutDate: fields.moveOutDate ?? null };
      const unitLeases = existing.map(asTerms);
      const clashes = unitLeases.filter((l) => periodsOverlap(occupiedPeriod(incoming), occupiedPeriod(l)));
      let replaced: (typeof existing)[number] | null = null;
      if (clashes.length > 0) {
        const clash = clashes[0]!;
        const status = unitLeaseStatuses(unitLeases, todayNy()).get(clash.id)?.status;
        const isCurrent = status === "active" || status === "month_to_month" || status === "needs_decision";
        const canReplace = replaceCurrentLease && clashes.length === 1 && isCurrent && fields.startDate > clash.master.startDate;
        if (!canReplace) return apiError(c, "CONFLICT", OVERLAP, { startDate: OVERLAP });
        replaced = existing.find((l) => l.id === clash.id)!;
      }

      const [row] = await tx
        .insert(lease)
        .values({
          ...fields,
          unitId,
          increasePercent: decimal(increasePercent),
          taxSharePercent: decimal(taxSharePercent),
          createdById: actor(c),
          updatedById: actor(c),
        })
        .returning();
      const created = row!;
      await tx.insert(leaseTenant).values(tenants.map((t) => ({ leaseId: created.id, tenantId: t.tenantId, isPrimary: t.isPrimary })));
      if (rentSteps.length > 0) await tx.insert(rentStep).values(rentSteps.map((s) => ({ leaseId: created.id, effectiveDate: s.effectiveDate, amountCents: s.amountCents })));
      await writeRevision(tx, created.id, 1, actor(c), "Lease created");
      await writeAudit(tx, { actorUserId: actor(c), action: "create", entityType: "lease", entityId: created.id, summary: `Created lease for unit ${u.label}: ${formatDate(created.startDate)} – ${formatDate(created.endDate)}` });

      if (replaced && replaceCurrentLease) {
        const moveOutDate = addDays(fields.startDate, -1);
        const [ended] = await tx
          .update(lease)
          .set({ moveOutDate, endReason: replaceCurrentLease.endReason, version: sql`${lease.version} + 1`, updatedById: actor(c), updatedAt: new Date() })
          .where(eq(lease.id, replaced.id))
          .returning({ version: lease.version });
        await writeRevision(tx, replaced.id, ended!.version, actor(c), `Ended on ${formatDate(moveOutDate)} (${replaceCurrentLease.endReason})`);
        await writeAudit(tx, {
          actorUserId: actor(c), action: "update", entityType: "lease", entityId: replaced.id,
          summary: `Ended lease for unit ${u.label} on ${formatDate(moveOutDate)}: ${replaceCurrentLease.endReason}`,
          changes: { "Move-out date": [null, formatDate(moveOutDate)], Reason: [null, replaceCurrentLease.endReason] },
        });
      }
      return loadLease(tx, created.id);
    });
    return result instanceof Response ? result : c.json(result, 201);
  });
}
