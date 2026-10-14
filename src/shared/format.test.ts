import { describe, expect, it } from "vitest";
import { formatCents, formatDate, formatDateTime, pageCount, parseMoneyToCents } from "./format";

describe("parseMoneyToCents leading and trailing points", () => {
  it.each([[".50", 50], ["$.5", 50], ["5.", 500], ["1,000.", 100000]] as const)("accepts %s", (text, cents) => expect(parseMoneyToCents(text)).toBe(cents));
  it.each([".", "$.", "", "..5", ".123"])("refuses %j", (text) => expect(parseMoneyToCents(text)).toBeNull());
});

describe("parseMoneyToCents", () => {
  it.each([
    ["2150", 215000],
    ["2,150", 215000],
    ["2150.00", 215000],
    ["$2,150.00", 215000],
    [" 2150.5 ", 215050],
    ["0.07", 7],
    ["1,234,567.89", 123456789],
  ])("accepts %s", (text, cents) => expect(parseMoneyToCents(text)).toBe(cents));
  it.each(["", "abc", "21,50", "2150.123", "-5", "1,2345", "$", "1e3"])("rejects %j", (text) =>
    expect(parseMoneyToCents(text)).toBeNull(),
  );
});

describe("formatCents", () => {
  it("formats dollars with grouping", () => {
    expect(formatCents(215000)).toBe("$2,150.00");
    expect(formatCents(5)).toBe("$0.05");
    expect(formatCents(123456789)).toBe("$1,234,567.89");
    expect(formatCents(-150)).toBe("-$1.50");
  });
});

describe("dates", () => {
  it("formats calendar dates without shifting", () => {
    expect(formatDate("2027-01-05")).toBe("Jan 5, 2027");
    expect(formatDate("2027-12-31")).toBe("Dec 31, 2027");
    expect(formatDate("nonsense")).toBe("nonsense");
  });
  it("formats instants in New York time", () => {
    expect(formatDateTime("2027-01-05T03:30:00Z")).toBe("Jan 4, 2027, 10:30 PM");
    expect(formatDateTime("2027-07-05T03:30:00Z")).toBe("Jul 4, 2027, 11:30 PM");
    expect(formatDateTime("bad")).toBe("");
  });
});

describe("pageCount", () => {
  it("is at least 1", () => {
    expect(pageCount(0, 50)).toBe(1);
    expect(pageCount(50, 50)).toBe(1);
    expect(pageCount(51, 50)).toBe(2);
  });
});
