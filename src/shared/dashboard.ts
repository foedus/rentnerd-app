/** Dashboard lease tables (SPEC §11.6, D-32): leases needing a decision and leases ending soon. */
import { addDays, daysBetween } from "./dates";
import { effectiveEndDate, leaseRentOn, type LeaseStatusResult, type UnitLease } from "./lease";

export const ENDING_SOON_DAYS = 90;

/** A lease with status Needs decision: the date it ended on (its effective end) and its last known rent. */
export function needsDecisionRow(lease: UnitLease, status: LeaseStatusResult, today: string): { endedOn: string; currentRentCents: number } | null {
  if (status.status !== "needs_decision") return null;
  return { endedOn: effectiveEndDate(lease), currentRentCents: leaseRentOn(lease, today) };
}

/**
 * Active leases whose end (the move-out date if set, else the effective end) falls within today … today + 90 days.
 * Month-to-month, Upcoming, Needs decision and Ended leases never qualify.
 */
export function endingSoonRow(lease: UnitLease, status: LeaseStatusResult, today: string): { endDate: string; daysLeft: number; currentRentCents: number } | null {
  if (status.status !== "active") return null;
  const endDate = lease.moveOutDate ?? effectiveEndDate(lease);
  if (endDate < today || endDate > addDays(today, ENDING_SOON_DAYS)) return null;
  return { endDate, daysLeft: daysBetween(today, endDate), currentRentCents: leaseRentOn(lease, today) };
}
