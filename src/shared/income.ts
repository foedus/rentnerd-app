/** Commercial tax reimbursement (D-13) and other income per lease (SPEC §7.5). Money is integer cents. */
import { formatCents } from "./format";
import { percentOfCents } from "./rent";

export interface PropertyTaxYear {
  taxYear: number;
  amountCents: number;
}

export interface TaxReimbursement {
  /** Monthly reimbursement. */
  cents: number;
  /** "25% × (2025 tax $52,000.00 − 2020 tax $40,000.00) ÷ 12" */
  explanation: string;
}

/** "25.0000" -> "25", "12.5000" -> "12.5". */
export function formatSharePercent(percent: string): string {
  const trimmed = percent.trim();
  return trimmed.includes(".") ? trimmed.replace(/0+$/, "").replace(/\.$/, "") : trimmed;
}

/** D-13; null (shown as "—") without a base year or share, without tax years, or when the base year has no entered tax. */
export function taxReimbursement(
  taxes: readonly PropertyTaxYear[],
  baseTaxYear: number | null,
  sharePercent: string | null,
): TaxReimbursement | null {
  if (baseTaxYear === null || sharePercent === null || taxes.length === 0) return null;
  const base = taxes.find((t) => t.taxYear === baseTaxYear);
  if (!base) return null;
  const latest = taxes.reduce((a, b) => (b.taxYear > a.taxYear ? b : a));
  const increase = Math.max(0, latest.amountCents - base.amountCents);
  return {
    cents: percentOfCents(increase, sharePercent, 12),
    explanation: `${formatSharePercent(sharePercent)}% × (${latest.taxYear} tax ${formatCents(latest.amountCents)} − ${base.taxYear} tax ${formatCents(base.amountCents)}) ÷ 12`,
  };
}

/** The current term's other-income inputs. */
export interface OtherIncomeTerms {
  parkingChargeCents: number | null;
  baseTaxYear: number | null;
  taxSharePercent: string | null;
}

export interface OtherIncome {
  parkingChargeCents: number;
  /** null shows as "—". */
  taxReimbursementCents: number | null;
  totalCents: number;
}

/** §7.5: parking charge plus tax reimbursement. */
export function otherIncome(terms: OtherIncomeTerms, taxes: readonly PropertyTaxYear[]): OtherIncome {
  const parkingChargeCents = terms.parkingChargeCents ?? 0;
  const tax = taxReimbursement(taxes, terms.baseTaxYear, terms.taxSharePercent);
  return {
    parkingChargeCents,
    taxReimbursementCents: tax?.cents ?? null,
    totalCents: parkingChargeCents + (tax?.cents ?? 0),
  };
}
