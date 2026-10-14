import { and, eq, inArray, sql } from "drizzle-orm";
import type { Context, Hono } from "hono";
import type { Db } from "../db/client";
import { lease, leaseTenant, propertyTax, rentStep, tenant, unit } from "../db/schema";
import { todayNy } from "../shared/dates";
import { formatCents, formatDate } from "../shared/format";
import { occupiedPeriod, periodsOverlap, unitLeaseStatuses, type LeaseTerms } from "../shared/lease";
import { endLeaseSchema, leaseRuleIssues, markMonthToMonthSchema, updateLeaseSchema } from "../shared/schemas";
import { writeAudit, type AuditChanges } from "./audit";
import { apiError } from "./api-guard";
import { loadLease, unitLeaseTerms, writeRevision, type LeasePresentation } from "./lease-store";
import { tenantDisplayName } from "./tenant-routes";
import { validateBody } from "./validation";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const isUuid = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
const OVERLAP = "This unit already has a lease for those dates.";
const notFound = (c: Context) => apiError(c, "NOT_FOUND", "Lease not found.");
const stale = (c: Context) => apiError(c, "CONFLICT", "This lease was changed by someone else. Reload and try again.");
const fieldErrors = (c: Context, fields: Record<string, string>) => apiError(c, "VALIDATION_ERROR", "Please check the highlighted fields.", fields);
const decimal = (n: number | null | undefined) => (n == null ? null : n.toFixed(4));

type Scalar = string | number | boolean | null | undefined;
const money = (v: Scalar) => (v == null ? null : formatCents(Number(v)));
const date = (v: Scalar) => (v == null ? null : formatDate(String(v)));
const text = (v: Scalar) => (v == null || v === "" ? null : String(v));
const yesNo = (v: Scalar) => (v == null ? null : v ? "Yes" : "No");
const percent = (v: Scalar) => (v == null ? null : `${v}%`);

/** Label and display format of each lease field that gets a line in the version summary and the activity log. */
const FIELDS: [keyof LeasePresentation, string, (v: Scalar) => string | null][] = [
  ["startDate", "Lease start date", date],
  ["endDate", "Lease end date", date],
  ["baseRentCents", "Monthly rent", money],
  ["increaseType", "Rent increases", text],
  ["increasePercent", "Annual increase (%)", percent],
  ["securityDepositCents", "Security deposit", money],
  ["rentDueDay", "Rent due day", text],
  ["lateFeeCents", "Late fee", money],
  ["lateFeeGraceDays", "Late fee grace period (days)", text],
  ["pets", "Pets", text],
  ["parking", "Parking", text],
  ["parkingChargeCents", "Parking charge (monthly)", money],
  ["childrenReside", "Children reside in unit", yesNo],
  ["breakClause", "Break clause", text],
  ["otherTerms", "Other special terms", text],
  ["baseTaxYear", "Base tax year", text],
  ["taxSharePercent", "Tenant's share of tax increase (%)", percent],
  ["monthToMonth", "Month-to-month", yesNo],
  ["monthToMonthRentCents", "Month-to-month monthly rent", money],
  ["moveOutDate", "Move-out date", date],
  ["endReason", "Reason", text],
];

/** Readable before/after lines for what differs between two versions of a lease (D-31). */
function describeChanges(before: LeasePresentation, after: LeasePresentation, names: Map<string, string>): AuditChanges {
  const out: AuditChanges = {};
  for (const [key, label, show] of FIELDS) {
    const [b, a] = [show(before[key] as Scalar), show(after[key] as Scalar)];
    if (b !== a) out[label] = [b, a];
  }
  const people = (l: LeasePresentation) => l.tenants.map((t) => `${names.get(t.tenantId) ?? "Unknown"}${t.isPrimary ? " (primary)" : ""}`).sort().join(", ");
  if (people(before) !== people(after)) out.Tenants = [people(before), people(after)];
  const steps = (l: LeasePresentation) => l.rentSteps.map((s) => `${formatDate(s.effectiveDate)}: ${formatCents(s.amountCents)}`).join("; ") || null;
  if (steps(before) !== steps(after)) out["Rent steps"] = [steps(before), steps(after)];
  return out;
}
const summarize = (changes: AuditChanges) => Object.entries(changes).map(([label, [b, a]]) => `${label}: ${b ?? "—"} → ${a ?? "—"}`).join("; ");

const termsOf = (l: LeasePresentation): LeaseTerms => {
  const dates = (t: { startDate: string; endDate: string }) => ({ startDate: t.startDate, endDate: t.endDate, rentCents: 1, increaseType: "none" as const });
  return { master: dates(l), extensions: l.extensions.map(dates), monthToMonth: l.monthToMonth, monthToMonthRentCents: l.monthToMonthRentCents, moveOutDate: l.moveOutDate };
};

/** Lease changes (§6.9, §11.13, §14.2): edit, delete, mark month-to-month and end. Each edit re-checks every rule and saves a new version (D-31). */
export function mountLeaseChangeRoutes(app: Hono, db: Db) {
  const actor = (c: Context) => c.get("user").id;

  /** Locks the lease and checks `version`; `change` returns an error response or the lease's new summary and changes. */
  const mutate = async (
    c: Context,
    version: number | undefined,
    change: (tx: Tx, current: LeasePresentation, unitRow: typeof unit.$inferSelect) => Promise<Response | { changes: AuditChanges; summary: string; auditSummary: string } | null>,
  ) => {
    const id = c.req.param("id") ?? "";
    if (!isUuid(id)) return notFound(c);
    const result = await db.transaction(async (tx) => {
      const [row] = await tx.select().from(lease).where(eq(lease.id, id)).for("update");
      if (!row) return notFound(c);
      if (version !== undefined && row.version !== version) return stale(c);
      if (row.archivedAt) return apiError(c, "CONFLICT", "This lease is archived. Restore its unit or property to change it.");
      const [u] = await tx.select().from(unit).where(eq(unit.id, row.unitId));
      const before = (await loadLease(tx, id))!;
      const done = await change(tx, before, u!);
      if (done instanceof Response) return done;
      if (done === null) return before;
      const [bumped] = await tx.update(lease).set({ version: sql`${lease.version} + 1`, updatedById: actor(c), updatedAt: new Date() }).where(eq(lease.id, id)).returning({ version: lease.version });
      await writeRevision(tx, id, bumped!.version, actor(c), done.summary);
      await writeAudit(tx, { actorUserId: actor(c), action: "update", entityType: "lease", entityId: id, summary: done.auditSummary, changes: done.changes });
      return (await loadLease(tx, id))!;
    });
    return result instanceof Response ? result : c.json(result);
  };

  const tenantNames = async (tx: Tx, ids: string[]) => {
    const rows = ids.length === 0 ? [] : await tx.select().from(tenant).where(inArray(tenant.id, ids));
    return new Map(rows.map((t) => [t.id, tenantDisplayName(t)]));
  };
  /** Whether the lease, with these terms, would share a day with another non-archived lease on its unit (§6.9). */
  const clashesWithOthers = async (tx: Tx, l: LeasePresentation, terms: LeaseTerms) => {
    const mine = occupiedPeriod(terms);
    return (await unitLeaseTerms(tx, l.unitId)).some((o) => o.id !== l.id && periodsOverlap(mine, occupiedPeriod(o)));
  };
  const statusOf = async (tx: Tx, l: LeasePresentation) => {
    const all = await unitLeaseTerms(tx, l.unitId);
    return unitLeaseStatuses(all, todayNy()).get(l.id)?.status;
  };

  app.patch("/api/leases/:id", async (c) => {
    const parsed = await validateBody(c, updateLeaseSchema);
    if (!parsed.ok) return parsed.response;
    const { version, tenants: newTenants, rentSteps: newSteps, ...patch } = parsed.data;
    return mutate(c, version, async (tx, before, u) => {
      // Fields that only make sense with the choice that was made are cleared when the choice changes.
      const type = patch.increaseType ?? before.increaseType;
      const merged = {
        ...before,
        ...patch,
        increasePercent: type === "percent" ? (patch.increasePercent !== undefined ? patch.increasePercent : before.increasePercent) : null,
        tenants: newTenants ?? before.tenants,
        rentSteps: type === "schedule" ? (newSteps ?? before.rentSteps) : [],
        monthToMonthRentCents: patch.monthToMonth === false && patch.monthToMonthRentCents === undefined ? null : patch.monthToMonthRentCents !== undefined ? patch.monthToMonthRentCents : before.monthToMonthRentCents,
        endReason: patch.moveOutDate === null && patch.endReason === undefined ? null : patch.endReason !== undefined ? patch.endReason : before.endReason,
      };
      const issues = leaseRuleIssues(merged, u.use);
      const masterIds = new Set(merged.tenants.map((t) => t.tenantId));
      if (before.extensions.length > 0) {
        const first = before.extensions.reduce((a, e) => (e.startDate < a ? e.startDate : a), before.extensions[0]!.startDate);
        if (merged.endDate >= first) issues.endDate ??= "The lease must end before its first extension starts. Change the extensions first.";
        if (before.extensions.some((e) => !e.tenants.some((t) => masterIds.has(t.tenantId)))) {
          issues.tenants ??= "At least one tenant from the original lease must stay on every extension. Change the extensions first.";
        }
      }
      if (Object.keys(issues).length > 0) return fieldErrors(c, issues);

      const added = merged.tenants.map((t) => t.tenantId).filter((id) => !before.tenants.some((t) => t.tenantId === id));
      if (added.length > 0) {
        const found = await tx.select({ id: tenant.id, archivedAt: tenant.archivedAt }).from(tenant).where(inArray(tenant.id, added));
        if (found.length !== new Set(added).size) return fieldErrors(c, { tenants: "Choose a tenant." });
        if (found.some((t) => t.archivedAt)) return fieldErrors(c, { tenants: "Choose tenants that aren't archived." });
      }
      if (merged.baseTaxYear != null && merged.baseTaxYear !== before.baseTaxYear) {
        const [year] = await tx.select({ id: propertyTax.id }).from(propertyTax).where(and(eq(propertyTax.propertyId, u.propertyId), eq(propertyTax.taxYear, merged.baseTaxYear)));
        if (!year) return fieldErrors(c, { baseTaxYear: "Choose a tax year that has been entered for this property." });
      }

      // Overlap rule (§6.9) against every other non-archived lease on the unit.
      if (await clashesWithOthers(tx, before, termsOf(merged))) return apiError(c, "CONFLICT", OVERLAP, { startDate: OVERLAP });

      const columns = merged;
      const after: LeasePresentation = { ...before, ...merged };
      const names = await tenantNames(tx, [...before.tenants, ...merged.tenants].map((t) => t.tenantId));
      const changes = describeChanges(before, after, names);
      if (Object.keys(changes).length === 0) return null;

      await tx
        .update(lease)
        .set({
          startDate: columns.startDate, endDate: columns.endDate, baseRentCents: columns.baseRentCents, increaseType: columns.increaseType,
          increasePercent: decimal(columns.increasePercent), securityDepositCents: columns.securityDepositCents ?? null, rentDueDay: columns.rentDueDay,
          lateFeeCents: columns.lateFeeCents ?? null, lateFeeGraceDays: columns.lateFeeGraceDays ?? null, pets: columns.pets ?? null, parking: columns.parking ?? null,
          parkingChargeCents: columns.parkingChargeCents ?? null, childrenReside: columns.childrenReside ?? null, breakClause: columns.breakClause ?? null,
          otherTerms: columns.otherTerms ?? null, baseTaxYear: columns.baseTaxYear ?? null, taxSharePercent: decimal(columns.taxSharePercent),
          monthToMonth: columns.monthToMonth, monthToMonthRentCents: columns.monthToMonthRentCents ?? null, moveOutDate: columns.moveOutDate ?? null, endReason: columns.endReason ?? null,
        })
        .where(eq(lease.id, before.id));
      if (newTenants) {
        await tx.delete(leaseTenant).where(eq(leaseTenant.leaseId, before.id));
        await tx.insert(leaseTenant).values(merged.tenants.map((t) => ({ leaseId: before.id, tenantId: t.tenantId, isPrimary: t.isPrimary })));
      }
      if (newSteps || type !== "schedule") {
        await tx.delete(rentStep).where(eq(rentStep.leaseId, before.id));
        if (merged.rentSteps.length > 0) await tx.insert(rentStep).values(merged.rentSteps.map((s) => ({ leaseId: before.id, effectiveDate: s.effectiveDate, amountCents: s.amountCents })));
      }
      return { changes, summary: summarize(changes), auditSummary: `Updated lease for unit ${u.label}` };
    });
  });

  app.post("/api/leases/:id/month-to-month", async (c) => {
    const parsed = await validateBody(c, markMonthToMonthSchema);
    if (!parsed.ok) return parsed.response;
    return mutate(c, parsed.data.version, async (tx, before, u) => {
      const status = await statusOf(tx, before);
      if (before.monthToMonth || (status !== "active" && status !== "needs_decision")) {
        return apiError(c, "CONFLICT", "Only an Active or Needs decision lease that isn't month-to-month can be marked month-to-month.");
      }
      // Month-to-month is open-ended, so a later lease on the unit would clash with it.
      if (await clashesWithOthers(tx, before, { ...termsOf(before), monthToMonth: true })) return apiError(c, "CONFLICT", OVERLAP, { monthToMonth: OVERLAP });
      const rent = parsed.data.monthToMonthRentCents ?? null;
      await tx.update(lease).set({ monthToMonth: true, monthToMonthRentCents: rent }).where(eq(lease.id, before.id));
      const changes: AuditChanges = { "Month-to-month": ["No", "Yes"], ...(rent === null ? {} : { "Month-to-month monthly rent": [money(before.monthToMonthRentCents), money(rent)] }) };
      return {
        changes,
        summary: rent === null ? "Marked month-to-month" : `Marked month-to-month at ${formatCents(rent)}`,
        auditSummary: `Marked lease for unit ${u.label} month-to-month`,
      };
    });
  });

  app.post("/api/leases/:id/end", async (c) => {
    const parsed = await validateBody(c, endLeaseSchema);
    if (!parsed.ok) return parsed.response;
    const { moveOutDate, endReason, version } = parsed.data;
    return mutate(c, version, async (tx, before, u) => {
      const status = await statusOf(tx, before);
      if (status === "ended" || status === "ended_superseded" || status === "upcoming") {
        return apiError(c, "CONFLICT", "A lease that has ended or hasn't started yet can't be ended. Delete it instead if it was a mistake.");
      }
      // Moving the move-out date must not make the lease clash with another one on the unit.
      if (await clashesWithOthers(tx, before, { ...termsOf(before), moveOutDate })) return apiError(c, "CONFLICT", OVERLAP, { moveOutDate: OVERLAP });
      await tx.update(lease).set({ moveOutDate, endReason }).where(eq(lease.id, before.id));
      const changes: AuditChanges = { "Move-out date": [date(before.moveOutDate), date(moveOutDate)], Reason: [before.endReason, endReason] };
      return { changes, summary: `Ended on ${formatDate(moveOutDate)} (${endReason})`, auditSummary: `Ended lease for unit ${u.label} on ${formatDate(moveOutDate)}: ${endReason}` };
    });
  });

  // Versions, extensions and rent steps go with the lease (ON DELETE CASCADE, §6.9); generated PDFs join them when documents exist.
  app.delete("/api/leases/:id", async (c) => {
    const id = c.req.param("id") ?? "";
    if (!isUuid(id)) return notFound(c);
    return db.transaction(async (tx) => {
      const [row] = await tx.select().from(lease).where(eq(lease.id, id)).for("update");
      if (!row) return notFound(c);
      const [u] = await tx.select().from(unit).where(eq(unit.id, row.unitId));
      await tx.delete(lease).where(eq(lease.id, id));
      await writeAudit(tx, {
        actorUserId: actor(c), action: "delete", entityType: "lease", entityId: id,
        summary: `Deleted lease for unit ${u?.label ?? ""}: ${formatDate(row.startDate)} – ${formatDate(row.endDate)}`,
      });
      return c.body(null, 204);
    });
  });
}
