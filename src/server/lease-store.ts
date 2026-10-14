import { asc, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client";
import { extensionTenant, lease, leaseExtension, leaseRevision, leaseTenant, rentStep } from "../db/schema";

type Tx = Pick<Db, "select" | "insert" | "update" | "delete">;
type LeaseRow = typeof lease.$inferSelect;
type ExtensionRow = typeof leaseExtension.$inferSelect;

const num = (v: string | null) => (v === null ? null : Number(v));
const steps = (rows: { effectiveDate: string; amountCents: number }[]) => rows.map((s) => ({ effectiveDate: s.effectiveDate, amountCents: s.amountCents }));

/** A lease with its tenants, rent steps and extensions: the API shape and the LeaseRevision snapshot (§6.9, D-31). */
export async function loadLease(tx: Tx, id: string) {
  const [row] = await tx.select().from(lease).where(eq(lease.id, id));
  if (!row) return null;
  return (await presentLeases(tx, [row]))[0]!;
}

export async function presentLeases(tx: Tx, rows: LeaseRow[]) {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const [tenants, leaseSteps, extensions] = await Promise.all([
    tx.select().from(leaseTenant).where(inArray(leaseTenant.leaseId, ids)),
    tx.select().from(rentStep).where(inArray(rentStep.leaseId, ids)).orderBy(asc(rentStep.effectiveDate)),
    tx.select().from(leaseExtension).where(inArray(leaseExtension.leaseId, ids)).orderBy(asc(leaseExtension.startDate)),
  ]);
  const extIds = extensions.map((e) => e.id);
  const [extTenants, extSteps] = extIds.length === 0 ? [[], []] : await Promise.all([
    tx.select().from(extensionTenant).where(inArray(extensionTenant.extensionId, extIds)),
    tx.select().from(rentStep).where(inArray(rentStep.extensionId, extIds)).orderBy(asc(rentStep.effectiveDate)),
  ]);
  const presentExtension = ({ increasePercent, taxSharePercent, ...e }: ExtensionRow) => ({
    ...e,
    increasePercent: num(increasePercent),
    taxSharePercent: num(taxSharePercent),
    tenants: extTenants.filter((t) => t.extensionId === e.id).map((t) => ({ tenantId: t.tenantId, isPrimary: t.isPrimary })),
    rentSteps: steps(extSteps.filter((s) => s.extensionId === e.id)),
  });
  return rows.map(({ increasePercent, taxSharePercent, ...r }) => ({
    ...r,
    increasePercent: num(increasePercent),
    taxSharePercent: num(taxSharePercent),
    tenants: tenants.filter((t) => t.leaseId === r.id).map((t) => ({ tenantId: t.tenantId, isPrimary: t.isPrimary })),
    rentSteps: steps(leaseSteps.filter((s) => s.leaseId === r.id)),
    extensions: extensions.filter((e) => e.leaseId === r.id).map(presentExtension),
  }));
}

export type LeasePresentation = NonNullable<Awaited<ReturnType<typeof loadLease>>>;

/** Saves the current state of a lease as its next version (D-31); the lease's `version` must already equal `versionNumber`. */
export async function writeRevision(tx: Tx, leaseId: string, versionNumber: number, changedById: string, summary: string) {
  const snapshot = await loadLease(tx, leaseId);
  await tx.insert(leaseRevision).values({ leaseId, versionNumber, snapshot, changedById, summary });
}
