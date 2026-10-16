/** Column layout of the import workbook (§11.22): one column per §6 field, headed with its label, plus the import-only keys. */
export const IMPORT_SHEETS = ["Owners", "Properties", "Units", "Tenants", "Leases"] as const;
export type ImportSheet = (typeof IMPORT_SHEETS)[number];

export interface ImportColumn {
  header: string;
  /** "Required", "Optional", or "Required if …" text shown on the Instructions sheet. */
  rule: string;
  /** Allowed values or format, shown on the Instructions sheet. */
  format?: string;
}

const req = "Required";
const opt = "Optional";
const YES_NO = "Yes or No";
const DATE = "Date (real Excel date or YYYY-MM-DD)";
const MONEY = "Money (number, or text like 2,150.00)";
const key = (header: string, rule: string, format = "Any text you choose; used to link rows"): ImportColumn => ({ header, rule, format });

export const IMPORT_COLUMNS: Record<ImportSheet, readonly ImportColumn[]> = {
  Owners: [
    key("Owner key", req),
    { header: "Owner name", rule: req, format: "Up to 200 characters" },
    { header: "Owner type", rule: req, format: "LLC, Corporation, Partnership, Trust, Individual or Other" },
    { header: "Mailing address line 1", rule: req },
    { header: "Mailing address line 2", rule: opt },
    { header: "City", rule: req },
    { header: "State", rule: req, format: "2-letter code" },
    { header: "ZIP code", rule: req, format: "5 or 9 digits" },
    { header: "Email", rule: opt, format: "A valid email address" },
    { header: "Phone", rule: opt },
    { header: "Signatory name", rule: opt, format: "Printed on leases" },
    { header: "Signatory title", rule: opt, format: "For example Managing Member" },
    { header: "Notes", rule: opt },
  ],
  Properties: [
    key("Property key", req),
    key("Owner key", req, "An Owner key from the Owners sheet"),
    { header: "Property name", rule: req, format: "Must not match an existing property" },
    { header: "Street address", rule: req },
    { header: "City", rule: req },
    { header: "State", rule: req, format: "2-letter code" },
    { header: "ZIP code", rule: req },
    { header: "Located in New York City", rule: opt, format: `${YES_NO}; Yes if left empty` },
    { header: "Borough-Block-Lot (BBL)", rule: opt, format: "10 digits" },
    { header: "Year built", rule: opt, format: "Whole number, 1700 to this year" },
    { header: "Responsible landlord emails", rule: opt, format: "Emails of active Admin or Landlord users, separated by “;”. Empty = you." },
    { header: "Purchase price", rule: opt, format: MONEY },
    { header: "Purchase date", rule: opt, format: DATE },
    { header: "Notes", rule: opt },
  ],
  Units: [
    key("Unit key", req),
    key("Property key", req, "A Property key from the Properties sheet"),
    { header: "Unit label", rule: req, format: "Unique within the property, for example 2R" },
    { header: "Use", rule: req, format: "Residential or Commercial" },
    { header: "Bedrooms", rule: opt, format: "Whole number, 0 to 20" },
    { header: "Bathrooms", rule: opt, format: "Number, for example 1.5" },
    { header: "Square feet", rule: opt, format: "Whole number" },
    key("Owner override key", opt, "An Owner key, only if the unit’s owner differs from the property’s"),
    { header: "Notes", rule: opt },
  ],
  Tenants: [
    key("Tenant key", req),
    { header: "Tenant type", rule: req, format: "Individual or Business" },
    { header: "First name", rule: "Required for Individual" },
    { header: "Last name", rule: "Required for Individual" },
    { header: "Business name", rule: "Required for Business" },
    { header: "Contact person", rule: "Required for Business" },
    { header: "Email", rule: opt, format: "A valid email address" },
    { header: "Phone", rule: opt },
    { header: "Notes", rule: opt },
  ],
  Leases: [
    key("Unit key", req, "A Unit key from the Units sheet"),
    key("Tenant 1 key", req, "A Tenant key; the primary tenant"),
    key("Tenant 2 key", opt, "A Tenant key"),
    key("Tenant 3 key", opt, "A Tenant key"),
    key("Tenant 4 key", opt, "A Tenant key"),
    { header: "Lease start date", rule: req, format: DATE },
    { header: "Lease end date", rule: req, format: `${DATE}; after the start date` },
    { header: "Monthly rent", rule: req, format: `${MONEY}; more than 0` },
    { header: "Rent increases", rule: opt, format: "None or Percent; None if left empty" },
    { header: "Annual increase (%)", rule: "Required if Rent increases is Percent", format: "Number, 3 = 3%; more than 0, up to 50" },
    { header: "Security deposit", rule: opt, format: MONEY },
    { header: "Rent due day", rule: opt, format: "Whole number, 1 to 28; 1 if left empty" },
    { header: "Late fee", rule: opt, format: MONEY },
    { header: "Late fee grace period (days)", rule: opt, format: "Whole number, 0 to 31" },
    { header: "Pets", rule: opt },
    { header: "Parking", rule: opt, format: "For example Space #4" },
    { header: "Parking charge (monthly)", rule: opt, format: MONEY },
    { header: "Children reside in unit", rule: "Required for Residential units", format: YES_NO },
    { header: "Break clause", rule: opt },
    { header: "Other special terms", rule: opt },
    { header: "Base tax year", rule: "Commercial units only; optional", format: "Whole number; must match a tax year of the property" },
    { header: "Tenant's share of tax increase (%)", rule: "Commercial units only; required if Base tax year is set", format: "Number; more than 0, up to 100" },
    { header: "Month-to-month", rule: opt, format: `${YES_NO}; No if left empty` },
    { header: "Month-to-month monthly rent", rule: opt, format: MONEY },
    { header: "Move-out date", rule: opt, format: DATE },
    { header: "Reason", rule: "Required with Move-out date", format: "Tenant moved out, Not renewed, Terminated, Tenant broke lease, Replaced by new lease or Other" },
  ],
};

export const IMPORT_TEMPLATE_FILENAME = "rentnerd-import-template.xlsx";

export const IMPORT_INSTRUCTIONS: readonly string[] = [
  "How to import your portfolio",
  "1. Fill in the sheets Owners, Properties, Units, Tenants and Leases, starting on row 2. Keep the column headings as they are.",
  "2. Link rows with keys you choose (for example O1, P1, U1, T1). A key only has to be the same everywhere it is used in this file.",
  "3. A single-unit property still needs a row in the Units sheet.",
  "4. Dates can be real Excel dates or text like 2026-01-31. Money can be a number or text like 2,150.00. Percentages are numbers (3 means 3%). Yes/no columns take Yes or No.",
  "5. Each Leases row is the first lease term. Lease extensions are not imported, and only increase types None and Percent are supported.",
  "6. Import only creates new records. Owners and tenants with the same names as existing ones are created as separate records.",
  "7. In RentNerd, open Import, choose the file and click Check file. If there are problems, fix them in the spreadsheet and check again. Nothing is imported until you click Import.",
  "The columns of every sheet are listed below.",
];
