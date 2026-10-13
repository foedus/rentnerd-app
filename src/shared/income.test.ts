import { describe, expect, it } from "vitest";
import { formatSharePercent, otherIncome, taxReimbursement } from "./income";

const taxes = [
  { taxYear: 2020, amountCents: 4_000_000 },
  { taxYear: 2025, amountCents: 5_200_000 },
];

describe("taxReimbursement (D-13)", () => {
  it("matches AC-LEASE-14", () => {
    expect(taxReimbursement(taxes, 2020, "25.0000")).toEqual({
      cents: 25_000,
      explanation: "25% × (2025 tax $52,000.00 − 2020 tax $40,000.00) ÷ 12",
    });
  });
  it("is $0.00 when the latest tax is lower than the base year (AC-LEASE-15)", () => {
    expect(taxReimbursement([{ taxYear: 2020, amountCents: 5_000_000 }, { taxYear: 2025, amountCents: 4_000_000 }], 2020, "25")?.cents).toBe(0);
  });
  it("is $0.00 when the base year is the latest year", () => {
    expect(taxReimbursement(taxes, 2025, "25")?.cents).toBe(0);
  });
  it("rounds once to the cent, half up", () => {
    // 33.3333% of 100,000 cents ÷ 12 = 2777.775 -> 2778
    expect(taxReimbursement([{ taxYear: 1, amountCents: 0 }, { taxYear: 2, amountCents: 100_000 }], 1, "33.3333")?.cents).toBe(2778);
  });
  it("is null without base year, share, tax years or a matching base year", () => {
    expect(taxReimbursement(taxes, null, "25")).toBeNull();
    expect(taxReimbursement(taxes, 2020, null)).toBeNull();
    expect(taxReimbursement([], 2020, "25")).toBeNull();
    expect(taxReimbursement(taxes, 2019, "25")).toBeNull();
  });
  it("formats the share without trailing zeros", () => {
    expect(formatSharePercent("12.5000")).toBe("12.5");
    expect(formatSharePercent("100")).toBe("100");
    expect(formatSharePercent("25.0000")).toBe("25");
  });
});

describe("otherIncome (§7.5)", () => {
  it("adds parking and tax reimbursement", () => {
    expect(otherIncome({ parkingChargeCents: 15_000, baseTaxYear: 2020, taxSharePercent: "25" }, taxes)).toEqual({
      parkingChargeCents: 15_000,
      taxReimbursementCents: 25_000,
      totalCents: 40_000,
    });
  });
  it("shows no tax reimbursement and no parking as zero income", () => {
    expect(otherIncome({ parkingChargeCents: null, baseTaxYear: null, taxSharePercent: null }, taxes)).toEqual({
      parkingChargeCents: 0,
      taxReimbursementCents: null,
      totalCents: 0,
    });
  });
});
