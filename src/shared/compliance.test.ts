import { describe, expect, it } from "vitest";
import { complianceStatus, latestReachedThreshold, reminderToSend, suggestNextDueDate } from "./compliance";

const base = { applicable: true, scheduleType: "annual_date" as const, nextDueDate: null, completionCount: 0 };

describe("complianceStatus", () => {
  const today = "2026-06-15";
  it("applies the rules in order", () => {
    expect(complianceStatus({ ...base, applicable: false, nextDueDate: "2026-01-01" }, today)).toBe("Not applicable");
    expect(complianceStatus({ ...base, applicable: false, scheduleType: "one_time", completionCount: 1 }, today)).toBe("Not applicable");
    expect(complianceStatus({ ...base, scheduleType: "one_time", completionCount: 1 }, today)).toBe("Completed");
    expect(complianceStatus({ ...base, scheduleType: "one_time", completionCount: 0 }, today)).toBe("Not scheduled");
    expect(complianceStatus({ ...base, scheduleType: "one_time", completionCount: 1, nextDueDate: "2026-07-01" }, today)).toBe("Due soon");
    expect(complianceStatus({ ...base, scheduleType: "interval", completionCount: 3 }, today)).toBe("Not scheduled");
  });
  it("splits overdue, due soon and upcoming at today and 30 days", () => {
    expect(complianceStatus({ ...base, nextDueDate: "2026-06-14" }, today)).toBe("Overdue");
    expect(complianceStatus({ ...base, nextDueDate: "2026-06-15" }, today)).toBe("Due soon");
    expect(complianceStatus({ ...base, nextDueDate: "2026-07-15" }, today)).toBe("Due soon");
    expect(complianceStatus({ ...base, nextDueDate: "2026-07-16" }, today)).toBe("Upcoming");
  });
});

describe("suggestNextDueDate", () => {
  const annual = { scheduleType: "annual_date" as const, dueMonth: 9, dueDay: 1, intervalMonths: null, nextDueDate: "2026-09-01" };
  it("adds a year to the current due date", () => {
    expect(suggestNextDueDate(annual, "2026-08-20")).toBe("2027-09-01");
  });
  it("repeats until after the completion date", () => {
    expect(suggestNextDueDate({ ...annual, nextDueDate: "2022-09-01" }, "2026-06-15")).toBe("2026-09-01");
    expect(suggestNextDueDate({ ...annual, nextDueDate: "2022-09-01" }, "2026-09-01")).toBe("2027-09-01");
  });
  it("uses the next month/day after the completion date when unscheduled", () => {
    expect(suggestNextDueDate({ ...annual, nextDueDate: null }, "2026-06-15")).toBe("2026-09-01");
    expect(suggestNextDueDate({ ...annual, nextDueDate: null }, "2026-09-01")).toBe("2027-09-01");
  });
  it("keeps Feb 29 on the last day of February in non-leap years", () => {
    expect(suggestNextDueDate({ ...annual, nextDueDate: "2024-02-29" }, "2024-03-01")).toBe("2025-02-28");
  });
  it("adds the interval to the completion date", () => {
    const interval = { scheduleType: "interval" as const, dueMonth: null, dueDay: null, intervalMonths: 48, nextDueDate: "2020-01-01" };
    expect(suggestNextDueDate(interval, "2026-01-31")).toBe("2030-01-31");
    expect(suggestNextDueDate({ ...interval, intervalMonths: 12 }, "2024-02-29")).toBe("2025-02-28");
  });
  it("suggests nothing for one-time items", () => {
    expect(suggestNextDueDate({ ...annual, scheduleType: "one_time" }, "2026-06-15")).toBeNull();
  });
});

describe("latestReachedThreshold", () => {
  const due = "2026-09-01";
  const at = (kind: Parameters<typeof latestReachedThreshold>[0], offset: number) =>
    latestReachedThreshold(kind, due, new Date(Date.UTC(2026, 8, 1 + offset)).toISOString().slice(0, 10));
  it("compliance: 30 and 7 days before, the due date, then every 7 days overdue", () => {
    expect([-31, -30, -8, -7, -1, 0, 6, 7, 13, 14, 22].map((o) => at("compliance", o))).toEqual([null, -30, -30, -7, -7, 0, 0, 7, 7, 14, 21]);
  });
  it("lease ending: 90, 60 and 30 days before", () => {
    expect([-91, -90, -61, -60, -31, -30, -1].map((o) => at("lease_end", o))).toEqual([null, -90, -90, -60, -60, -30, -30]);
  });
  it("needs decision: 1 day after, then every 7 days", () => {
    expect([0, 1, 7, 8, 14, 15].map((o) => at("needs_decision", o))).toEqual([null, 1, 1, 8, 8, 15]);
  });
});

describe("reminderToSend (catch-up)", () => {
  it("sends the latest reached threshold once", () => {
    expect(reminderToSend("compliance", "2026-09-01", "2026-08-02", [])).toBe(-30);
    expect(reminderToSend("compliance", "2026-09-01", "2026-08-02", [-30])).toBeNull();
  });
  it("catches up a missed threshold day on the next run, without resending older ones", () => {
    expect(reminderToSend("compliance", "2026-09-01", "2026-08-27", [-30])).toBe(-7);
    expect(reminderToSend("compliance", "2026-09-01", "2026-09-10", [-30, -7])).toBe(7);
    expect(reminderToSend("compliance", "2026-09-01", "2026-09-10", [7])).toBeNull();
  });
  it("sends nothing before the first threshold", () => {
    expect(reminderToSend("lease_end", "2026-12-31", "2026-09-01", [])).toBeNull();
  });
});
