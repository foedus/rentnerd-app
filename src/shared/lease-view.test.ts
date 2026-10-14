import { describe, expect, it } from "vitest";
import { currentTermSource, leaseRentSchedule, leaseSummary, leaseTermsOf, type LeaseShape } from "./lease-view";

const base: LeaseShape = {
  id: "l1", startDate: "2026-01-01", endDate: "2028-12-31", baseRentCents: 200000, increaseType: "percent", increasePercent: 3, rentSteps: [],
  monthToMonth: false, monthToMonthRentCents: null, moveOutDate: null, extensions: [],
};
const ext = { id: "e1", startDate: "2029-01-01", endDate: "2029-12-31", baseRentCents: 225000, increaseType: "none" as const, increasePercent: null, rentSteps: [] };

describe("lease view", () => {
  it("builds the rent schedule from the master term (AC-LEASE-06)", () => {
    expect(leaseRentSchedule(base).map((r) => [r.periodStart, r.rentCents, r.term])).toEqual([
      ["2026-01-01", 200000, "Master lease"], ["2027-01-01", 206000, "Master lease"], ["2028-01-01", 212180, "Master lease"],
    ]);
  });
  it("appends extension periods", () => {
    const rows = leaseRentSchedule({ ...base, extensions: [ext] });
    expect(rows.at(-1)).toEqual({ periodStart: "2029-01-01", periodEnd: "2029-12-31", rentCents: 225000, term: "Extension" });
  });
  it("uses rent steps for a custom schedule", () => {
    const l: LeaseShape = { ...base, increaseType: "schedule", increasePercent: null, rentSteps: [{ effectiveDate: "2026-07-01", amountCents: 210000 }] };
    expect(leaseRentSchedule(l).map((r) => r.rentCents)).toEqual([200000, 210000]);
    expect(leaseTermsOf(l).master).toMatchObject({ increaseType: "schedule" });
  });
  it("summarises effective end and current rent", () => {
    const l = { ...base, extensions: [ext] };
    expect(leaseSummary(l, "2027-06-01")).toEqual({ effectiveEndDate: "2029-12-31", currentRentCents: 206000 });
    expect(leaseSummary(l, "2029-03-01").currentRentCents).toBe(225000);
  });
  it("picks the current term source (§3)", () => {
    const l = { ...base, extensions: [ext] };
    expect(currentTermSource(l, "2027-01-01")).toBe(l);
    expect(currentTermSource(l, "2029-06-01")).toBe(l.extensions[0]);
    expect(currentTermSource(l, "2031-01-01")).toBe(l.extensions[0]);
    expect(currentTermSource(l, "2020-01-01")).toBe(l);
  });
});
