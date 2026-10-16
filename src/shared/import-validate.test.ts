import { describe, expect, it } from "vitest";
import type { Cell } from "./import-parse";
import { checkImportRow, checkImportSheets, tooManyRows } from "./import-validate";

const row = (n: number, cells: Record<string, Cell>) => ({ row: n, cells: new Map(Object.entries(cells)) });
const owner = { "Owner key": "O1", "Owner name": "Acme LLC", "Owner type": "LLC", "Mailing address line 1": "5 Way", City: "Brooklyn", State: "NY", "ZIP code": 11201 };
const lease = { "Unit key": "U1", "Tenant 1 key": "T1", "Lease start date": new Date(Date.UTC(2026, 0, 1)), "Lease end date": "2026-12-31", "Monthly rent": "2,150.00", "Rent increases": "None", "Children reside in unit": "No" };

describe("checkImportRow", () => {
  it("accepts valid rows", () => {
    expect(checkImportRow("Owners", row(2, owner))).toEqual([]);
    expect(checkImportRow("Leases", row(2, lease))).toEqual([]);
  });

  it("names the column and uses the field's normal message", () => {
    expect(checkImportRow("Owners", row(5, { ...owner, "Owner type": "Club", "ZIP code": "1" }))).toEqual([
      { sheet: "Owners", row: 5, column: "Owner type", problem: "Select an owner type." },
      { sheet: "Owners", row: 5, column: "ZIP code", problem: "Enter a 5 or 9 digit ZIP code." },
    ]);
  });

  it("reports a cell that can't be read once, not again as missing", () => {
    expect(checkImportRow("Leases", row(3, { ...lease, "Lease start date": "soon" }))).toEqual([
      { sheet: "Leases", row: 3, column: "Lease start date", problem: "Enter a valid date." },
    ]);
  });

  it("reports missing required fields and keys", () => {
    const problems = checkImportRow("Units", row(4, { "Unit key": "U1", Use: "Residential" }));
    expect(problems).toContainEqual({ sheet: "Units", row: 4, column: "Property key", problem: "Enter the Property key." });
    expect(problems).toContainEqual({ sheet: "Units", row: 4, column: "Unit label", problem: "Enter the unit label." });
  });

  it("applies the tenant type rules", () => {
    const problems = checkImportRow("Tenants", row(2, { "Tenant key": "T1", "Tenant type": "Business", "Business name": "Shop" }));
    expect(problems).toEqual([{ sheet: "Tenants", row: 2, column: "Contact person", problem: "Enter a contact person." }]);
  });

  it("flags an invalid email like the tenant form does", () => {
    const problems = checkImportRow("Tenants", row(2, { "Tenant key": "T1", "Tenant type": "Individual", "First name": "A", "Last name": "B", Email: "nope" }));
    expect(problems).toEqual([{ sheet: "Tenants", row: 2, column: "Email", problem: "Enter a valid email address." }]);
  });
});

describe("checkImportSheets", () => {
  it("counts rows per sheet and has no errors for valid data", () => {
    const empty = { rows: [] };
    const out = checkImportSheets({ Owners: { rows: [row(2, owner)] }, Properties: empty, Units: empty, Tenants: empty, Leases: empty });
    expect(out).toEqual({ errors: [], counts: { Owners: 1, Properties: 0, Units: 0, Tenants: 0, Leases: 0 } });
  });

  it("reports missing sheets and columns", () => {
    const empty = { rows: [] };
    const out = checkImportSheets({ Owners: { missing: ["Owner name"], rows: [] }, Properties: empty, Units: empty, Tenants: empty });
    expect(out.errors).toEqual([
      { sheet: "Owners", row: 1, column: "Owner name", problem: "The column Owner name is missing. Use the template." },
      { sheet: "Leases", row: null, column: null, problem: "The workbook has no sheet named Leases. Use the template." },
    ]);
  });
});

it("allows 5,000 data rows below the heading and no more", () => {
  expect(tooManyRows(5001)).toBe(false);
  expect(tooManyRows(5002)).toBe(true);
});
