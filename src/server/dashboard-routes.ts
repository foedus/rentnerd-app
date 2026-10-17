import { and, asc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import type { Hono } from "hono";
import type { Db } from "../db/client";
import { complianceItemType, lease, property, propertyComplianceItem, propertyResponsible, propertyTax, propertyValue, tenant, unit, user } from "../db/schema";
import { todayNy } from "../shared/dates";
import { complianceDashboardTable, endingSoonRow, needsDecisionRow } from "../shared/dashboard";
import { unitLeaseStatuses } from "../shared/lease";
import { currentTermSource, leaseTermsOf } from "../shared/lease-view";
import { propertyType } from "../shared/schemas";
import { computeStats, yieldNote, type StatLease, type StatProperty } from "../shared/stats";
import { presentLeases, type LeasePresentation } from "./lease-store";
import { tenantDisplayName } from "./tenant-routes";

type ComplianceRow = { itemId: string; propertyId: string; propertyName: string; itemName: string; dueDate: string; responsible: string[] };

const otherTerms = (t: { parkingChargeCents: number | null; baseTaxYear: number | null; taxSharePercent: number | null }) => ({
  parkingChargeCents: t.parkingChargeCents,
  baseTaxYear: t.baseTaxYear,
  taxSharePercent: t.taxSharePercent === null ? null : String(t.taxSharePercent),
});

function statLease(l: LeasePresentation): StatLease {
  return {
    ...leaseTermsOf(l),
    otherIncomeByTermStart: Object.fromEntries([l, ...l.extensions].map((t) => [t.startDate, otherTerms(t)])),
  };
}

/** Dashboard (§11.6, §14.2): portfolio summary, per-property rows and the lease tables, from the shared calculations (D-32). */
export function mountDashboardRoutes(app: Hono, db: Db) {
  app.get("/api/dashboard", async (c) => {
    const today = todayNy();
    const properties = await db.select({ id: property.id, name: property.name, purchasePriceCents: property.purchasePriceCents }).from(property).where(isNull(property.archivedAt)).orderBy(asc(property.name), asc(property.id));
    const ids = properties.map((p) => p.id);
    const units = ids.length === 0 ? [] : await db.select({ id: unit.id, propertyId: unit.propertyId, label: unit.label, use: unit.use }).from(unit).where(and(inArray(unit.propertyId, ids), isNull(unit.archivedAt))).orderBy(asc(unit.label), asc(unit.id));
    const unitIds = units.map((u) => u.id);
    const [values, taxes, leaseRows] = await Promise.all([
      ids.length === 0 ? [] : db.select({ propertyId: propertyValue.propertyId, valueDate: propertyValue.valueDate, kind: propertyValue.kind, amountCents: propertyValue.amountCents }).from(propertyValue).where(inArray(propertyValue.propertyId, ids)),
      ids.length === 0 ? [] : db.select({ propertyId: propertyTax.propertyId, taxYear: propertyTax.taxYear, amountCents: propertyTax.amountCents }).from(propertyTax).where(inArray(propertyTax.propertyId, ids)),
      unitIds.length === 0 ? [] : db.select().from(lease).where(and(inArray(lease.unitId, unitIds), isNull(lease.archivedAt))),
    ]);
    const leases = await presentLeases(db, leaseRows);
    const tenantIds = [...new Set(leases.flatMap((l) => [...l.tenants, ...l.extensions.flatMap((e) => e.tenants)].map((t) => t.tenantId)))];
    const people = tenantIds.length === 0 ? [] : await db.select().from(tenant).where(inArray(tenant.id, tenantIds));
    const names = new Map(people.map((t) => [t.id, tenantDisplayName(t)]));

    const statProperties = new Map<string, StatProperty>();
    const byProperty = properties.map((p) => {
      const mine = units.filter((u) => u.propertyId === p.id);
      const stat: StatProperty = {
        purchasePriceCents: p.purchasePriceCents,
        values: values.filter((v) => v.propertyId === p.id),
        taxes: taxes.filter((t) => t.propertyId === p.id),
        units: mine.map((u) => ({ leases: leases.filter((l) => l.unitId === u.id).map(statLease) })),
      };
      statProperties.set(p.id, stat);
      return { propertyId: p.id, name: p.name, propertyType: propertyType(mine.map((u) => u.use)), ...computeStats([stat], today) };
    });

    const needingDecision: object[] = [];
    const endingSoon: object[] = [];
    for (const u of units) {
      const mine = leases.filter((l) => l.unitId === u.id);
      const terms = mine.map(leaseTermsOf);
      const statuses = unitLeaseStatuses(terms, today);
      const propertyName = properties.find((p) => p.id === u.propertyId)?.name ?? "";
      mine.forEach((l, i) => {
        const status = statuses.get(l.id)!;
        const tenants = [...currentTermSource(l, today).tenants].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary)).map((t) => names.get(t.tenantId) ?? "");
        const base = { leaseId: l.id, propertyId: u.propertyId, propertyName, unitId: u.id, unitLabel: u.label, tenants };
        const decision = needsDecisionRow(terms[i]!, status, today);
        if (decision) needingDecision.push({ ...base, ...decision });
        const soon = endingSoonRow(terms[i]!, status, today);
        if (soon) endingSoon.push({ ...base, ...soon });
      });
    }
    const itemRows = ids.length === 0 ? [] : await db
      .select({ id: propertyComplianceItem.id, propertyId: propertyComplianceItem.propertyId, itemName: complianceItemType.name, scheduleType: complianceItemType.scheduleType, dueDate: propertyComplianceItem.nextDueDate })
      .from(propertyComplianceItem)
      .innerJoin(complianceItemType, eq(complianceItemType.id, propertyComplianceItem.typeId))
      .where(and(inArray(propertyComplianceItem.propertyId, ids), eq(propertyComplianceItem.applicable, true), isNotNull(propertyComplianceItem.nextDueDate), isNull(complianceItemType.archivedAt)));
    const responsibleRows = ids.length === 0 ? [] : await db
      .select({ propertyId: propertyResponsible.propertyId, name: user.name })
      .from(propertyResponsible)
      .innerJoin(user, eq(user.id, propertyResponsible.userId))
      .where(inArray(propertyResponsible.propertyId, ids))
      .orderBy(asc(user.name), asc(user.id));
    const overdueCompliance: ComplianceRow[] = [];
    const complianceDueSoon: ComplianceRow[] = [];
    for (const i of itemRows) {
      const table = complianceDashboardTable({ applicable: true, scheduleType: i.scheduleType, nextDueDate: i.dueDate, completionCount: 0 }, today);
      if (table === null) continue;
      const row = {
        itemId: i.id,
        propertyId: i.propertyId,
        propertyName: properties.find((p) => p.id === i.propertyId)?.name ?? "",
        itemName: i.itemName,
        dueDate: i.dueDate!,
        responsible: responsibleRows.filter((r) => r.propertyId === i.propertyId).map((r) => r.name),
      };
      (table === "overdue" ? overdueCompliance : complianceDueSoon).push(row);
    }
    const byDue = (a: ComplianceRow, b: ComplianceRow) => a.dueDate.localeCompare(b.dueDate) || a.propertyName.localeCompare(b.propertyName) || a.itemName.localeCompare(b.itemName);
    const by = (key: string) => (a: object, b: object) => String((a as Record<string, unknown>)[key]).localeCompare(String((b as Record<string, unknown>)[key]));
    const summary = computeStats([...statProperties.values()], today);
    return c.json({
      asOf: today,
      summary: { ...summary, yieldNote: yieldNote(summary) },
      byProperty,
      leasesNeedingDecision: needingDecision.sort(by("endedOn")),
      leasesEndingSoon: endingSoon.sort(by("endDate")),
      overdueCompliance: overdueCompliance.sort(byDue),
      complianceDueSoon: complianceDueSoon.sort(byDue),
    });
  });
}
