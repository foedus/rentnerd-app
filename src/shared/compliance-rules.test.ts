import { describe, expect, it } from "vitest";
import { SEEDED_COMPLIANCE_TYPES, initialDueDate, isTypeApplicable, nextAnnualOccurrence } from "./compliance-rules";

const res = { appliesTo: "Properties with residential units", nycOnly: true } as const;

describe("isTypeApplicable (§6.14)", () => {
  it("never applies to a property with no non-archived units, even for All properties", () => {
    expect(isTypeApplicable({ appliesTo: "All properties", nycOnly: false }, { inNyc: true }, [])).toBe(false);
  });
  it("matches appliesTo against unit uses", () => {
    expect(isTypeApplicable(res, { inNyc: true }, ["Residential"])).toBe(true);
    expect(isTypeApplicable(res, { inNyc: true }, ["Commercial"])).toBe(false);
    expect(isTypeApplicable({ appliesTo: "Properties with commercial units", nycOnly: false }, { inNyc: false }, ["Residential", "Commercial"])).toBe(true);
    expect(isTypeApplicable({ appliesTo: "All properties", nycOnly: false }, { inNyc: false }, ["Commercial"])).toBe(true);
  });
  it("honours nycOnly against the property's NYC flag", () => {
    expect(isTypeApplicable(res, { inNyc: false }, ["Residential"])).toBe(false);
    expect(isTypeApplicable({ ...res, nycOnly: false }, { inNyc: false }, ["Residential"])).toBe(true);
  });
});

describe("nextAnnualOccurrence / initialDueDate", () => {
  it("is on or after today", () => {
    expect(nextAnnualOccurrence(9, 1, "2026-10-15")).toBe("2027-09-01");
    expect(nextAnnualOccurrence(9, 1, "2026-09-01")).toBe("2026-09-01");
    expect(nextAnnualOccurrence(1, 15, "2026-01-14")).toBe("2026-01-15");
  });
  it("skips Feb 29 in non-leap years", () => {
    expect(nextAnnualOccurrence(2, 29, "2026-10-15")).toBe("2028-02-29");
  });
  it("schedules only annual_date types", () => {
    expect(initialDueDate({ scheduleType: "annual_date", dueMonth: 12, dueDay: 31, }, "2026-10-15")).toBe("2026-12-31");
    expect(initialDueDate({ scheduleType: "interval", dueMonth: null, dueDay: null }, "2026-10-15")).toBeNull();
    expect(initialDueDate({ scheduleType: "one_time", dueMonth: null, dueDay: null }, "2026-10-15")).toBeNull();
  });
});

describe("seeded catalog (§9.1)", () => {
  it("has the nine types with unique names", () => {
    expect(SEEDED_COMPLIANCE_TYPES).toHaveLength(9);
    expect(new Set(SEEDED_COMPLIANCE_TYPES.map((t) => t.name)).size).toBe(9);
  });
});
