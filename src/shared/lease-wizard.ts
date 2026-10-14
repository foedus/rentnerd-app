import { addYears, isValidYmd } from "./dates";
import type { RentTerm } from "./rent";
import type { IncreaseType } from "./schemas";

/** Step 1 of the New lease wizard (SPEC §11.12): who is on the lease and who is the primary contact. */
export interface WizardTenantRow {
  /** Stable key for the row; the primary contact is chosen by key. */
  key: string;
  /** Set for an existing tenant; new tenants are only created when the lease is saved. */
  tenantId?: string;
  name: string;
}

export const NO_TENANTS_MESSAGE = "Add at least one tenant.";
export const NO_PRIMARY_MESSAGE = "Choose a primary contact.";

/** The message to show when the tenants step can't move on, or null when it can. */
export function tenantStepIssue(rows: readonly WizardTenantRow[], primaryKey: string | null): string | null {
  if (rows.length === 0) return NO_TENANTS_MESSAGE;
  if (!primaryKey || !rows.some((r) => r.key === primaryKey)) return NO_PRIMARY_MESSAGE;
  return null;
}

/** Step 2 of the wizard (SPEC §11.12): term and rent, held as the person typed it. */
export interface TermStepRow {
  key: string;
  effectiveDate: string;
  /** Cents; null when empty and NaN when the text isn't an amount. */
  amountCents: number | null;
}

export interface TermStepDraft {
  startDate: string;
  endDate: string;
  baseRentCents: number | null;
  securityDepositCents: number | null;
  rentDueDay: string;
  lateFeeCents: number | null;
  lateFeeGraceDays: string;
  increaseType: IncreaseType;
  increasePercent: string;
  steps: TermStepRow[];
  moveOutDate: string;
  endReason: string;
}

export const blankTermStep: TermStepDraft = {
  startDate: "", endDate: "", baseRentCents: null, securityDepositCents: null, rentDueDay: "1", lateFeeCents: null,
  lateFeeGraceDays: "", increaseType: "none", increasePercent: "", steps: [], moveOutDate: "", endReason: "",
};

export const END_BEFORE_START_MESSAGE = "Lease end date must be after the start date.";
export const TERM_TOO_LONG_MESSAGE = "Lease end date must be within 50 years of the start date.";
export const STEP_OUTSIDE_TERM_MESSAGE = "Effective date must fall within the lease term.";
const DAY_MESSAGE = "Enter a whole number from 1 to 28.";
const GRACE_MESSAGE = "Enter a whole number from 0 to 31.";
const PERCENT_MESSAGE = "Enter a percentage above 0 and up to 50.";
const WHOLE = /^\d+$/;
const PERCENT = /^\d+(\.\d{1,4})?$/;

/** The Lease end date is before today, so a past lease may carry a Move-out date and Reason (§11.12). */
export const showsMoveOut = (d: Pick<TermStepDraft, "endDate">, today: string): boolean => isValidYmd(d.endDate) && d.endDate < today;

const optionalMoneyIssue = (v: number | null): string | null =>
  v === null ? null : !Number.isFinite(v) ? "Enter an amount." : v < 0 ? "The amount can't be negative." : v > 1_000_000_000_000 ? "Enter a smaller amount." : null;
const requiredMoneyIssue = (v: number | null, empty: string): string | null =>
  v === null ? empty : !Number.isFinite(v) ? "Enter an amount." : v < 1 ? "Enter an amount above 0." : v > 1_000_000_000_000 ? "Enter a smaller amount." : null;

/** Field messages (keyed by field name; step rows as `steps.<key>.date` / `steps.<key>.amount`); empty when step 2 can move on. */
export function termStepIssues(d: TermStepDraft, today: string): Record<string, string> {
  const out: Record<string, string> = {};
  const startOk = isValidYmd(d.startDate);
  const endOk = isValidYmd(d.endDate);
  if (!d.startDate) out.startDate = "Enter the lease start date.";
  else if (!startOk) out.startDate = "Enter a valid date.";
  if (!d.endDate) out.endDate = "Enter the lease end date.";
  else if (!endOk) out.endDate = "Enter a valid date.";
  else if (startOk && d.endDate <= d.startDate) out.endDate = END_BEFORE_START_MESSAGE;
  else if (startOk && d.endDate > addYears(d.startDate, 50)) out.endDate = TERM_TOO_LONG_MESSAGE;
  const rent = requiredMoneyIssue(d.baseRentCents, "Enter the monthly rent.");
  if (rent) out.baseRentCents = rent;
  const deposit = optionalMoneyIssue(d.securityDepositCents);
  if (deposit) out.securityDepositCents = deposit;
  const fee = optionalMoneyIssue(d.lateFeeCents);
  if (fee) out.lateFeeCents = fee;
  const day = d.rentDueDay.trim();
  if (!WHOLE.test(day) || Number(day) < 1 || Number(day) > 28) out.rentDueDay = DAY_MESSAGE;
  const grace = d.lateFeeGraceDays.trim();
  if (grace !== "" && (!WHOLE.test(grace) || Number(grace) > 31)) out.lateFeeGraceDays = GRACE_MESSAGE;
  if (d.increaseType === "percent") {
    const p = d.increasePercent.trim();
    if (!PERCENT.test(p) || Number(p) <= 0 || Number(p) > 50) out.increasePercent = PERCENT_MESSAGE;
  }
  if (d.increaseType === "schedule") {
    if (d.steps.length === 0) out.steps = "Add at least one rent step.";
    let previous = "";
    for (const s of d.steps) {
      if (!s.effectiveDate) out[`steps.${s.key}.date`] = "Enter the effective date.";
      else if (!isValidYmd(s.effectiveDate)) out[`steps.${s.key}.date`] = "Enter a valid date.";
      else if ((startOk && s.effectiveDate <= d.startDate) || (endOk && s.effectiveDate >= d.endDate)) out[`steps.${s.key}.date`] = STEP_OUTSIDE_TERM_MESSAGE;
      else if (previous && s.effectiveDate <= previous) out[`steps.${s.key}.date`] = "Effective dates must be in increasing order.";
      if (isValidYmd(s.effectiveDate)) previous = s.effectiveDate;
      const amount = requiredMoneyIssue(s.amountCents, "Enter the monthly rent.");
      if (amount) out[`steps.${s.key}.amount`] = amount;
    }
  }
  if (showsMoveOut(d, today)) {
    if (d.moveOutDate && !isValidYmd(d.moveOutDate)) out.moveOutDate = "Enter a valid date.";
    else if (d.moveOutDate && !d.endReason) out.endReason = "Choose a reason.";
    else if (!d.moveOutDate && d.endReason) out.moveOutDate = "Enter the move-out date.";
  }
  return out;
}

/** The term as far as it is filled in for the live Rent schedule table; null while the dates or rent can't make one. */
export function draftRentTerm(d: TermStepDraft): RentTerm | null {
  const rent = d.baseRentCents;
  if (!isValidYmd(d.startDate) || !isValidYmd(d.endDate) || d.endDate <= d.startDate || d.endDate > addYears(d.startDate, 50) || rent === null || !Number.isFinite(rent) || rent < 1) return null;
  const base = { startDate: d.startDate, endDate: d.endDate, rentCents: rent };
  if (d.increaseType === "percent") {
    const p = d.increasePercent.trim();
    return PERCENT.test(p) && Number(p) > 0 && Number(p) <= 50 ? { ...base, increaseType: "percent", increasePercent: p } : { ...base, increaseType: "none" };
  }
  if (d.increaseType === "schedule") {
    const steps = d.steps
      .filter((s) => isValidYmd(s.effectiveDate) && s.effectiveDate > d.startDate && s.effectiveDate < d.endDate && s.amountCents !== null && Number.isFinite(s.amountCents) && s.amountCents > 0)
      .map((s) => ({ effectiveDate: s.effectiveDate, amountCents: s.amountCents as number }));
    return { ...base, increaseType: "schedule", steps };
  }
  return { ...base, increaseType: "none" };
}
