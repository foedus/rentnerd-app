import { describe, expect, it } from "vitest";
import type { OtherIncomeTerms } from "./income";
import { computeStats, currentValue, formatOccupancy, formatYield, propertyValue, yieldNote, type StatLease, type StatProperty } from "./stats";

const today = "2026-06-15";
const none: OtherIncomeTerms = { parkingChargeCents: null, baseTaxYear: null, taxSharePercent: null };
const lease = (id: string, rentCents: number, start: string, end: string, other: OtherIncomeTerms = none, over: Partial<StatLease> = {}): StatLease => ({
  id,
  master: { startDate: start, endDate: end, rentCents, increaseType: "none" },
  extensions: [],
  monthToMonth: false,
  monthToMonthRentCents: null,
  moveOutDate: null,
  otherIncomeByTermStart: { [start]: other },
  ...over,
});
const property = (over: Partial<StatProperty> = {}): StatProperty => ({ purchasePriceCents: null, values: [], taxes: [], units: [], ...over });

describe("propertyValue (D-15)", () => {
  it("uses the latest market estimate, ignoring assessed values", () => {
    expect(
      propertyValue({
        purchasePriceCents: 100,
        values: [
          { valueDate: "2024-01-01", kind: "market_estimate", amountCents: 500 },
          { valueDate: "2025-01-01", kind: "market_estimate", amountCents: 600 },
          { valueDate: "2026-01-01", kind: "assessed", amountCents: 50 },
        ],
      }),
    ).toBe(600);
  });
  it("falls back to the purchase price, then null", () => {
    expect(propertyValue({ purchasePriceCents: 100, values: [{ valueDate: "2026-01-01", kind: "assessed", amountCents: 50 }] })).toBe(100);
    expect(propertyValue({ purchasePriceCents: null, values: [] })).toBeNull();
  });
});

describe("computeStats (§7.6)", () => {
  const p = property({
    purchasePriceCents: 100_000_000,
    taxes: [{ taxYear: 2020, amountCents: 4_000_000 }, { taxYear: 2025, amountCents: 5_200_000 }],
    units: [
      { leases: [lease("a", 200_000, "2026-01-01", "2026-12-31", { parkingChargeCents: 15_000, baseTaxYear: 2020, taxSharePercent: "25" })] },
      { leases: [lease("b", 100_000, "2025-01-01", "2025-12-31", none, { monthToMonth: true, monthToMonthRentCents: 110_000 })] },
      { leases: [lease("old", 90_000, "2024-01-01", "2024-12-31", none, { moveOutDate: "2024-12-31" })] },
      { leases: [] },
    ],
  });
  it("counts units, occupancy, rent roll, other income and vacancy loss", () => {
    const s = computeStats([p], today);
    expect(s).toMatchObject({
      units: 4,
      occupied: 2,
      vacant: 2,
      occupancyTenths: 500,
      monthlyRentRollCents: 310_000,
      annualRentRollCents: 3_720_000,
      monthlyOtherIncomeCents: 40_000,
      vacancyLossCents: 90_000,
      valueCents: 100_000_000,
    });
    // 12 × 350,000 ÷ 100,000,000 = 4.2%
    expect(s.grossYieldHundredths).toBe(420);
  });
  it("ignores archived leases", () => {
    const s = computeStats([property({ units: [{ leases: [lease("x", 100_000, "2026-01-01", "2026-12-31", none, { archived: true })] }] })], today);
    expect(s).toMatchObject({ occupied: 0, vacant: 1, monthlyRentRollCents: 0, vacancyLossCents: 0 });
  });
  it("uses the current term's other income", () => {
    const l = lease("e", 100_000, "2025-01-01", "2025-12-31", { parkingChargeCents: 10_000, baseTaxYear: null, taxSharePercent: null }, {
      extensions: [{ startDate: "2026-01-01", endDate: "2026-12-31", rentCents: 100_000, increaseType: "none" }],
      otherIncomeByTermStart: {
        "2025-01-01": { parkingChargeCents: 10_000, baseTaxYear: null, taxSharePercent: null },
        "2026-01-01": { parkingChargeCents: 20_000, baseTaxYear: null, taxSharePercent: null },
      },
    });
    expect(computeStats([property({ units: [{ leases: [l] }] })], today).monthlyOtherIncomeCents).toBe(20_000);
  });
  it("has no occupancy or yield without units or value", () => {
    const s = computeStats([property()], today);
    expect(s).toMatchObject({ units: 0, occupancyTenths: null, valueCents: null, grossYieldHundredths: null });
  });
  it("counts only properties with a value in the portfolio yield", () => {
    const valued = property({ purchasePriceCents: 120_000_000, units: [{ leases: [lease("v", 100_000, "2026-01-01", "2026-12-31")] }] });
    const unvalued = property({ units: [{ leases: [lease("u", 500_000, "2026-01-01", "2026-12-31")] }] });
    const s = computeStats([valued, unvalued], today);
    expect(s.valueCents).toBe(120_000_000);
    expect(s.monthlyRentRollCents).toBe(600_000);
    expect(s.grossYieldHundredths).toBe(100);
    expect(yieldNote(s)).toBe("Based on 1 of 2 properties with a value.");
  });
  it("formats", () => {
    expect(formatOccupancy(667)).toBe("66.7%");
    expect(formatOccupancy(null)).toBe("—");
    expect(formatYield(525)).toBe("5.25%");
    expect(formatYield(null)).toBe("—");
  });
});

describe("currentValue", () => {
  const v = (valueDate: string, kind: "market_estimate" | "assessed", amountCents: number) => ({ valueDate, kind, amountCents });
  it("uses the latest market estimate and names its date", () => {
    const r = currentValue({ purchasePriceCents: 70_000_000, values: [v("2026-06-01", "market_estimate", 95_000_000), v("2026-01-01", "market_estimate", 90_000_000), v("2026-09-01", "assessed", 30_000_000)] });
    expect(r).toEqual({ amountCents: 95_000_000, basis: { kind: "market_estimate", date: "2026-06-01" } });
  });
  it("falls back to the purchase price, ignoring assessed values", () => {
    expect(currentValue({ purchasePriceCents: 70_000_000, values: [v("2026-02-01", "assessed", 30_000_000)] })).toEqual({ amountCents: 70_000_000, basis: { kind: "purchase_price" } });
  });
  it("is null with neither", () => {
    expect(currentValue({ purchasePriceCents: null, values: [] })).toBeNull();
  });
});
