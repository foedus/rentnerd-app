import type { SpecialStepDraft, TermStepDraft } from "./lease-wizard";
import { leaseRequestBody, showsMoveOut, type WizardTenantRow } from "./lease-wizard";
import type { IncreaseType } from "./schemas";

/** The master-lease values the Edit lease page starts from (the lease record the API returns, §14.2). */
export interface EditableLease {
  startDate: string;
  endDate: string;
  baseRentCents: number;
  securityDepositCents: number | null;
  rentDueDay: number;
  lateFeeCents: number | null;
  lateFeeGraceDays: number | null;
  increaseType: IncreaseType;
  increasePercent: number | null;
  rentSteps: { effectiveDate: string; amountCents: number }[];
  moveOutDate: string | null;
  endReason: string | null;
  pets: string | null;
  parking: string | null;
  parkingChargeCents: number | null;
  childrenReside: boolean | null;
  breakClause: string | null;
  otherTerms: string | null;
  baseTaxYear: number | null;
  taxSharePercent: number | null;
  masterTenants: { tenantId: string; isPrimary: boolean; displayName: string }[];
}

/** The wizard's three steps filled in with a lease's current values (SPEC §11.13 Edit lease). */
export function draftsFromLease(l: EditableLease): { rows: WizardTenantRow[]; primary: string | null; term: TermStepDraft; special: SpecialStepDraft } {
  const rows = l.masterTenants.map((t) => ({ key: t.tenantId, tenantId: t.tenantId, name: t.displayName }));
  return {
    rows,
    primary: l.masterTenants.find((t) => t.isPrimary)?.tenantId ?? null,
    term: {
      startDate: l.startDate,
      endDate: l.endDate,
      baseRentCents: l.baseRentCents,
      securityDepositCents: l.securityDepositCents,
      rentDueDay: String(l.rentDueDay),
      lateFeeCents: l.lateFeeCents,
      lateFeeGraceDays: l.lateFeeGraceDays === null ? "" : String(l.lateFeeGraceDays),
      increaseType: l.increaseType,
      increasePercent: l.increasePercent === null ? "" : String(l.increasePercent),
      steps: l.rentSteps.map((s, i) => ({ key: `step-${i}`, effectiveDate: s.effectiveDate, amountCents: s.amountCents })),
      moveOutDate: l.moveOutDate ?? "",
      endReason: l.endReason ?? "",
    },
    special: {
      pets: l.pets ?? "",
      parking: l.parking ?? "",
      parkingChargeCents: l.parkingChargeCents,
      childrenReside: l.childrenReside === null ? "" : l.childrenReside ? "Yes" : "No",
      breakClause: l.breakClause ?? "",
      otherTerms: l.otherTerms ?? "",
      baseTaxYear: l.baseTaxYear === null ? "" : String(l.baseTaxYear),
      taxSharePercent: l.taxSharePercent === null ? "" : String(l.taxSharePercent),
    },
  };
}

/** The PATCH /leases/{id} body (§14.2). A move-out date and reason already on the lease are left alone unless the end date is in the past, where the form shows them. */
export function leaseUpdateBody(
  version: number,
  rows: readonly WizardTenantRow[],
  primaryKey: string | null,
  term: TermStepDraft,
  special: SpecialStepDraft,
  use: "Residential" | "Commercial",
  today: string,
): Record<string, unknown> {
  const body = leaseRequestBody(rows, primaryKey, term, special, use, today);
  delete body.newTenants; // new tenants can only be created with a new lease
  if (!showsMoveOut(term, today)) {
    delete body.moveOutDate;
    delete body.endReason;
  }
  return { ...body, version };
}
