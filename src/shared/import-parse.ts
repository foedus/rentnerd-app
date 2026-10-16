import { isValidYmd } from "./dates";
import { parseMoneyToCents } from "./format";
import type { ImportSheet } from "./import-template";

/** A spreadsheet cell after the server has flattened formulas, rich text and links (§11.22). Blank cells are `null`. */
export type Cell = string | number | boolean | Date | null;
export type CellResult = { ok: true; value: unknown } | { ok: false; message: string };

type Choice = readonly (readonly [label: string, value: string])[];
export type FieldKind =
  | { kind: "text" | "zip" | "yesno" | "date" | "money" | "int" | "number" | "key" | "emails" }
  | { kind: "enum"; choices: Choice; message: string };
export interface FieldSpec {
  field: string;
  type: FieldKind;
}

const fail = (message: string): CellResult => ({ ok: false, message });
const ok = (value: unknown): CellResult => ({ ok: true, value });

/** Real Excel dates arrive as UTC-midnight Dates; text must be YYYY-MM-DD. */
function parseDate(cell: Exclude<Cell, null>): CellResult {
  const text = cell instanceof Date ? (Number.isNaN(cell.getTime()) ? "" : cell.toISOString().slice(0, 10)) : typeof cell === "string" ? cell : "";
  return isValidYmd(text) ? ok(text) : fail("Enter a valid date.");
}

function parseNumber(cell: Exclude<Cell, null>, whole: boolean): CellResult {
  const n = typeof cell === "number" ? cell : typeof cell === "string" && /^-?\d+(\.\d+)?$/.test(cell) ? Number(cell) : Number.NaN;
  if (!Number.isFinite(n) || (whole && !Number.isInteger(n))) return fail(whole ? "Enter a whole number." : "Enter a number.");
  return ok(n);
}

function parseMoney(cell: Exclude<Cell, null>): CellResult {
  if (typeof cell === "number") {
    const cents = Math.round(cell * 100);
    if (!Number.isSafeInteger(cents)) return fail("Enter an amount.");
    return Math.abs(cell * 100 - cents) < 1e-6 ? ok(cents) : fail("Enter an amount in whole cents.");
  }
  const cents = typeof cell === "string" ? parseMoneyToCents(cell) : null;
  return cents === null ? fail("Enter an amount.") : ok(cents);
}

/** Converts one non-blank cell to the value the shared Zod schema expects, or explains why it can't. */
export function parseCell(type: FieldKind, cell: Exclude<Cell, null>): CellResult {
  switch (type.kind) {
    case "date": return parseDate(cell);
    case "money": return parseMoney(cell);
    case "int": return parseNumber(cell, true);
    case "number": return parseNumber(cell, false);
    case "yesno": {
      const v = typeof cell === "string" ? cell.trim().toLowerCase() : "";
      return v === "yes" ? ok(true) : v === "no" ? ok(false) : fail("Choose Yes or No.");
    }
    case "enum": {
      const v = typeof cell === "string" ? cell.trim().toLowerCase() : "";
      const hit = type.choices.find(([label]) => label.toLowerCase() === v);
      return hit ? ok(hit[1]) : fail(type.message);
    }
    case "zip": return ok(typeof cell === "number" ? String(cell).padStart(5, "0") : String(cell).trim());
    case "emails": return ok(String(cell).split(";").map((e) => e.trim()).filter(Boolean));
    default: return ok(cell instanceof Date ? cell.toISOString().slice(0, 10) : String(cell).trim());
  }
}

const t = (field: string, kind: "text" | "zip" | "yesno" | "date" | "money" | "int" | "number" | "key" | "emails" = "text"): FieldSpec => ({ field, type: { kind } });
const e = (field: string, message: string, choices: Choice): FieldSpec => ({ field, type: { kind: "enum", choices, message } });
const same = (...labels: string[]): Choice => labels.map((l) => [l, l] as const);
const USES = same("Residential", "Commercial");

/** Column heading → schema field and cell format, per sheet. Every heading in IMPORT_COLUMNS must be here (unit-tested). */
export const IMPORT_FIELDS: Record<ImportSheet, Record<string, FieldSpec>> = {
  Owners: {
    "Owner key": t("key", "key"), "Owner name": t("name"),
    "Owner type": e("ownerType", "Select an owner type.", same("LLC", "Corporation", "Partnership", "Trust", "Individual", "Other")),
    "Mailing address line 1": t("addressLine1"), "Mailing address line 2": t("addressLine2"), City: t("city"), State: t("state"),
    "ZIP code": t("zip", "zip"), Email: t("email"), Phone: t("phone"), "Signatory name": t("signatoryName"), "Signatory title": t("signatoryTitle"), Notes: t("notes"),
  },
  Properties: {
    "Property key": t("key", "key"), "Owner key": t("ownerKey", "key"), "Property name": t("name"), "Street address": t("street"), City: t("city"), State: t("state"),
    "ZIP code": t("zip", "zip"), "Located in New York City": t("inNyc", "yesno"), "Borough-Block-Lot (BBL)": t("bbl"), "Year built": t("yearBuilt", "int"),
    "Responsible landlord emails": t("responsibleEmails", "emails"), "Purchase price": t("purchasePriceCents", "money"), "Purchase date": t("purchaseDate", "date"), Notes: t("notes"),
  },
  Units: {
    "Unit key": t("key", "key"), "Property key": t("propertyKey", "key"), "Unit label": t("label"), Use: e("use", "Choose Residential or Commercial.", USES),
    Bedrooms: t("bedrooms", "int"), Bathrooms: t("bathrooms", "number"), "Square feet": t("squareFeet", "int"), "Owner override key": t("ownerOverrideKey", "key"), Notes: t("notes"),
  },
  Tenants: {
    "Tenant key": t("key", "key"), "Tenant type": e("tenantType", "Choose Individual or Business.", same("Individual", "Business")),
    "First name": t("firstName"), "Last name": t("lastName"), "Business name": t("businessName"), "Contact person": t("contactPerson"), Email: t("email"), Phone: t("phone"), Notes: t("notes"),
  },
  Leases: {
    "Unit key": t("unitKey", "key"), "Tenant 1 key": t("tenant1", "key"), "Tenant 2 key": t("tenant2", "key"), "Tenant 3 key": t("tenant3", "key"), "Tenant 4 key": t("tenant4", "key"),
    "Lease start date": t("startDate", "date"), "Lease end date": t("endDate", "date"), "Monthly rent": t("baseRentCents", "money"),
    "Rent increases": e("increaseType", "Choose how rent increases.", [["None", "none"], ["Percent", "percent"]]),
    "Annual increase (%)": t("increasePercent", "number"), "Security deposit": t("securityDepositCents", "money"), "Rent due day": t("rentDueDay", "int"),
    "Late fee": t("lateFeeCents", "money"), "Late fee grace period (days)": t("lateFeeGraceDays", "int"), Pets: t("pets"), Parking: t("parking"),
    "Parking charge (monthly)": t("parkingChargeCents", "money"), "Children reside in unit": t("childrenReside", "yesno"), "Break clause": t("breakClause"),
    "Other special terms": t("otherTerms"), "Base tax year": t("baseTaxYear", "int"), "Tenant's share of tax increase (%)": t("taxSharePercent", "number"),
    "Month-to-month": t("monthToMonth", "yesno"), "Month-to-month monthly rent": t("monthToMonthRentCents", "money"), "Move-out date": t("moveOutDate", "date"),
    Reason: e("endReason", "Choose a reason.", same("Tenant moved out", "Not renewed", "Terminated", "Tenant broke lease", "Replaced by new lease", "Other")),
  },
};
