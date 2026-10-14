/** Lease terms, rent on a date, status and unit occupancy (SPEC §3, §7.2, §7.4, D-14, D-16, D-32). Money is integer cents. */
import { addDays } from "./dates";
import { formatDate } from "./format";
import { rentInEffect, type RentTerm } from "./rent";

export interface LeaseTerms {
  /** The master term. */
  master: RentTerm;
  /** Extension terms in any order. */
  extensions: readonly RentTerm[];
  monthToMonth: boolean;
  monthToMonthRentCents: number | null;
  moveOutDate: string | null;
}

export type LeaseStatus = "ended" | "upcoming" | "active" | "month_to_month" | "ended_superseded" | "needs_decision";

export interface LeaseStatusResult {
  status: LeaseStatus;
  /** True for an Active lease with a move-out date ("Active · moving out {date}"). */
  movingOut: boolean;
}

export const LEASE_STATUS_LABELS: Record<LeaseStatus, string> = {
  ended: "Ended",
  upcoming: "Upcoming",
  active: "Active",
  month_to_month: "Month-to-month",
  ended_superseded: "Ended (superseded)",
  needs_decision: "Needs decision",
};

/** Master term first, then extensions by start date. */
export function orderedTerms(lease: Pick<LeaseTerms, "master" | "extensions">): RentTerm[] {
  const extensions = [...lease.extensions].sort((a, b) => a.startDate.localeCompare(b.startDate));
  return [lease.master, ...extensions];
}

/** End date of the latest term (master or extension). */
export function effectiveEndDate(lease: Pick<LeaseTerms, "master" | "extensions">): string {
  return orderedTerms(lease).reduce((end, term) => (term.endDate > end ? term.endDate : end), lease.master.endDate);
}

/** §3: the term containing `on`; after the effective end the latest term; before the start the master term; in a gap the term before it. */
export function currentTerm(lease: Pick<LeaseTerms, "master" | "extensions">, on: string): RentTerm {
  const terms = orderedTerms(lease);
  if (on < lease.master.startDate) return lease.master;
  let found = terms[0]!;
  for (const term of terms) if (term.startDate <= on) found = term;
  return found;
}

/** §7.2: lease rent on date `on`. */
export function leaseRentOn(lease: LeaseTerms, on: string): number {
  const terms = orderedTerms(lease);
  const containing = terms.find((t) => t.startDate <= on && on <= t.endDate);
  if (containing) return rentInEffect(containing, on);
  if (on < lease.master.startDate) return rentInEffect(lease.master, on);
  const preceding = terms.filter((t) => t.startDate <= on).reduce((a, b) => (b.endDate > a.endDate ? b : a));
  const lastTermRent = rentInEffect(preceding, preceding.endDate);
  const end = effectiveEndDate(lease);
  const inGap = on < end;
  if (inGap || lease.monthToMonth) return lease.monthToMonthRentCents ?? lastTermRent;
  return rentInEffect(currentTerm(lease, end), end);
}

/** Last occupied day: the move-out date if set, otherwise the effective end date. */
export function lastOccupiedDay(lease: LeaseTerms): string {
  return lease.moveOutDate ?? effectiveEndDate(lease);
}

/** §7.2 "Last rent" (used for potential rent, D-16). */
export function lastRent(lease: LeaseTerms): number {
  return leaseRentOn(lease, lastOccupiedDay(lease));
}

/** §7.4. `hasLaterLease`: another non-archived lease on the same unit starts after this one (any status). */
export function leaseStatus(lease: LeaseTerms, today: string, hasLaterLease: boolean): LeaseStatusResult {
  const { moveOutDate } = lease;
  const end = effectiveEndDate(lease);
  const result = (status: LeaseStatus, movingOut = false): LeaseStatusResult => ({ status, movingOut });
  if (moveOutDate !== null && moveOutDate < today) return result("ended");
  if (today < lease.master.startDate) return result("upcoming");
  if (moveOutDate !== null) return result("active", true);
  if (today <= end) return result("active");
  if (lease.monthToMonth) return result("month_to_month");
  if (hasLaterLease) return result("ended_superseded");
  return result("needs_decision");
}

/** "Active · moving out Jan 5, 2027", "Month-to-month", … (without any " · Archived" suffix). */
export function leaseStatusLabel(result: LeaseStatusResult, moveOutDate: string | null): string {
  const label = LEASE_STATUS_LABELS[result.status];
  return result.movingOut && moveOutDate ? `${label} · moving out ${formatDate(moveOutDate)}` : label;
}

export interface UnitLease extends LeaseTerms {
  id: string;
  archived?: boolean;
}

export interface UnitOccupancy {
  occupied: boolean;
  /** The Active, Month-to-month or Needs decision lease occupying the unit. */
  currentLeaseId: string | null;
  /** Current rent of the occupying lease (§7.2), else null. */
  currentRentCents: number | null;
  /** Vacant units with an Upcoming lease: the earliest such start ("Vacant · leased from {date}"). */
  leasedFrom: string | null;
  /** D-16: last rent of the most recent non-archived lease; null if never leased. Meaningful for vacant units. */
  potentialRentCents: number | null;
  /** Status of every non-archived lease, by id. */
  statuses: ReadonlyMap<string, LeaseStatusResult>;
}

const OCCUPYING: readonly LeaseStatus[] = ["active", "month_to_month", "needs_decision"];

/** Statuses of a unit's non-archived leases; "later lease" is judged among them (§7.4 rule 5). */
export function unitLeaseStatuses(leases: readonly UnitLease[], today: string): Map<string, LeaseStatusResult> {
  const live = leases.filter((l) => !l.archived);
  return new Map(
    live.map((l) => [l.id, leaseStatus(l, today, live.some((o) => o.id !== l.id && o.master.startDate > l.master.startDate))]),
  );
}

/** §7.4 occupancy and D-16 potential rent for one unit. */
export function unitOccupancy(leases: readonly UnitLease[], today: string): UnitOccupancy {
  const live = leases.filter((l) => !l.archived);
  const statuses = unitLeaseStatuses(leases, today);
  const status = (l: UnitLease): LeaseStatus => statuses.get(l.id)!.status;
  const current = live.find((l) => OCCUPYING.includes(status(l))) ?? null;
  const upcoming = live.filter((l) => status(l) === "upcoming").map((l) => l.master.startDate).sort();
  const mostRecent = live.reduce<UnitLease | null>((a, b) => (a === null || b.master.startDate >= a.master.startDate ? b : a), null);
  return {
    occupied: current !== null,
    currentLeaseId: current?.id ?? null,
    currentRentCents: current ? leaseRentOn(current, today) : null,
    leasedFrom: current === null ? (upcoming[0] ?? null) : null,
    potentialRentCents: mostRecent ? lastRent(mostRecent) : null,
    statuses,
  };
}

/** Day after the effective end: where a following extension defaults to start (§6.10). */
export function nextExtensionStart(lease: Pick<LeaseTerms, "master" | "extensions">): string {
  return addDays(effectiveEndDate(lease), 1);
}

export interface OccupiedPeriod {
  start: string;
  /** Last occupied day; null when open-ended (month-to-month with no move-out date). */
  end: string | null;
}

/** §6.9: from the start to the move-out date if set, else the effective end date, unless month-to-month (open-ended). */
export function occupiedPeriod(lease: LeaseTerms): OccupiedPeriod {
  const start = lease.master.startDate;
  if (lease.moveOutDate !== null) return { start, end: lease.moveOutDate < start ? start : lease.moveOutDate };
  return { start, end: lease.monthToMonth ? null : effectiveEndDate(lease) };
}

/** Whether two occupied periods share at least one day (both ends inclusive). */
export function periodsOverlap(a: OccupiedPeriod, b: OccupiedPeriod): boolean {
  return (a.end === null || b.start <= a.end) && (b.end === null || a.start <= b.end);
}
