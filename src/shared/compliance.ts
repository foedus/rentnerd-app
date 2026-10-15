import type { ComplianceScheduleType } from "./compliance-rules";
import { nextAnnualOccurrence } from "./compliance-rules";
import { addDays, addMonths, addYears, compareYmd, daysBetween } from "./dates";

export const COMPLIANCE_STATUSES = ["Not applicable", "Completed", "Not scheduled", "Overdue", "Due soon", "Upcoming"] as const;
export type ComplianceStatus = (typeof COMPLIANCE_STATUSES)[number];

export type ComplianceStatusInput = {
  applicable: boolean;
  scheduleType: ComplianceScheduleType;
  nextDueDate: string | null;
  completionCount: number;
};

/** SPEC §9.2: the first matching rule wins. */
export function complianceStatus(item: ComplianceStatusInput, today: string): ComplianceStatus {
  if (!item.applicable) return "Not applicable";
  if (item.scheduleType === "one_time" && item.completionCount > 0 && item.nextDueDate === null) return "Completed";
  if (item.nextDueDate === null) return "Not scheduled";
  if (compareYmd(item.nextDueDate, today) < 0) return "Overdue";
  if (daysBetween(today, item.nextDueDate) <= 30) return "Due soon";
  return "Upcoming";
}

export type NextDueSuggestionInput = {
  scheduleType: ComplianceScheduleType;
  dueMonth: number | null;
  dueDay: number | null;
  intervalMonths: number | null;
  nextDueDate: string | null;
};

/** SPEC §9.3: the next due date Mark done suggests (the user may edit it), or null when there is none. */
export function suggestNextDueDate(item: NextDueSuggestionInput, completedOn: string): string | null {
  if (item.scheduleType === "one_time") return null;
  if (item.scheduleType === "interval") return item.intervalMonths === null ? null : addMonths(completedOn, item.intervalMonths);
  if (item.nextDueDate !== null) {
    let years = 1;
    while (compareYmd(addYears(item.nextDueDate, years), completedOn) <= 0) years++;
    return addYears(item.nextDueDate, years);
  }
  if (item.dueMonth === null || item.dueDay === null) return null;
  return nextAnnualOccurrence(item.dueMonth, item.dueDay, addDays(completedOn, 1));
}

export type ReminderKind = "compliance" | "lease_end" | "needs_decision";

/**
 * SPEC §10.5: a threshold is stored as whole days relative to the due or end date (negative = before it).
 * Compliance: -30, -7, 0, then 7, 14, 21… Lease ending: -90, -60, -30. Needs decision: 1, 8, 15…
 */
export function latestReachedThreshold(kind: ReminderKind, dueDate: string, today: string): number | null {
  const offset = daysBetween(dueDate, today);
  if (kind === "compliance") {
    if (offset < -30) return null;
    if (offset < -7) return -30;
    if (offset < 0) return -7;
    return Math.floor(offset / 7) * 7;
  }
  if (kind === "lease_end") {
    if (offset < -90) return null;
    if (offset < -60) return -90;
    if (offset < -30) return -60;
    return -30;
  }
  if (offset < 1) return null;
  return 1 + Math.floor((offset - 1) / 7) * 7;
}

/**
 * Catch-up rule: include the item when its latest reached threshold has no log row for the recipient.
 * Returns that threshold, or null when nothing is due.
 */
export function reminderToSend(kind: ReminderKind, dueDate: string, today: string, loggedThresholds: readonly number[]): number | null {
  const threshold = latestReachedThreshold(kind, dueDate, today);
  return threshold === null || loggedThresholds.includes(threshold) ? null : threshold;
}
