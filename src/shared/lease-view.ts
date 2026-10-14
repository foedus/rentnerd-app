/** Derived lease values for the read API: terms, status, current term values and rent schedule (SPEC §3, §7, D-32). */
import { currentTerm, leaseRentOn, orderedTerms, effectiveEndDate, type LeaseTerms, type UnitLease } from "./lease";
import { rentSchedule, type RentPeriod, type RentStep, type RentTerm } from "./rent";

interface TermShape {
  startDate: string;
  endDate: string;
  baseRentCents: number;
  increaseType: "none" | "percent" | "schedule";
  increasePercent: number | null;
  rentSteps: readonly RentStep[];
}

/** A lease as the API presents it (master fields, rent steps and extensions). */
export interface LeaseShape extends TermShape {
  id: string;
  monthToMonth: boolean;
  monthToMonthRentCents: number | null;
  moveOutDate: string | null;
  extensions: readonly (TermShape & { id: string })[];
}

export function rentTermOf(t: TermShape): RentTerm {
  const base = { startDate: t.startDate, endDate: t.endDate, rentCents: t.baseRentCents };
  if (t.increaseType === "percent") return { ...base, increaseType: "percent", increasePercent: String(t.increasePercent ?? 0) };
  if (t.increaseType === "schedule") return { ...base, increaseType: "schedule", steps: t.rentSteps };
  return { ...base, increaseType: "none" };
}

export function leaseTermsOf(l: LeaseShape): UnitLease {
  return {
    id: l.id,
    master: rentTermOf(l),
    extensions: l.extensions.map(rentTermOf),
    monthToMonth: l.monthToMonth,
    monthToMonthRentCents: l.monthToMonthRentCents,
    moveOutDate: l.moveOutDate,
  };
}

export interface ScheduleRow extends RentPeriod {
  term: "Master lease" | "Extension";
}

/** §7.3 and §11 "Rent schedule": every period of the master term, then of each extension. */
export function leaseRentSchedule(l: LeaseShape): ScheduleRow[] {
  return orderedTerms(leaseTermsOf(l)).flatMap((t, i): ScheduleRow[] => rentSchedule(t).map((p) => ({ ...p, term: i === 0 ? "Master lease" : "Extension" })));
}

/** The term whose tenants, other income and special terms are the lease's "current" values (§3). */
export function currentTermSource<L extends LeaseShape>(l: L, on: string): L | L["extensions"][number] {
  const term = currentTerm(leaseTermsOf(l), on);
  return l.extensions.find((e) => e.startDate === term.startDate && e.endDate === term.endDate) ?? l;
}

export function leaseSummary(l: LeaseShape, on: string) {
  const terms: LeaseTerms = leaseTermsOf(l);
  return { effectiveEndDate: effectiveEndDate(terms), currentRentCents: leaseRentOn(terms, on) };
}
