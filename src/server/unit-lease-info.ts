import { and, inArray, isNull } from "drizzle-orm";
import type { Db } from "../db/client";
import { lease, tenant } from "../db/schema";
import { effectiveEndDate, lastRent, leaseStatusLabel, unitOccupancy, unitStatusText } from "../shared/lease";
import { currentTermSource, leaseTermsOf } from "../shared/lease-view";
import { presentLeases } from "./lease-store";
import { tenantDisplayName } from "./tenant-routes";

export interface UnitLeaseInfo {
  statusText: string;
  occupied: boolean;
  currentRentCents: number | null;
  /** D-16, only for vacant units. */
  potentialRentCents: number | null;
  tenants: string[];
  leaseEndDate: string | null;
  currentLease: { id: string; startDate: string; endDate: string; statusLabel: string; tenants: string[] } | null;
  history: { id: string; startDate: string; endDate: string; tenants: string[]; statusLabel: string; rentAtEndCents: number }[];
}

const NONE: UnitLeaseInfo = { statusText: "Vacant", occupied: false, currentRentCents: null, potentialRentCents: null, tenants: [], leaseEndDate: null, currentLease: null, history: [] };

/** Derived status, rent and lease cards for units (§7.4, D-16), from the shared lease rules. */
export async function unitLeaseInfo(db: Pick<Db, "select" | "insert" | "update" | "delete">, unitIds: string[], today: string): Promise<Map<string, UnitLeaseInfo>> {
  const result = new Map<string, UnitLeaseInfo>(unitIds.map((id) => [id, NONE]));
  if (unitIds.length === 0) return result;
  const rows = await db.select().from(lease).where(and(inArray(lease.unitId, unitIds), isNull(lease.archivedAt)));
  const leases = await presentLeases(db, rows);
  const tenantIds = [...new Set(leases.flatMap((l) => [...l.tenants, ...l.extensions.flatMap((e) => e.tenants)].map((t) => t.tenantId)))];
  const people = tenantIds.length === 0 ? [] : await db.select().from(tenant).where(inArray(tenant.id, tenantIds));
  const names = new Map(people.map((t) => [t.id, tenantDisplayName(t)]));
  for (const unitId of unitIds) {
    const mine = leases.filter((l) => l.unitId === unitId);
    if (mine.length === 0) continue;
    const terms = mine.map(leaseTermsOf);
    const occupancy = unitOccupancy(terms, today);
    const tenantsOf = (l: (typeof mine)[number]) => [...currentTermSource(l, today).tenants].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary)).map((t) => names.get(t.tenantId) ?? "");
    const view = (l: (typeof mine)[number], i: number) => {
      const status = occupancy.statuses.get(l.id)!;
      return { id: l.id, startDate: l.startDate, endDate: effectiveEndDate(terms[i]!), tenants: tenantsOf(l), statusLabel: leaseStatusLabel(status, l.moveOutDate), rentAtEndCents: lastRent(terms[i]!) };
    };
    const currentIndex = mine.findIndex((l) => l.id === occupancy.currentLeaseId);
    const current = currentIndex < 0 ? null : view(mine[currentIndex]!, currentIndex);
    result.set(unitId, {
      statusText: unitStatusText(occupancy),
      occupied: occupancy.occupied,
      currentRentCents: occupancy.currentRentCents,
      potentialRentCents: occupancy.occupied ? null : occupancy.potentialRentCents,
      tenants: current?.tenants ?? [],
      leaseEndDate: current?.endDate ?? null,
      currentLease: current ? { id: current.id, startDate: current.startDate, endDate: current.endDate, statusLabel: current.statusLabel, tenants: current.tenants } : null,
      history: mine.map(view).sort((a, b) => b.startDate.localeCompare(a.startDate)),
    });
  }
  return result;
}
