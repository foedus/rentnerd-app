import { type Cell } from "./import-parse";
import { occupiedPeriod, periodsOverlap } from "./lease";
import { leaseRuleIssues } from "./schemas";
import type { ImportProblem, SheetRow } from "./import-validate";
import type { ImportSheet } from "./import-template";

/** A parsed row plus the schema's values (null when the row already has cell or field problems). */
export type ReadRow = SheetRow & { data: Record<string, unknown> | null };
/** What already exists: lower-cased names of non-archived properties and emails of active Admin/Landlord users. */
export interface ImportExisting {
  propertyNames: ReadonlySet<string>;
  landlordEmails: ReadonlySet<string>;
}

const PROPERTY_NAME_TAKEN = "A property with this name already exists.";
const UNIT_LABEL_TAKEN = "A unit with this label already exists in this property.";
const OVERLAP = "This unit already has a lease for those dates.";
const TAX_YEAR = "Choose a tax year that has been entered for this property.";
const LANDLORDS = "Choose only active Admin or Landlord users.";
const KEY_OF: Record<string, string> = { Owners: "Owner key", Properties: "Property key", Units: "Unit key", Tenants: "Tenant key" };
const LEASE_COLUMNS: Record<string, string> = {
  endDate: "Lease end date", increasePercent: "Annual increase (%)", childrenReside: "Children reside in unit", baseTaxYear: "Base tax year",
  taxSharePercent: "Tenant's share of tax increase (%)", endReason: "Reason", moveOutDate: "Move-out date", tenants: "Tenant 1 key",
};

const keyOf = (cell: Cell | undefined): string | null => (cell == null ? null : cell instanceof Date ? cell.toISOString().slice(0, 10) : String(cell).trim() || null);
const text = (r: ReadRow, header: string) => keyOf(r.cells.get(header));

/** Keys, references, uniqueness and unit-dependent lease rules across the sheets (§6, §11.22); the first use of a key or name is fine, later ones are flagged. */
export function checkImportLinks(sheets: Record<ImportSheet, ReadRow[]>, existing: ImportExisting): ImportProblem[] {
  const out: ImportProblem[] = [];
  const add = (sheet: ImportSheet, r: ReadRow, column: string, problem: string) => out.push({ sheet, row: r.row, column, problem });

  const index = (sheet: ImportSheet) => {
    const byKey = new Map<string, ReadRow>();
    for (const r of sheets[sheet]) {
      const key = text(r, KEY_OF[sheet]!);
      if (key === null) continue;
      if (byKey.has(key)) add(sheet, r, KEY_OF[sheet]!, `The key '${key}' is used more than once in the ${sheet} sheet.`);
      else byKey.set(key, r);
    }
    return byKey;
  };
  const owners = index("Owners");
  const properties = index("Properties");
  const units = index("Units");
  const tenants = index("Tenants");
  const reference = (sheet: ImportSheet, r: ReadRow, column: string, target: Map<string, ReadRow>, targetSheet: string, singular: string) => {
    const key = text(r, column);
    if (key !== null && !target.has(key)) add(sheet, r, column, `No ${singular} with key '${key}' in the ${targetSheet} sheet.`);
    return key !== null ? target.get(key) : undefined;
  };

  const names = new Set<string>();
  for (const r of sheets.Properties) {
    reference("Properties", r, "Owner key", owners, "Owners", "owner");
    const name = (typeof r.data?.name === "string" ? r.data.name : text(r, "Property name"))?.toLowerCase();
    if (name) {
      if (existing.propertyNames.has(name) || names.has(name)) add("Properties", r, "Property name", PROPERTY_NAME_TAKEN);
      names.add(name);
    }
    const emails = text(r, "Responsible landlord emails");
    if (emails && emails.split(";").map((e) => e.trim().toLowerCase()).filter(Boolean).some((e) => !existing.landlordEmails.has(e))) add("Properties", r, "Responsible landlord emails", LANDLORDS);
  }

  const labels = new Set<string>();
  for (const r of sheets.Units) {
    const property = reference("Units", r, "Property key", properties, "Properties", "property");
    reference("Units", r, "Owner override key", owners, "Owners", "owner");
    const label = (typeof r.data?.label === "string" ? r.data.label : text(r, "Unit label"))?.toLowerCase();
    if (property && label) {
      const id = `${text(property, "Property key")}\u0000${label}`;
      if (labels.has(id)) add("Units", r, "Unit label", UNIT_LABEL_TAKEN);
      labels.add(id);
    }
  }

  const accepted = new Map<string, { row: number; terms: Parameters<typeof occupiedPeriod>[0] }[]>();
  for (const r of sheets.Leases) {
    const unitRow = reference("Leases", r, "Unit key", units, "Units", "unit");
    const keys = [1, 2, 3, 4].map((n) => ({ n, key: text(r, `Tenant ${n} key`) }));
    const seen = new Set<string>();
    for (const { n, key } of keys) {
      if (key === null) continue;
      if (!tenants.has(key)) add("Leases", r, `Tenant ${n} key`, `No tenant with key '${key}' in the Tenants sheet.`);
      else if (seen.has(key)) add("Leases", r, `Tenant ${n} key`, "Each tenant can be added once.");
      seen.add(key);
    }
    const use = unitRow?.data?.use;
    const d = r.data;
    if (!d || (use !== "Residential" && use !== "Commercial")) continue;

    const issues = leaseRuleIssues(
      { ...(d as unknown as Parameters<typeof leaseRuleIssues>[0]), rentSteps: [], tenants: keys.filter((k) => k.key !== null).map((k) => ({ tenantId: k.key!, isPrimary: k.n === 1 })) },
      use,
    );
    delete issues.tenants; // keys and duplicates are reported against their own columns above
    for (const [field, problem] of Object.entries(issues)) add("Leases", r, LEASE_COLUMNS[field] ?? field, problem);
    if (d.baseTaxYear != null && use === "Commercial" && !issues.baseTaxYear) add("Leases", r, "Base tax year", TAX_YEAR);
    if (Object.keys(issues).includes("endDate")) continue;

    const unitKey = text(r, "Unit key")!;
    const terms = {
      master: { startDate: d.startDate as string, endDate: d.endDate as string, rentCents: 1, increaseType: "none" as const },
      extensions: [],
      monthToMonth: d.monthToMonth === true,
      monthToMonthRentCents: null,
      moveOutDate: typeof d.moveOutDate === "string" ? d.moveOutDate : null,
    };
    const earlier = accepted.get(unitKey) ?? [];
    if (earlier.some((e) => periodsOverlap(occupiedPeriod(terms), occupiedPeriod(e.terms)))) add("Leases", r, "Lease start date", OVERLAP);
    else accepted.set(unitKey, [...earlier, { row: r.row, terms }]);
  }
  return out;
}
