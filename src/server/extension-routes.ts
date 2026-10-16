import { and, eq, inArray } from "drizzle-orm";
import type { Context, Hono } from "hono";
import type { Db } from "../db/client";
import { extensionTenant, lease, leaseExtension, propertyTax, rentStep, tenant } from "../db/schema";
import { addDays } from "../shared/dates";
import { formatCents, formatDate } from "../shared/format";
import { createExtensionSchema, termRuleIssues, updateExtensionSchema } from "../shared/schemas";
import { apiError } from "./api-guard";
import { clashesWithOthers, decimal, describeChanges, fieldErrors, isUuid, leaseMutator, OVERLAP, statusOf, summarize, tenantNames, termsOf, type LeaseChange, type Tx } from "./lease-change-routes";
import type { LeasePresentation } from "./lease-store";
import { validateBody } from "./validation";

type Extension = LeasePresentation["extensions"][number];
/** The terms an extension copies from the term before it (§6.10), plus its tenants. */
const COPIED = [
  "securityDepositCents", "rentDueDay", "lateFeeCents", "lateFeeGraceDays", "pets", "parking", "parkingChargeCents",
  "childrenReside", "breakClause", "otherTerms", "baseTaxYear", "taxSharePercent",
] as const;
const ORIGINAL_TENANTS = "At least one tenant from the original lease must stay. To change all tenants, end this lease and create a new lease.";
const notFound = (c: Context) => apiError(c, "NOT_FOUND", "Extension not found.");
const describe = (e: { startDate: string; endDate: string; baseRentCents: number }) => `${formatDate(e.startDate)} – ${formatDate(e.endDate)} at ${formatCents(e.baseRentCents)}`;

/** Extensions (§6.10, §14.2): add to a lease, edit or delete the latest. Each change saves a new lease version (D-31). */
export function mountExtensionRoutes(app: Hono, db: Db) {
  const mutate = leaseMutator(db);
  const respondWith = (id: string, status: 200 | 201) => (c: Context, after: LeasePresentation) => c.json(after.extensions.find((e) => e.id === id)!, status);

  /** Rules shared by add and edit; returns an error response, or null when the extension `next` may follow `previousEnd`. */
  const checkTerm = async (c: Context, tx: Tx, before: LeasePresentation, use: "Residential" | "Commercial", propertyId: string, next: Omit<Extension, "id" | "leaseId">, previous: { end: string; tenantIds: Set<string>; baseTaxYear: number | null }, others: Extension[]) => {
    const minStart = addDays(previous.end, 1);
    const issues = termRuleIssues(next, use);
    if (next.startDate < minStart) issues.startDate = `Extension must start on or after ${formatDate(minStart)}.`;
    const masterIds = new Set(before.tenants.map((t) => t.tenantId));
    if (!issues.tenants && !next.tenants.some((t) => masterIds.has(t.tenantId))) issues.tenants = ORIGINAL_TENANTS;
    if (Object.keys(issues).length > 0) return fieldErrors(c, issues);

    const added = next.tenants.map((t) => t.tenantId).filter((id) => !previous.tenantIds.has(id));
    if (added.length > 0) {
      const found = await tx.select({ archivedAt: tenant.archivedAt }).from(tenant).where(inArray(tenant.id, added));
      if (found.length !== new Set(added).size) return fieldErrors(c, { tenants: "Choose a tenant." });
      if (found.some((t) => t.archivedAt)) return fieldErrors(c, { tenants: "Choose tenants that aren't archived." });
    }
    if (next.baseTaxYear != null && next.baseTaxYear !== previous.baseTaxYear) {
      const [year] = await tx.select({ id: propertyTax.id }).from(propertyTax).where(and(eq(propertyTax.propertyId, propertyId), eq(propertyTax.taxYear, next.baseTaxYear)));
      if (!year) return fieldErrors(c, { baseTaxYear: "Choose a tax year that has been entered for this property." });
    }
    const extensions = [...others, { ...next, id: "", leaseId: before.id }];
    if (await clashesWithOthers(tx, before, termsOf({ ...before, monthToMonth: false, extensions }))) return apiError(c, "CONFLICT", OVERLAP, { startDate: OVERLAP });
    return null;
  };

  const saveParts = async (tx: Tx, extensionId: string, e: { tenants: Extension["tenants"]; rentSteps: Extension["rentSteps"] }) => {
    await tx.delete(extensionTenant).where(eq(extensionTenant.extensionId, extensionId));
    await tx.insert(extensionTenant).values(e.tenants.map((t) => ({ extensionId, tenantId: t.tenantId, isPrimary: t.isPrimary })));
    await tx.delete(rentStep).where(eq(rentStep.extensionId, extensionId));
    if (e.rentSteps.length > 0) await tx.insert(rentStep).values(e.rentSteps.map((s) => ({ extensionId, effectiveDate: s.effectiveDate, amountCents: s.amountCents })));
  };
  const columns = (e: Omit<Extension, "id" | "leaseId">) => ({
    startDate: e.startDate, endDate: e.endDate, baseRentCents: e.baseRentCents, increaseType: e.increaseType, increasePercent: decimal(e.increasePercent),
    securityDepositCents: e.securityDepositCents ?? null, rentDueDay: e.rentDueDay, lateFeeCents: e.lateFeeCents ?? null, lateFeeGraceDays: e.lateFeeGraceDays ?? null,
    pets: e.pets ?? null, parking: e.parking ?? null, parkingChargeCents: e.parkingChargeCents ?? null, childrenReside: e.childrenReside ?? null,
    breakClause: e.breakClause ?? null, otherTerms: e.otherTerms ?? null, baseTaxYear: e.baseTaxYear ?? null, taxSharePercent: decimal(e.taxSharePercent), notes: e.notes ?? null,
  });
  /** Before/after lines for an extension's fields, labelled "Extension …" (the lease's own fields cannot differ here). */
  const diff = async (tx: Tx, lease_: LeasePresentation, a: Extension, b: Extension) => {
    const names = await tenantNames(tx, [...a.tenants, ...b.tenants].map((t) => t.tenantId));
    const view = (e: Extension) => ({ ...lease_, ...e, id: lease_.id }) as LeasePresentation;
    const out = describeChanges(view(a), view(b), names);
    if ((a.notes ?? null) !== (b.notes ?? null)) out.Notes = [a.notes ?? null, b.notes ?? null];
    return Object.fromEntries(Object.entries(out).map(([label, v]) => [label.replace(/^Lease /, "Extension "), v]));
  };

  app.post("/api/leases/:id/extensions", async (c) => {
    const parsed = await validateBody(c, createExtensionSchema);
    if (!parsed.ok) return parsed.response;
    const { version, tenants, rentSteps, startDate, ...given } = parsed.data;
    let newId = "";
    return mutate(c, version, async (tx, before, u): Promise<Response | LeaseChange> => {
      const status = await statusOf(tx, before);
      if (before.moveOutDate || status === "ended" || status === "ended_superseded") {
        return apiError(c, "CONFLICT", "Extensions can't be added to an ended lease or one with a move-out date.");
      }
      const latest = [...before.extensions].sort((a, b) => a.startDate.localeCompare(b.startDate)).at(-1);
      const previous = latest ?? before;
      const end = [before.endDate, ...before.extensions.map((e) => e.endDate)].sort().at(-1)!;
      const type = given.increaseType ?? "none";
      const next = {
        ...Object.fromEntries(COPIED.map((k) => [k, given[k] !== undefined ? given[k] : previous[k]])),
        startDate: startDate ?? addDays(end, 1),
        endDate: given.endDate,
        baseRentCents: given.baseRentCents,
        increaseType: type,
        increasePercent: type === "percent" ? (given.increasePercent ?? null) : null,
        rentSteps: type === "schedule" ? (rentSteps ?? []) : [],
        tenants: tenants ?? previous.tenants,
        notes: given.notes ?? null,
      } as Omit<Extension, "id" | "leaseId">;
      const refused = await checkTerm(c, tx, before, u.use, u.propertyId, next, { end, tenantIds: new Set(previous.tenants.map((t) => t.tenantId)), baseTaxYear: previous.baseTaxYear }, before.extensions);
      if (refused) return refused;

      const [row] = await tx.insert(leaseExtension).values({ ...columns(next), leaseId: before.id, createdById: c.get("user").id, updatedById: c.get("user").id }).returning({ id: leaseExtension.id });
      newId = row!.id;
      await saveParts(tx, newId, next);
      // A lease that is extended is no longer month-to-month (§6.10).
      if (before.monthToMonth) await tx.update(lease).set({ monthToMonth: false, monthToMonthRentCents: null }).where(eq(lease.id, before.id));
      const changes = { "Extension added": [null, describe(next)] } as LeaseChange["changes"];
      if (before.monthToMonth) changes["Month-to-month"] = ["Yes", "No"];
      return { changes, summary: summarize(changes), auditSummary: `Added extension to lease for unit ${u.label}: ${describe(next)}`, respond: (cx, after) => respondWith(newId, 201)(cx, after) };
    });
  });

  /** Finds the extension, then runs `change` on its lease; only the latest extension can be changed (§6.10). */
  const onLatest = async (c: Context, version: number | undefined, change: (tx: Tx, before: LeasePresentation, ext: Extension, previous: Pick<Extension, "endDate" | "tenants" | "baseTaxYear">, unitRow: Parameters<Parameters<typeof mutate>[2]>[2]) => Promise<Response | LeaseChange>) => {
    const id = c.req.param("id") ?? "";
    if (!isUuid(id)) return notFound(c);
    const [row] = await db.select({ leaseId: leaseExtension.leaseId }).from(leaseExtension).where(eq(leaseExtension.id, id));
    if (!row) return notFound(c);
    return mutate(c, version, async (tx, before, u) => {
      const sorted = [...before.extensions].sort((a, b) => a.startDate.localeCompare(b.startDate));
      const ext = sorted.find((e) => e.id === id);
      if (!ext) return notFound(c);
      if (sorted.at(-1)!.id !== id) return apiError(c, "CONFLICT", "Only the latest extension can be changed.");
      return change(tx, before, ext, sorted.at(-2) ?? before, u);
    }, row.leaseId);
  };

  app.patch("/api/extensions/:id", async (c) => {
    const parsed = await validateBody(c, updateExtensionSchema);
    if (!parsed.ok) return parsed.response;
    const { version, tenants, rentSteps, ...patch } = parsed.data;
    return onLatest(c, version, async (tx, before, ext, previous, u) => {
      const type = patch.increaseType ?? ext.increaseType;
      const next = {
        ...ext,
        ...patch,
        increaseType: type,
        increasePercent: type === "percent" ? (patch.increasePercent !== undefined ? patch.increasePercent : ext.increasePercent) : null,
        rentSteps: type === "schedule" ? (rentSteps ?? ext.rentSteps) : [],
        tenants: tenants ?? ext.tenants,
        notes: patch.notes !== undefined ? patch.notes : ext.notes,
      } as Extension;
      const others = before.extensions.filter((e) => e.id !== ext.id);
      const refused = await checkTerm(c, tx, before, u.use, u.propertyId, next, { end: previous.endDate, tenantIds: new Set(previous.tenants.map((t) => t.tenantId)), baseTaxYear: ext.baseTaxYear }, others);
      if (refused) return refused;
      const changes = await diff(tx, before, ext, next);
      if (Object.keys(changes).length === 0) return { changes, summary: "", auditSummary: "", respond: respondWith(ext.id, 200) };
      await tx.update(leaseExtension).set({ ...columns(next), updatedById: c.get("user").id, updatedAt: new Date() }).where(eq(leaseExtension.id, ext.id));
      await saveParts(tx, ext.id, next);
      return { changes, summary: summarize(changes), auditSummary: `Updated extension on lease for unit ${u.label}`, respond: respondWith(ext.id, 200) };
    });
  });

  app.delete("/api/extensions/:id", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { version?: unknown };
    const version = typeof body.version === "number" ? body.version : undefined;
    return onLatest(c, version, async (tx, _before, ext, _previous, u) => {
      await tx.delete(leaseExtension).where(eq(leaseExtension.id, ext.id));
      const changes = { "Extension removed": [describe(ext), null] } as LeaseChange["changes"];
      return { changes, summary: summarize(changes), auditSummary: `Deleted extension on lease for unit ${u.label}: ${describe(ext)}`, respond: (cx) => cx.body(null, 204) };
    });
  });
}
