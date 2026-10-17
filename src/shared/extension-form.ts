import { addDays } from "./dates";
import { draftsFromLease, type EditableLease } from "./lease-edit";
import { specialStepIssues, termStepIssues, type SpecialStepDraft, type TermStepDraft, type WizardTenantRow } from "./lease-wizard";

/** A tenant row; `newTenant` holds a tenant made on the form that is created when the extension is saved. */
export type ExtensionTenantRow = WizardTenantRow & { newTenant?: Record<string, unknown> };

/** What the extension form edits (SPEC §11.14): tenants, dates, rent, rent increases, the other terms and notes. */
export interface ExtensionDraft {
  rows: ExtensionTenantRow[];
  primary: string | null;
  term: TermStepDraft;
  special: SpecialStepDraft;
  notes: string;
}

/** One term of a lease (the master lease or an extension) as the API returns it; the extension form starts from the previous one. */
export type TermValues = Omit<EditableLease, "masterTenants" | "moveOutDate" | "endReason"> & {
  notes?: string | null;
  tenants: { tenantId: string; isPrimary: boolean; displayName?: string }[];
};

const fromTerm = (e: TermValues): Omit<ExtensionDraft, "notes"> => {
  const names = draftsFromLease({ ...e, moveOutDate: null, endReason: null, masterTenants: e.tenants.map((t) => ({ ...t, displayName: t.displayName ?? "" })) });
  return { rows: names.rows, primary: names.primary, term: { ...names.term, moveOutDate: "", endReason: "" }, special: names.special };
};

/** A new extension starts the day after the lease's effective end and copies the previous term's other values (§6.10). */
export const newExtensionDraft = (previous: TermValues, effectiveEndDate: string): ExtensionDraft => {
  const d = fromTerm(previous);
  return { ...d, term: { ...d.term, startDate: addDays(effectiveEndDate, 1), endDate: "", baseRentCents: null, increaseType: "none", increasePercent: "", steps: [] }, notes: "" };
};

export const draftFromExtension = (e: TermValues): ExtensionDraft => ({ ...fromTerm(e), notes: e.notes ?? "" });

const NOTES_MAX = 5000;
/** The shown names for the tenant message a master lease needs (§6.10). */
export const MASTER_TENANT_MESSAGE = "At least one tenant from the original lease must stay. To change all tenants, end this lease and create a new lease.";

/** True when at least one of the master lease's tenants is still on the extension. */
export const keepsMasterTenant = (rows: readonly WizardTenantRow[], masterTenantIds: readonly string[]): boolean => rows.some((r) => r.tenantId && masterTenantIds.includes(r.tenantId));

/** Field messages for the extension form, keyed like the term step's; empty when it can be saved. */
export function extensionIssues(d: ExtensionDraft, today: string, use: "Residential" | "Commercial"): Record<string, string> {
  const all = { ...termStepIssues(d.term, today), ...specialStepIssues(d.special, use) };
  const out: Record<string, string> = {};
  for (const [key, message] of Object.entries(all)) {
    if (["moveOutDate", "endReason"].includes(key)) continue;
    out[key] = message.replace("Lease end date", "Extension end date").replace("the lease start date", "the extension start date").replace("the lease end date", "the extension end date").replace("within the lease term", "within the extension term");
  }
  if (d.notes.length > NOTES_MAX) out.notes = `Use ${NOTES_MAX} characters or fewer.`;
  return out;
}

const textOrNull = (s: string): string | null => (s.trim() === "" ? null : s.trim());

/** The POST /leases/{id}/extensions or PATCH /extensions/{id} body: every term is sent, pre-filled from the previous term (§6.10). */
export function extensionBody(d: ExtensionDraft, version: number, use: "Residential" | "Commercial"): Record<string, unknown> {
  const t = d.term;
  const s = d.special;
  const grace = t.lateFeeGraceDays.trim();
  return {
    tenants: d.rows.filter((r) => r.tenantId).map((r) => ({ tenantId: r.tenantId, isPrimary: r.key === d.primary })),
    startDate: t.startDate,
    endDate: t.endDate,
    baseRentCents: t.baseRentCents,
    increaseType: t.increaseType,
    increasePercent: t.increaseType === "percent" ? Number(t.increasePercent.trim()) : null,
    rentSteps: t.increaseType === "schedule" ? t.steps.map((x) => ({ effectiveDate: x.effectiveDate, amountCents: x.amountCents })) : [],
    securityDepositCents: t.securityDepositCents,
    rentDueDay: Number(t.rentDueDay.trim()),
    lateFeeCents: t.lateFeeCents,
    lateFeeGraceDays: grace === "" ? null : Number(grace),
    pets: textOrNull(s.pets),
    parking: textOrNull(s.parking),
    parkingChargeCents: s.parkingChargeCents,
    childrenReside: use === "Residential" ? s.childrenReside === "Yes" : null,
    breakClause: textOrNull(s.breakClause),
    otherTerms: textOrNull(s.otherTerms),
    baseTaxYear: use === "Commercial" && s.baseTaxYear !== "" ? Number(s.baseTaxYear) : null,
    taxSharePercent: use === "Commercial" && s.taxSharePercent.trim() !== "" ? Number(s.taxSharePercent.trim()) : null,
    notes: textOrNull(d.notes),
    version,
  };
}
