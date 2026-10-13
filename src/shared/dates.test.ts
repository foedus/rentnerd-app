import { describe, expect, it } from "vitest";
import { addDays, addMonths, addYears, compareYmd, daysBetween, fullYearsBetween, isLeapYear, isValidYmd, todayNy, wholeMonthsBetween } from "./dates";

describe("dates", () => {
  it("knows leap years", () => {
    expect([2024, 2000, 2026, 1900, 2100].map(isLeapYear)).toEqual([true, true, false, false, false]);
  });
  it("validates calendar dates", () => {
    expect(isValidYmd("2024-02-29")).toBe(true);
    expect(isValidYmd("2026-02-29")).toBe(false);
    expect(isValidYmd("2026-13-01")).toBe(false);
    expect(isValidYmd("2026-4-01")).toBe(false);
    expect(isValidYmd("2026-04-31")).toBe(false);
  });
  it("compares", () => {
    expect([compareYmd("2026-01-01", "2026-01-02"), compareYmd("a", "a"), compareYmd("2027-01-01", "2026-12-31")]).toEqual([-1, 0, 1]);
  });
  it("adds months clamping to the last day", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonths("2026-03-31", 1)).toBe("2026-04-30");
    expect(addMonths("2026-11-15", 3)).toBe("2027-02-15");
    expect(addMonths("2026-01-15", 12)).toBe("2027-01-15");
    expect(addMonths("2026-03-15", -3)).toBe("2025-12-15");
    expect(addMonths("2026-03-31", -1)).toBe("2026-02-28");
    expect(addMonths("2026-05-10", 0)).toBe("2026-05-10");
    expect(addMonths("2026-12-31", 2)).toBe("2027-02-28");
  });
  it("adds years, Feb 29 -> Feb 28", () => {
    expect(addYears("2024-02-29", 1)).toBe("2025-02-28");
    expect(addYears("2024-02-29", 4)).toBe("2028-02-29");
    expect(addYears("2026-06-30", 2)).toBe("2028-06-30");
  });
  it("adds days across month, year and leap boundaries", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDays("2026-03-10", 0)).toBe("2026-03-10");
  });
  it("counts days between", () => {
    expect(daysBetween("2026-01-01", "2027-01-01")).toBe(365);
    expect(daysBetween("2027-01-01", "2026-01-01")).toBe(-365);
    expect(daysBetween("2028-01-01", "2029-01-01")).toBe(366);
  });
  it("counts whole months from start to the day after end (§7.7)", () => {
    expect(wholeMonthsBetween("2026-11-01", "2027-10-31")).toBe(12);
    expect(wholeMonthsBetween("2026-11-15", "2027-11-30")).toBe(12);
    expect(wholeMonthsBetween("2026-01-01", "2026-12-31")).toBe(12);
    expect(wholeMonthsBetween("2026-01-01", "2026-01-31")).toBe(1);
    expect(wholeMonthsBetween("2026-01-15", "2026-02-13")).toBe(0);
    expect(wholeMonthsBetween("2026-01-15", "2026-02-14")).toBe(1);
    expect(wholeMonthsBetween("2026-01-31", "2026-02-26")).toBe(0);
    expect(wholeMonthsBetween("2026-01-31", "2026-02-27")).toBe(1);
    expect(wholeMonthsBetween("2026-01-01", "2025-12-01")).toBe(0);
  });
  it("treats a 365-day lease as 12 months", () => {
    expect(wholeMonthsBetween("2026-03-01", addDays("2026-03-01", 364))).toBe(12);
  });
  it("counts full years with the anniversary rule", () => {
    expect(fullYearsBetween("2026-01-01", "2026-12-31")).toBe(0);
    expect(fullYearsBetween("2026-01-01", "2027-01-01")).toBe(1);
    expect(fullYearsBetween("2024-02-29", "2025-02-27")).toBe(0);
    expect(fullYearsBetween("2024-02-29", "2025-02-28")).toBe(1);
    expect(fullYearsBetween("2024-02-29", "2028-02-28")).toBe(3);
    expect(fullYearsBetween("2024-02-29", "2028-02-29")).toBe(4);
    expect(fullYearsBetween("2026-06-01", "2026-01-01")).toBe(0);
  });
  it("rejects invalid dates", () => {
    expect(() => addDays("2026-02-30", 1)).toThrow(RangeError);
  });
});

describe("todayNy", () => {
  it("uses the New York calendar day, not UTC", () => {
    expect(todayNy(new Date("2027-01-01T03:30:00Z"))).toBe("2026-12-31");
    expect(todayNy(new Date("2026-07-01T05:00:00Z"))).toBe("2026-07-01");
  });
});
