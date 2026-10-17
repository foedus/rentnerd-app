import { addDays } from "./dates";
import { blankTermStep, termStepIssues, type TermStepDraft } from "./lease-wizard";

/** The part of an extension the form edits at this stage (SPEC §11.14): dates, rent, rent increases and notes. */
export interface ExtensionDraft {
  term: TermStepDraft;
  notes: string;
}

interface ExtensionValues {
  startDate: string;
  endDate: string;
  baseRentCents: number;
  increaseType: TermStepDraft["increaseType"];
  increasePercent: number | null;
  rentSteps: { effectiveDate: string; amountCents: number }[];
  notes: string | null;
}

/** A new extension starts the day after the lease's effective end (§6.10). */
export const newExtensionDraft = (effectiveEndDate: string): ExtensionDraft => ({ term: { ...blankTermStep, startDate: addDays(effectiveEndDate, 1) }, notes: "" });

export const draftFromExtension = (e: ExtensionValues): ExtensionDraft => ({
  term: {
    ...blankTermStep,
    startDate: e.startDate,
    endDate: e.endDate,
    baseRentCents: e.baseRentCents,
    increaseType: e.increaseType,
    increasePercent: e.increasePercent === null ? "" : String(e.increasePercent),
    steps: e.rentSteps.map((s, i) => ({ key: `step-${i}`, effectiveDate: s.effectiveDate, amountCents: s.amountCents })),
  },
  notes: e.notes ?? "",
});

const NOTES_MAX = 5000;

/** Field messages for the extension form, keyed like the term step's; empty when it can be saved. */
export function extensionIssues(d: ExtensionDraft, today: string): Record<string, string> {
  const all = termStepIssues(d.term, today);
  const out: Record<string, string> = {};
  for (const [key, message] of Object.entries(all)) {
    // The deposit, due day, late fee and move-out fields are not on this form.
    if (["securityDepositCents", "rentDueDay", "lateFeeCents", "lateFeeGraceDays", "moveOutDate", "endReason"].includes(key)) continue;
    out[key] = message.replace("Lease end date", "Extension end date").replace("the lease start date", "the extension start date").replace("the lease end date", "the extension end date").replace("within the lease term", "within the extension term");
  }
  if (d.notes.length > NOTES_MAX) out.notes = `Use ${NOTES_MAX} characters or fewer.`;
  return out;
}

/** The POST /leases/{id}/extensions or PATCH /extensions/{id} body; omitted terms and tenants stay as they are (§6.10). */
export function extensionBody(d: ExtensionDraft, version: number): Record<string, unknown> {
  const t = d.term;
  return {
    startDate: t.startDate,
    endDate: t.endDate,
    baseRentCents: t.baseRentCents,
    increaseType: t.increaseType,
    increasePercent: t.increaseType === "percent" ? Number(t.increasePercent.trim()) : null,
    rentSteps: t.increaseType === "schedule" ? t.steps.map((s) => ({ effectiveDate: s.effectiveDate, amountCents: s.amountCents })) : [],
    notes: d.notes.trim() === "" ? null : d.notes.trim(),
    version,
  };
}
