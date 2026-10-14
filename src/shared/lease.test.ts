import { describe, expect, it } from "vitest";
import {
  currentTerm,
  effectiveEndDate,
  lastRent,
  leaseRentOn,
  leaseStatus,
  leaseStatusLabel,
  nextExtensionStart,
  occupiedPeriod,
  periodsOverlap,
  unitOccupancy,
  type LeaseTerms,
  type UnitLease,
} from "./lease";
import type { RentTerm } from "./rent";

const master: RentTerm = { startDate: "2026-01-01", endDate: "2026-12-31", rentCents: 200_000, increaseType: "none" };
const ext: RentTerm = { startDate: "2027-01-01", endDate: "2027-12-31", rentCents: 210_000, increaseType: "none" };
const lease = (over: Partial<LeaseTerms> = {}): LeaseTerms => ({
  master,
  extensions: [],
  monthToMonth: false,
  monthToMonthRentCents: null,
  moveOutDate: null,
  ...over,
});

describe("effective end and current term", () => {
  it("uses the latest extension end regardless of order", () => {
    const later: RentTerm = { ...ext, startDate: "2028-01-01", endDate: "2028-06-30" };
    expect(effectiveEndDate(lease())).toBe("2026-12-31");
    expect(effectiveEndDate(lease({ extensions: [later, ext] }))).toBe("2028-06-30");
  });
  it("picks the containing term, the latest after the end, the master before the start", () => {
    const l = lease({ extensions: [ext] });
    expect(currentTerm(l, "2026-06-01")).toBe(master);
    expect(currentTerm(l, "2027-06-01")).toBe(ext);
    expect(currentTerm(l, "2030-01-01")).toBe(ext);
    expect(currentTerm(l, "2025-01-01")).toBe(master);
  });
  it("defaults the next extension to the day after the effective end", () => {
    expect(nextExtensionStart(lease({ extensions: [ext] }))).toBe("2028-01-01");
  });
});

describe("leaseRentOn (§7.2)", () => {
  const pct: RentTerm = { ...master, increaseType: "percent", increasePercent: "3" };
  it("uses the term containing the date", () => {
    const l = lease({ extensions: [ext] });
    expect(leaseRentOn(l, "2026-12-31")).toBe(200_000);
    expect(leaseRentOn(l, "2027-01-01")).toBe(210_000);
  });
  it("applies increases within a term", () => {
    const l = lease({ master: { ...pct, endDate: "2028-12-31" } });
    expect(leaseRentOn(l, "2027-01-01")).toBe(206_000);
    expect(leaseRentOn(l, "2028-01-01")).toBe(212_180);
  });
  it("uses month-to-month rent in a gap, else the preceding term's last-day rent", () => {
    const gapExt: RentTerm = { ...ext, startDate: "2027-03-01" };
    expect(leaseRentOn(lease({ extensions: [gapExt] }), "2027-02-01")).toBe(200_000);
    expect(leaseRentOn(lease({ extensions: [gapExt], monthToMonthRentCents: 195_000 }), "2027-02-01")).toBe(195_000);
    const inc = lease({ master: pct, extensions: [{ ...gapExt }] });
    expect(leaseRentOn(inc, "2027-02-01")).toBe(200_000);
  });
  it("after the end: month-to-month rent if set, else last term rent", () => {
    expect(leaseRentOn(lease({ monthToMonth: true }), "2027-05-01")).toBe(200_000);
    expect(leaseRentOn(lease({ monthToMonth: true, monthToMonthRentCents: 220_000 }), "2027-05-01")).toBe(220_000);
    expect(leaseRentOn(lease({ monthToMonth: true, extensions: [ext] }), "2028-05-01")).toBe(210_000);
  });
  it("after the end without month-to-month: rent on the effective end date, ignoring month-to-month rent", () => {
    const l = lease({ master: pct, monthToMonthRentCents: 1 });
    expect(leaseRentOn(l, "2030-01-01")).toBe(200_000);
    const multi = lease({ master: { ...pct, endDate: "2027-12-31" }, moveOutDate: "2029-01-01" });
    expect(leaseRentOn(multi, "2029-01-01")).toBe(206_000);
  });
  it("before the start uses the base rent", () => {
    expect(leaseRentOn(lease(), "2025-06-01")).toBe(200_000);
  });
});

describe("lastRent", () => {
  it("is the rent on the move-out date when set", () => {
    const l = lease({ master: { ...master, increaseType: "percent", increasePercent: "3", endDate: "2028-12-31" }, moveOutDate: "2027-03-15" });
    expect(lastRent(l)).toBe(206_000);
  });
  it("is the rent on the effective end date otherwise", () => {
    expect(lastRent(lease({ extensions: [ext] }))).toBe(210_000);
  });
  it("uses month-to-month rent for a move-out after the end of a month-to-month lease", () => {
    expect(lastRent(lease({ monthToMonth: true, monthToMonthRentCents: 225_000, moveOutDate: "2027-04-30" }))).toBe(225_000);
  });
});

describe("leaseStatus (§7.4)", () => {
  const s = (l: LeaseTerms, today: string, later = false) => leaseStatus(l, today, later);
  it("1 Ended: move-out before today, beating everything", () => {
    expect(s(lease({ moveOutDate: "2026-05-31", monthToMonth: true }), "2026-06-01").status).toBe("ended");
    expect(s(lease({ moveOutDate: "2025-05-31" }), "2025-06-01").status).toBe("ended");
  });
  it("2 Upcoming before the start", () => {
    expect(s(lease(), "2025-12-31").status).toBe("upcoming");
    expect(s(lease(), "2026-01-01").status).toBe("active");
  });
  it("3 Active through the effective end, including an extension", () => {
    expect(s(lease(), "2026-12-31").status).toBe("active");
    expect(s(lease({ extensions: [ext] }), "2027-12-31")).toEqual({ status: "active", movingOut: false });
  });
  it("3 Active and moving out when the move-out date is today or later, even past the end", () => {
    expect(s(lease({ moveOutDate: "2027-02-01" }), "2027-01-15")).toEqual({ status: "active", movingOut: true });
    expect(s(lease({ moveOutDate: "2026-06-01", monthToMonth: true }), "2026-06-01")).toEqual({ status: "active", movingOut: true });
  });
  it("4 Month-to-month after the end", () => {
    expect(s(lease({ monthToMonth: true }), "2027-01-01").status).toBe("month_to_month");
  });
  it("5 Superseded needs a later lease and no move-out date", () => {
    expect(s(lease(), "2027-01-01", true).status).toBe("ended_superseded");
    expect(s(lease({ monthToMonth: true }), "2027-01-01", true).status).toBe("month_to_month");
  });
  it("6 Needs decision otherwise", () => {
    expect(s(lease(), "2027-01-01").status).toBe("needs_decision");
    expect(s(lease({ extensions: [ext] }), "2028-01-01").status).toBe("needs_decision");
  });
  it("labels", () => {
    expect(leaseStatusLabel(s(lease({ moveOutDate: "2027-01-05" }), "2026-06-01"), "2027-01-05")).toBe("Active · moving out Jan 5, 2027");
    expect(leaseStatusLabel(s(lease(), "2027-06-01", true), null)).toBe("Ended (superseded)");
    expect(leaseStatusLabel(s(lease(), "2027-06-01"), null)).toBe("Needs decision");
  });
});

describe("unitOccupancy (§7.4, D-16)", () => {
  const unitLease = (id: string, start: string, end: string, rent: number, over: Partial<UnitLease> = {}): UnitLease => ({
    ...lease(),
    id,
    master: { startDate: start, endDate: end, rentCents: rent, increaseType: "none" },
    ...over,
  });
  it("never leased: vacant, no potential rent", () => {
    expect(unitOccupancy([], "2027-01-01")).toMatchObject({ occupied: false, potentialRentCents: null, leasedFrom: null, currentLeaseId: null });
  });
  it("active lease: occupied at its current rent", () => {
    expect(unitOccupancy([unitLease("a", "2026-01-01", "2026-12-31", 100_000)], "2026-06-01")).toMatchObject({
      occupied: true, currentLeaseId: "a", currentRentCents: 100_000,
    });
  });
  it("Needs decision counts as occupied at the last known rent", () => {
    const occ = unitOccupancy([unitLease("a", "2026-01-01", "2026-12-31", 100_000)], "2027-03-01");
    expect(occ).toMatchObject({ occupied: true, currentRentCents: 100_000 });
    expect(occ.statuses.get("a")?.status).toBe("needs_decision");
  });
  it("ended lease: vacant, potential rent is its last rent", () => {
    const occ = unitOccupancy([unitLease("a", "2026-01-01", "2026-12-31", 100_000, { moveOutDate: "2026-08-31" })], "2027-01-01");
    expect(occ).toMatchObject({ occupied: false, potentialRentCents: 100_000, currentRentCents: null });
  });
  it("upcoming lease: vacant, leased from the earliest upcoming start, potential rent from the most recent lease", () => {
    const old = unitLease("old", "2025-01-01", "2025-12-31", 90_000);
    const next = unitLease("next", "2027-02-01", "2027-12-31", 120_000);
    const later = unitLease("later", "2028-02-01", "2028-12-31", 130_000);
    const occ = unitOccupancy([old, later, next], "2027-01-01");
    expect(occ).toMatchObject({ occupied: false, leasedFrom: "2027-02-01", potentialRentCents: 130_000 });
    expect(occ.statuses.get("old")?.status).toBe("ended_superseded");
  });
  it("a superseded lease does not occupy; the newer active lease does", () => {
    const old = unitLease("old", "2025-01-01", "2025-12-31", 90_000);
    const cur = unitLease("cur", "2026-01-01", "2026-12-31", 100_000);
    expect(unitOccupancy([old, cur], "2026-06-01")).toMatchObject({ occupied: true, currentLeaseId: "cur", currentRentCents: 100_000 });
  });
  it("ignores archived leases entirely", () => {
    const archived = unitLease("x", "2026-01-01", "2026-12-31", 100_000, { archived: true });
    const occ = unitOccupancy([archived], "2026-06-01");
    expect(occ).toMatchObject({ occupied: false, potentialRentCents: null });
    expect(occ.statuses.size).toBe(0);
  });
});

describe("occupied periods (§6.9 overlap rule)", () => {
  it("runs to the effective end date, including extensions", () => {
    expect(occupiedPeriod(lease())).toEqual({ start: "2026-01-01", end: "2026-12-31" });
    expect(occupiedPeriod(lease({ extensions: [ext] })).end).toBe("2027-12-31");
  });

  it("ends at the move-out date, whenever it falls", () => {
    expect(occupiedPeriod(lease({ moveOutDate: "2026-03-15" })).end).toBe("2026-03-15");
    expect(occupiedPeriod(lease({ moveOutDate: "2027-02-01" })).end).toBe("2027-02-01");
    expect(occupiedPeriod(lease({ moveOutDate: "2025-12-01" })).end).toBe("2026-01-01");
  });

  it("is open-ended when month-to-month without a move-out date", () => {
    expect(occupiedPeriod(lease({ monthToMonth: true })).end).toBeNull();
    expect(occupiedPeriod(lease({ monthToMonth: true, moveOutDate: "2026-05-01" })).end).toBe("2026-05-01");
  });

  it("overlaps when they share a day, not when one ends the day before the other starts", () => {
    const a = { start: "2026-01-01", end: "2026-12-31" };
    expect(periodsOverlap(a, { start: "2026-12-31", end: "2027-12-30" })).toBe(true);
    expect(periodsOverlap(a, { start: "2027-01-01", end: "2027-12-31" })).toBe(false);
    expect(periodsOverlap({ start: "2025-01-01", end: "2025-12-31" }, a)).toBe(false);
    expect(periodsOverlap({ start: "2027-06-01", end: null }, a)).toBe(false);
    expect(periodsOverlap({ start: "2026-06-01", end: null }, a)).toBe(true);
    expect(periodsOverlap({ start: "2020-01-01", end: null }, { start: "2030-01-01", end: null })).toBe(true);
  });
});
