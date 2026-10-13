import { describe, expect, it } from "vitest";
import { compoundedRent, percentOfCents, rentInEffect, rentSchedule, type RentTerm } from "./rent";

const pct = (rentCents: number, p: string, startDate = "2026-01-01", endDate = "2028-12-31"): RentTerm => ({
  startDate, endDate, rentCents, increaseType: "percent", increasePercent: p,
});

describe("percentOfCents (half up)", () => {
  it("rounds .5 up and below .5 down", () => {
    expect(percentOfCents(100_050, "1")).toBe(1_001); // 1000.5 -> 1001
    expect(percentOfCents(100_040, "1")).toBe(1_000); // 1000.4
    expect(percentOfCents(50, "1")).toBe(1); // 0.5
    expect(percentOfCents(49, "1")).toBe(0);
    expect(percentOfCents(200_000, "3.0000")).toBe(6_000);
    expect(percentOfCents(123_457, "2.5")).toBe(3_086); // 3086.425
    expect(percentOfCents(0, "5")).toBe(0);
  });
  it("accepts four decimals and rejects junk", () => {
    expect(percentOfCents(100_000_000, "0.0001")).toBe(100);
    expect(() => percentOfCents(1, "abc")).toThrow(RangeError);
    expect(() => percentOfCents(1, "-3")).toThrow(RangeError);
  });
});

describe("compoundedRent", () => {
  it("compounds with rounding each year (AC-LEASE-06)", () => {
    expect(compoundedRent(200_000, "3", 0)).toBe(200_000);
    expect(compoundedRent(200_000, "3", 1)).toBe(206_000);
    expect(compoundedRent(200_000, "3", 2)).toBe(212_180);
  });
  it("rounds each year, not only at the end", () => {
    // 100_001 * 1.5 = 150_001.5 -> 150_002 ; then *1.5 ... differs from rounding once
    expect(compoundedRent(1_001, "1.5", 1)).toBe(1_016); // 1016.015
    expect(compoundedRent(1_001, "1.5", 2)).toBe(1_031); // 1016*1.015 = 1031.24
  });
});

describe("rentInEffect", () => {
  it("none: base rent always", () => {
    const t: RentTerm = { startDate: "2026-01-01", endDate: "2026-12-31", rentCents: 150_000, increaseType: "none" };
    expect(rentInEffect(t, "2026-06-01")).toBe(150_000);
    expect(rentInEffect(t, "2030-06-01")).toBe(150_000);
  });
  it("percent: steps on each anniversary of the term start", () => {
    const t = pct(200_000, "3");
    expect(rentInEffect(t, "2025-12-31")).toBe(200_000);
    expect(rentInEffect(t, "2026-12-31")).toBe(200_000);
    expect(rentInEffect(t, "2027-01-01")).toBe(206_000);
    expect(rentInEffect(t, "2028-01-01")).toBe(212_180);
  });
  it("percent: Feb 29 start uses Feb 28 in non-leap years", () => {
    const t = pct(100_000, "10", "2024-02-29", "2027-02-28");
    expect(rentInEffect(t, "2025-02-27")).toBe(100_000);
    expect(rentInEffect(t, "2025-02-28")).toBe(110_000);
    expect(rentInEffect(t, "2028-02-28")).toBe(133_100);
  });
  it("schedule: latest step on or before the date, else base", () => {
    const t: RentTerm = {
      startDate: "2026-01-01", endDate: "2027-12-31", rentCents: 100_000, increaseType: "schedule",
      steps: [{ effectiveDate: "2027-01-01", amountCents: 120_000 }, { effectiveDate: "2026-07-01", amountCents: 110_000 }],
    };
    expect(rentInEffect(t, "2026-06-30")).toBe(100_000);
    expect(rentInEffect(t, "2026-07-01")).toBe(110_000);
    expect(rentInEffect(t, "2026-12-31")).toBe(110_000);
    expect(rentInEffect(t, "2027-01-01")).toBe(120_000);
  });
  it("schedule with no steps is the base rent", () => {
    expect(rentInEffect({ startDate: "2026-01-01", endDate: "2026-12-31", rentCents: 5, increaseType: "schedule", steps: [] }, "2026-05-05")).toBe(5);
  });
});

describe("rentSchedule", () => {
  it("none: one period", () => {
    expect(rentSchedule({ startDate: "2026-01-01", endDate: "2026-12-31", rentCents: 1, increaseType: "none" }))
      .toEqual([{ periodStart: "2026-01-01", periodEnd: "2026-12-31", rentCents: 1 }]);
  });
  it("percent: one row per year (AC-LEASE-06)", () => {
    expect(rentSchedule(pct(200_000, "3"))).toEqual([
      { periodStart: "2026-01-01", periodEnd: "2026-12-31", rentCents: 200_000 },
      { periodStart: "2027-01-01", periodEnd: "2027-12-31", rentCents: 206_000 },
      { periodStart: "2028-01-01", periodEnd: "2028-12-31", rentCents: 212_180 },
    ]);
  });
  it("percent: a partial last year ends at the term end; a short term is one row", () => {
    expect(rentSchedule(pct(100_000, "10", "2026-03-15", "2027-06-30"))).toEqual([
      { periodStart: "2026-03-15", periodEnd: "2027-03-14", rentCents: 100_000 },
      { periodStart: "2027-03-15", periodEnd: "2027-06-30", rentCents: 110_000 },
    ]);
    expect(rentSchedule(pct(100_000, "10", "2026-03-15", "2026-09-30"))).toHaveLength(1);
  });
  it("percent: Feb 29 start", () => {
    const rows = rentSchedule(pct(100_000, "10", "2024-02-29", "2026-02-28"));
    expect(rows.map((r) => [r.periodStart, r.periodEnd])).toEqual([
      ["2024-02-29", "2025-02-27"],
      ["2025-02-28", "2026-02-27"],
      ["2026-02-28", "2026-02-28"],
    ]);
  });
  it("schedule: base rent until the first step, then one row per step", () => {
    const t: RentTerm = {
      startDate: "2026-01-01", endDate: "2027-12-31", rentCents: 100_000, increaseType: "schedule",
      steps: [{ effectiveDate: "2027-01-01", amountCents: 120_000 }, { effectiveDate: "2026-07-01", amountCents: 110_000 }],
    };
    expect(rentSchedule(t)).toEqual([
      { periodStart: "2026-01-01", periodEnd: "2026-06-30", rentCents: 100_000 },
      { periodStart: "2026-07-01", periodEnd: "2026-12-31", rentCents: 110_000 },
      { periodStart: "2027-01-01", periodEnd: "2027-12-31", rentCents: 120_000 },
    ]);
  });
  it("schedule: a step on the start date replaces the base; steps after the end are ignored; duplicate dates use the later row", () => {
    const t: RentTerm = {
      startDate: "2026-01-01", endDate: "2026-12-31", rentCents: 100_000, increaseType: "schedule",
      steps: [
        { effectiveDate: "2026-01-01", amountCents: 105_000 },
        { effectiveDate: "2026-06-01", amountCents: 110_000 },
        { effectiveDate: "2026-06-01", amountCents: 111_000 },
        { effectiveDate: "2027-01-01", amountCents: 999_000 },
      ],
    };
    expect(rentSchedule(t)).toEqual([
      { periodStart: "2026-01-01", periodEnd: "2026-05-31", rentCents: 105_000 },
      { periodStart: "2026-06-01", periodEnd: "2026-12-31", rentCents: 111_000 },
    ]);
  });
  it("agrees with rentInEffect on every period start", () => {
    const t = pct(123_457, "2.5", "2026-03-15", "2030-03-14");
    for (const row of rentSchedule(t)) expect(rentInEffect(t, row.periodStart)).toBe(row.rentCents);
  });
  it("an inverted term has no periods", () => {
    expect(rentSchedule({ startDate: "2026-02-01", endDate: "2026-01-01", rentCents: 1, increaseType: "none" })).toEqual([]);
  });
});
