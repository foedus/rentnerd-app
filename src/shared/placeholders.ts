/** §8.1 placeholder registry: the one list of keys and chip labels, shared by the API, editor and renderer. */
export const TEMPLATE_KINDS = ["master_lease", "extension"] as const;
export type TemplateKind = (typeof TEMPLATE_KINDS)[number];
export const TEMPLATE_KIND_LABELS: Record<TemplateKind, string> = { master_lease: "Master lease", extension: "Lease extension" };

export type Placeholder = { key: string; label: string; extensionOnly: boolean };

const common: [string, string][] = [
  ["today", "Today's date"],
  ["owner_name", "Owner name"],
  ["owner_address", "Owner address"],
  ["owner_signatory", "Owner signatory"],
  ["property_address", "Property address"],
  ["unit_label", "Unit"],
  ["unit_use", "Unit use"],
  ["tenant_names", "Tenant names"],
  ["primary_tenant_name", "Primary tenant name"],
  ["primary_tenant_email", "Primary tenant email"],
  ["primary_tenant_phone", "Primary tenant phone"],
  ["tenant_signature_blocks", "Tenant signature blocks"],
  ["lease_start_date", "Lease start date"],
  ["lease_end_date", "Lease end date"],
  ["lease_term_months", "Lease term (months)"],
  ["monthly_rent", "Monthly rent"],
  ["monthly_rent_words", "Monthly rent in words"],
  ["rent_schedule", "Rent schedule"],
  ["annual_increase_percent", "Annual increase (%)"],
  ["security_deposit", "Security deposit"],
  ["rent_due_day", "Rent due day"],
  ["late_fee", "Late fee"],
  ["late_fee_grace_days", "Late fee grace period"],
  ["pets", "Pets"],
  ["parking", "Parking"],
  ["parking_charge", "Parking charge"],
  ["children_reside", "Children reside in unit"],
  ["break_clause", "Break clause"],
  ["other_terms", "Other special terms"],
  ["base_tax_year", "Base tax year"],
  ["tax_share_percent", "Tenant's tax share (%)"],
];
const extensionOnly: [string, string][] = [
  ["previous_end_date", "Previous end date"],
  ["previous_monthly_rent", "Previous monthly rent"],
  ["extension_start_date", "Extension start date"],
  ["extension_end_date", "Extension end date"],
  ["extension_monthly_rent", "Extension monthly rent"],
  ["extension_rent_schedule", "Extension rent schedule"],
  ["previous_tenant_names", "Previous tenant names"],
  ["removed_tenant_names", "Removed tenants"],
  ["added_tenant_names", "Added tenants"],
];

export const PLACEHOLDERS: readonly Placeholder[] = [
  ...common.map(([key, label]) => ({ key, label, extensionOnly: false })),
  ...extensionOnly.map(([key, label]) => ({ key, label, extensionOnly: true })),
];
const BY_KEY = new Map(PLACEHOLDERS.map((p) => [p.key, p]));

export const findPlaceholder = (key: string): Placeholder | undefined => BY_KEY.get(key);
/** Placeholders offered in a template of this kind; extension-only keys are left out of master lease templates. */
export const placeholdersFor = (kind: TemplateKind): Placeholder[] => PLACEHOLDERS.filter((p) => kind === "extension" || !p.extensionOnly);
