import { wholeMonthsBetween } from "./dates";
import { centsInWords, formatCents, formatLongDate, ordinal } from "./format";
import { rentSchedule, type RentTerm } from "./rent";

/** A placeholder's value: plain text ("\n" is a line break), a table, or one signature line per name. */
export type PlaceholderValue = string | { table: { head: string[]; rows: string[][] } } | { signatures: string[] };
export type PlaceholderValues = Record<string, PlaceholderValue | null | undefined>;

export interface SourceTenant {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  isPrimary: boolean;
}

/** The values a master lease or an extension can change (§6.9 "terms"). */
export interface SourceTerms {
  rent: RentTerm;
  securityDepositCents: number | null;
  rentDueDay: number | null;
  lateFeeCents: number | null;
  lateFeeGraceDays: number | null;
  pets: string | null;
  parking: string | null;
  parkingChargeCents: number | null;
  childrenReside: boolean | null;
  breakClause: string | null;
  otherTerms: string | null;
  baseTaxYear: number | null;
  taxSharePercent: string | null;
}

/** Everything a document needs. For an extension, `terms` and `tenants` are the extension's own (§8.1). */
export interface TemplateSource {
  today: string;
  owner: { name: string | null; address: string | null; signatoryName: string | null; signatoryTitle: string | null };
  propertyAddress: string | null;
  unitLabel: string;
  unitUse: "Residential" | "Commercial";
  tenants: readonly SourceTenant[];
  masterStartDate: string;
  masterEndDate: string;
  terms: SourceTerms;
  extension?: { previousEndDate: string; previousRentCents: number; previousTenants: readonly SourceTenant[] };
}

/** "A", "A and B", "A, B and C" */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** "3.0000" -> "3%", "2.5000" -> "2.5%" */
export function formatPercent(percent: string): string {
  const trimmed = percent.trim();
  return `${trimmed.includes(".") ? trimmed.replace(/\.?0+$/, "") : trimmed}%`;
}

const text = (v: string | null | undefined): string => (v ?? "").trim();
const money = (cents: number | null): string => (cents === null ? "" : formatCents(cents));

function scheduleTable(term: RentTerm): PlaceholderValue {
  return {
    table: {
      head: ["Period start", "Period end", "Monthly rent"],
      rows: rentSchedule(term).map((p) => [formatLongDate(p.periodStart), formatLongDate(p.periodEnd), formatCents(p.rentCents)]),
    },
  };
}

/** All §8.1 values for a source. Missing values are "" and render as blanks (see template-render). */
export function buildPlaceholderValues(src: TemplateSource): PlaceholderValues {
  const t = src.terms;
  const primary = src.tenants.find((x) => x.isPrimary);
  const names = src.tenants.map((x) => x.name);
  const nameSet = (list: readonly SourceTenant[]) => new Set(list.map((x) => x.id));
  const previousIds = nameSet(src.extension?.previousTenants ?? []);
  const currentIds = nameSet(src.tenants);
  const orNone = (list: string[]) => (list.length > 0 ? joinNames(list) : "None");
  const schedule = scheduleTable(t.rent);
  const signatory = [text(src.owner.signatoryName), text(src.owner.signatoryTitle)].filter(Boolean).join(", ");

  const values: PlaceholderValues = {
    today: formatLongDate(src.today),
    owner_name: text(src.owner.name),
    owner_address: text(src.owner.address),
    owner_signatory: signatory,
    property_address: text(src.propertyAddress),
    unit_label: text(src.unitLabel),
    unit_use: src.unitUse,
    tenant_names: joinNames(names),
    primary_tenant_name: primary?.name ?? "",
    primary_tenant_email: text(primary?.email),
    primary_tenant_phone: text(primary?.phone),
    tenant_signature_blocks: { signatures: names },
    lease_start_date: formatLongDate(src.masterStartDate),
    lease_end_date: formatLongDate(src.masterEndDate),
    lease_term_months: String(wholeMonthsBetween(t.rent.startDate, t.rent.endDate)),
    monthly_rent: formatCents(t.rent.rentCents),
    monthly_rent_words: centsInWords(t.rent.rentCents),
    rent_schedule: schedule,
    annual_increase_percent: t.rent.increaseType === "percent" ? formatPercent(t.rent.increasePercent) : "",
    security_deposit: money(t.securityDepositCents),
    rent_due_day: t.rentDueDay === null ? "" : ordinal(t.rentDueDay),
    late_fee: money(t.lateFeeCents),
    late_fee_grace_days: t.lateFeeGraceDays === null ? "" : `${t.lateFeeGraceDays} ${t.lateFeeGraceDays === 1 ? "day" : "days"}`,
    pets: text(t.pets),
    parking: text(t.parking),
    parking_charge: money(t.parkingChargeCents),
    children_reside: t.childrenReside === null ? "" : t.childrenReside ? "Yes" : "No",
    break_clause: text(t.breakClause),
    other_terms: text(t.otherTerms),
    base_tax_year: t.baseTaxYear === null ? "" : String(t.baseTaxYear),
    tax_share_percent: t.taxSharePercent === null ? "" : formatPercent(t.taxSharePercent),
  };
  if (src.extension) {
    Object.assign(values, {
      previous_end_date: formatLongDate(src.extension.previousEndDate),
      previous_monthly_rent: formatCents(src.extension.previousRentCents),
      extension_start_date: formatLongDate(t.rent.startDate),
      extension_end_date: formatLongDate(t.rent.endDate),
      extension_monthly_rent: formatCents(t.rent.rentCents),
      extension_rent_schedule: schedule,
      previous_tenant_names: joinNames(src.extension.previousTenants.map((x) => x.name)),
      removed_tenant_names: orNone(src.extension.previousTenants.filter((x) => !currentIds.has(x.id)).map((x) => x.name)),
      added_tenant_names: orNone(src.tenants.filter((x) => !previousIds.has(x.id)).map((x) => x.name)),
    });
  }
  return values;
}
