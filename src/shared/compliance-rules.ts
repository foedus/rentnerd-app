import { compareYmd, isValidYmd } from "./dates";

export const COMPLIANCE_APPLIES_TO = ["All properties", "Properties with residential units", "Properties with commercial units"] as const;
export type ComplianceAppliesTo = (typeof COMPLIANCE_APPLIES_TO)[number];
export type ComplianceScheduleType = "annual_date" | "interval" | "one_time";
export type UnitUse = "Residential" | "Commercial";

export type ComplianceRuleType = { appliesTo: ComplianceAppliesTo; nycOnly: boolean };

/**
 * SPEC §6.14: whether an item type applies to a property. Only non-archived units count, so a property
 * with no units matches nothing, not even "All properties".
 */
export function isTypeApplicable(type: ComplianceRuleType, property: { inNyc: boolean }, unitUses: readonly UnitUse[]): boolean {
  if (unitUses.length === 0) return false;
  if (type.nycOnly && !property.inNyc) return false;
  if (type.appliesTo === "Properties with residential units") return unitUses.includes("Residential");
  if (type.appliesTo === "Properties with commercial units") return unitUses.includes("Commercial");
  return true;
}

/** The first date on or after `today` that falls on the given month and day (§6.14). Feb 29 is skipped in non-leap years. */
export function nextAnnualOccurrence(month: number, day: number, today: string): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const year = Number(today.slice(0, 4));
  for (let y = year; y <= year + 8; y++) {
    const candidate = `${y}-${pad(month)}-${pad(day)}`;
    if (isValidYmd(candidate) && compareYmd(candidate, today) >= 0) return candidate;
  }
  throw new Error(`No occurrence of ${month}/${day} after ${today}`);
}

/** nextDueDate for an item that has just become applicable and has none: annual types start at the next occurrence, others stay unscheduled. */
export function initialDueDate(type: { scheduleType: ComplianceScheduleType; dueMonth: number | null; dueDay: number | null }, today: string): string | null {
  if (type.scheduleType !== "annual_date" || type.dueMonth === null || type.dueDay === null) return null;
  return nextAnnualOccurrence(type.dueMonth, type.dueDay, today);
}

export type SeededComplianceType = {
  name: string;
  appliesTo: ComplianceAppliesTo;
  nycOnly: boolean;
} & ({ scheduleType: "annual_date"; dueMonth: number; dueDay: number } | { scheduleType: "interval"; intervalMonths: number });

const RES = "Properties with residential units";
/** SPEC §9.1. */
export const SEEDED_COMPLIANCE_TYPES: readonly SeededComplianceType[] = [
  { name: "HPD Property Registration", appliesTo: RES, nycOnly: true, scheduleType: "annual_date", dueMonth: 9, dueDay: 1 },
  { name: "Bed Bug Annual Filing", appliesTo: RES, nycOnly: true, scheduleType: "annual_date", dueMonth: 12, dueDay: 31 },
  { name: "Window Guard Annual Notice", appliesTo: RES, nycOnly: true, scheduleType: "annual_date", dueMonth: 1, dueDay: 15 },
  { name: "Lead-Based Paint Annual Notice", appliesTo: RES, nycOnly: true, scheduleType: "annual_date", dueMonth: 1, dueDay: 15 },
  { name: "Stove Knob Cover Annual Notice", appliesTo: RES, nycOnly: true, scheduleType: "annual_date", dueMonth: 1, dueDay: 15 },
  { name: "Smoke and CO Detector Check", appliesTo: RES, nycOnly: false, scheduleType: "interval", intervalMonths: 12 },
  { name: "Storefront Registry Filing", appliesTo: "Properties with commercial units", nycOnly: true, scheduleType: "annual_date", dueMonth: 6, dueDay: 1 },
  { name: "Boiler Inspection", appliesTo: "All properties", nycOnly: true, scheduleType: "interval", intervalMonths: 12 },
  { name: "Gas Piping Inspection (Local Law 152)", appliesTo: "All properties", nycOnly: true, scheduleType: "interval", intervalMonths: 48 },
];

export const COMPLIANCE_SCHEDULE_LABELS: Record<ComplianceScheduleType, string> = { annual_date: "Same date every year", interval: "Every N months after completion", one_time: "One time" };
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;
export { MONTH_NAMES };

/** How the Item types table words a schedule, e.g. "Every year on September 1" or "Every 12 months". */
export function describeSchedule(t: { scheduleType: ComplianceScheduleType; dueMonth: number | null; dueDay: number | null; intervalMonths: number | null }): string {
  if (t.scheduleType === "annual_date") return t.dueMonth && t.dueDay ? `Every year on ${MONTH_NAMES[t.dueMonth - 1]} ${t.dueDay}` : "Every year";
  if (t.scheduleType === "interval") return t.intervalMonths === 1 ? "Every month" : `Every ${t.intervalMonths} months`;
  return "One time";
}
