/** Rent in effect and rent schedule for one term (SPEC §7.1, §7.3, D-12). Money is integer cents. */
import { addDays, addYears, fullYearsBetween } from "./dates";

export interface RentStep {
  effectiveDate: string;
  amountCents: number;
}

export type RentTerm =
  | { startDate: string; endDate: string; rentCents: number; increaseType: "none" }
  | { startDate: string; endDate: string; rentCents: number; increaseType: "percent"; increasePercent: string }
  | { startDate: string; endDate: string; rentCents: number; increaseType: "schedule"; steps: readonly RentStep[] };

export interface RentPeriod {
  periodStart: string;
  periodEnd: string;
  rentCents: number;
}

const PERCENT = /^(\d+)(?:\.(\d{1,4}))?$/;

/** Divide and round half up (non-negative operands). */
function divRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (2n * numerator + denominator) / (2n * denominator);
}

/** cents × percent/100, rounded to the cent half up; percent is a decimal string like "3.0000". */
export function percentOfCents(cents: number, percent: string): number {
  const m = PERCENT.exec(percent.trim());
  if (!m) throw new RangeError(`Not a percentage: ${percent}`);
  const scaled = BigInt(m[1]! + (m[2] ?? "").padEnd(4, "0"));
  return Number(divRoundHalfUp(BigInt(cents) * scaled, 1_000_000n));
}

/** Rent after k compounded increases, rounded to the cent each year. */
export function compoundedRent(baseCents: number, percent: string, years: number): number {
  let rent = baseCents;
  for (let i = 0; i < years; i += 1) rent += percentOfCents(rent, percent);
  return rent;
}

function sortedSteps(steps: readonly RentStep[]): RentStep[] {
  // Stable sort: for equal dates the later row wins when scanning in order.
  return steps.map((s, i) => ({ s, i })).sort((a, b) => a.s.effectiveDate.localeCompare(b.s.effectiveDate) || a.i - b.i).map(({ s }) => s);
}

export function rentInEffect(term: RentTerm, on: string): number {
  switch (term.increaseType) {
    case "none":
      return term.rentCents;
    case "percent":
      return compoundedRent(term.rentCents, term.increasePercent, fullYearsBetween(term.startDate, on));
    case "schedule": {
      let rent = term.rentCents;
      for (const step of sortedSteps(term.steps)) if (step.effectiveDate <= on) rent = step.amountCents;
      return rent;
    }
  }
}

/** Consecutive periods covering the whole term; empty when the term has no days. */
export function rentSchedule(term: RentTerm): RentPeriod[] {
  const { startDate, endDate } = term;
  if (endDate < startDate) return [];
  if (term.increaseType === "none") return [{ periodStart: startDate, periodEnd: endDate, rentCents: term.rentCents }];
  if (term.increaseType === "percent") {
    const periods: RentPeriod[] = [];
    let rent = term.rentCents;
    for (let k = 0; ; k += 1) {
      const periodStart = addYears(startDate, k);
      if (periodStart > endDate) return periods;
      const nextStart = addYears(startDate, k + 1);
      periods.push({ periodStart, periodEnd: nextStart > endDate ? endDate : addDays(nextStart, -1), rentCents: rent });
      rent += percentOfCents(rent, term.increasePercent);
    }
  }
  // schedule: steps dated on or before the start replace the base rent; later steps start new periods
  let rent = term.rentCents;
  const starts: RentPeriod[] = [];
  for (const step of sortedSteps(term.steps)) {
    if (step.effectiveDate > endDate) break;
    if (step.effectiveDate <= startDate) rent = step.amountCents;
    else if (starts.length > 0 && starts[starts.length - 1]!.periodStart === step.effectiveDate) starts[starts.length - 1]!.rentCents = step.amountCents;
    else starts.push({ periodStart: step.effectiveDate, periodEnd: endDate, rentCents: step.amountCents });
  }
  const periods = [{ periodStart: startDate, periodEnd: endDate, rentCents: rent }, ...starts];
  for (let i = 0; i < periods.length - 1; i += 1) periods[i]!.periodEnd = addDays(periods[i + 1]!.periodStart, -1);
  return periods;
}
