import { describe, expect, it } from "vitest";
import { endingSoonRow, needsDecisionRow } from "./dashboard";
import { unitLeaseStatuses, type UnitLease } from "./lease";

const today = "2026-06-15";
const lease = (id: string, start: string, end: string, over: Partial<UnitLease> = {}): UnitLease => ({
  id, master: { startDate: start, endDate: end, rentCents: 200000, increaseType: "none" }, extensions: [], monthToMonth: false, monthToMonthRentCents: null, moveOutDate: null, ...over,
});
const ending = (l: UnitLease, others: UnitLease[] = []) => endingSoonRow(l, unitLeaseStatuses([l, ...others], today).get(l.id)!, today);
const decision = (l: UnitLease, others: UnitLease[] = []) => needsDecisionRow(l, unitLeaseStatuses([l, ...others], today).get(l.id)!, today);

describe("endingSoonRow", () => {
  it("includes an Active lease ending in 45 days with Days left 45", () => {
    expect(ending(lease("a", "2025-09-01", "2026-07-30"))).toEqual({ endDate: "2026-07-30", daysLeft: 45, currentRentCents: 200000 });
  });
  it("uses the move-out date when set (30 days)", () => {
    expect(ending(lease("a", "2025-09-01", "2027-01-31", { moveOutDate: "2026-07-15" }))).toMatchObject({ endDate: "2026-07-15", daysLeft: 30 });
  });
  it("includes today and day 90, excludes day 91 and 120", () => {
    expect(ending(lease("a", "2025-09-01", today))?.daysLeft).toBe(0);
    expect(ending(lease("a", "2025-09-01", "2026-09-13"))?.daysLeft).toBe(90);
    expect(ending(lease("a", "2025-09-01", "2026-09-14"))).toBeNull();
    expect(ending(lease("a", "2025-09-01", "2026-10-13"))).toBeNull();
  });
  it("uses the effective end of the latest extension", () => {
    const l = lease("a", "2025-01-01", "2026-06-30", { extensions: [{ startDate: "2026-07-01", endDate: "2027-06-30", rentCents: 210000, increaseType: "none" }] });
    expect(ending(l)).toBeNull();
  });
  it("excludes Month-to-month, Upcoming and Needs decision leases", () => {
    expect(ending(lease("m", "2025-01-01", "2026-05-31", { monthToMonth: true }))).toBeNull();
    expect(ending(lease("u", "2026-07-01", "2026-08-31"))).toBeNull();
    expect(ending(lease("n", "2025-01-01", "2026-05-31"))).toBeNull();
  });
  it("excludes a lease whose move-out date is past (Ended)", () => {
    expect(ending(lease("e", "2025-01-01", "2026-12-31", { moveOutDate: "2026-06-01" }))).toBeNull();
  });
});

describe("needsDecisionRow", () => {
  it("returns the end date and last rent for a lease past its end", () => {
    expect(decision(lease("n", "2025-01-01", "2026-05-31"))).toEqual({ endedOn: "2026-05-31", currentRentCents: 200000 });
  });
  it("is null for Month-to-month, superseded and Active leases", () => {
    expect(decision(lease("m", "2025-01-01", "2026-05-31", { monthToMonth: true }))).toBeNull();
    expect(decision(lease("s", "2025-01-01", "2026-05-31"), [lease("later", "2026-06-01", "2027-05-31")])).toBeNull();
    expect(decision(lease("a", "2025-01-01", "2026-12-31"))).toBeNull();
  });
});
