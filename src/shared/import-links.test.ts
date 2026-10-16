import { describe, expect, it } from "vitest";
import type { Cell } from "./import-parse";
import { checkImportSheets } from "./import-validate";

const row = (n: number, cells: Record<string, Cell>) => ({ row: n, cells: new Map(Object.entries(cells)) });
const owner = { "Owner key": "O1", "Owner name": "Acme LLC", "Owner type": "LLC", "Mailing address line 1": "5 Way", City: "Brooklyn", State: "NY", "ZIP code": "11201" };
const property = { "Property key": "P1", "Owner key": "O1", "Property name": "Elm House", "Street address": "1 Elm St", City: "Brooklyn", State: "NY", "ZIP code": "11201", "Located in New York City": "Yes" };
const unit = { "Unit key": "U1", "Property key": "P1", "Unit label": "1R", Use: "Residential" };
const tenant = (key: string) => ({ "Tenant key": key, "Tenant type": "Individual", "First name": "Ann", "Last name": key });
const lease = { "Unit key": "U1", "Tenant 1 key": "T1", "Lease start date": "2027-01-01", "Lease end date": "2027-12-31", "Monthly rent": "2000", "Rent increases": "None", "Children reside in unit": "No" };
const without = (c: Record<string, Cell>, key: string) => Object.fromEntries(Object.entries(c).filter(([k]) => k !== key));
const none = { propertyNames: new Set<string>(), landlordEmails: new Set(["a@example.com"]) };

type Sheets = Partial<Record<"Owners" | "Properties" | "Units" | "Tenants" | "Leases", Record<string, Cell>[]>>;
const check = (s: Sheets, existing = none) => {
  const rows = (name: keyof Sheets) => ({ rows: (s[name] ?? []).map((c, i) => row(i + 2, c)) });
  return checkImportSheets({ Owners: rows("Owners"), Properties: rows("Properties"), Units: rows("Units"), Tenants: rows("Tenants"), Leases: rows("Leases") }, existing).errors;
};
const base: Sheets = { Owners: [owner], Properties: [property], Units: [unit], Tenants: [tenant("T1")], Leases: [lease] };

describe("import links", () => {
  it("accepts a consistent file", () => expect(check(base)).toEqual([]));

  it("reports an unknown property key with the spec's wording", () => {
    expect(check({ ...base, Units: [{ ...unit, "Property key": "X" }], Leases: [] })).toEqual([
      { sheet: "Units", row: 2, column: "Property key", problem: "No property with key 'X' in the Properties sheet." },
    ]);
  });

  it("reports unknown owner, owner override, unit and tenant keys", () => {
    const errors = check({
      Owners: [owner], Tenants: [tenant("T1")],
      Properties: [{ ...property, "Owner key": "Z" }],
      Units: [{ ...unit, "Owner override key": "Y" }],
      Leases: [{ ...lease, "Unit key": "NOPE", "Tenant 2 key": "T9" }],
    });
    expect(errors.map((e) => `${e.sheet}|${e.column}|${e.problem}`)).toEqual([
      "Properties|Owner key|No owner with key 'Z' in the Owners sheet.",
      "Units|Owner override key|No owner with key 'Y' in the Owners sheet.",
      "Leases|Unit key|No unit with key 'NOPE' in the Units sheet.",
      "Leases|Tenant 2 key|No tenant with key 'T9' in the Tenants sheet.",
    ]);
  });

  it("flags a key used twice and a tenant listed twice on one lease", () => {
    const errors = check({ ...base, Tenants: [tenant("T1"), tenant("T1")], Leases: [{ ...lease, "Tenant 2 key": "T1" }] });
    expect(errors).toEqual([
      { sheet: "Tenants", row: 3, column: "Tenant key", problem: "The key 'T1' is used more than once in the Tenants sheet." },
      { sheet: "Leases", row: 2, column: "Tenant 2 key", problem: "Each tenant can be added once." },
    ]);
  });

  it("flags property names that exist already or repeat in the file, ignoring case", () => {
    const again = { ...property, "Property key": "P2", "Property name": "ELM house" };
    expect(check({ ...base, Properties: [property, again] }).map((e) => [e.row, e.problem])).toEqual([[3, "A property with this name already exists."]]);
    const taken = { ...none, propertyNames: new Set(["elm house"]) };
    expect(check(base, taken)).toEqual([{ sheet: "Properties", row: 2, column: "Property name", problem: "A property with this name already exists." }]);
  });

  it("flags a repeated unit label within a property only", () => {
    const other = { ...property, "Property key": "P2", "Property name": "Oak House" };
    const sheets = { ...base, Properties: [property, other], Leases: [] };
    expect(check({ ...sheets, Units: [unit, { ...unit, "Unit key": "U2" }] })).toEqual([
      { sheet: "Units", row: 3, column: "Unit label", problem: "A unit with this label already exists in this property." },
    ]);
    expect(check({ ...sheets, Units: [unit, { ...unit, "Unit key": "U2", "Property key": "P2" }] })).toEqual([]);
  });

  it("checks responsible landlord emails against active users", () => {
    expect(check({ ...base, Properties: [{ ...property, "Responsible landlord emails": "A@example.com; a@example.com" }] })).toEqual([]);
    expect(check({ ...base, Properties: [{ ...property, "Responsible landlord emails": "a@example.com;who@example.com" }] })).toEqual([
      { sheet: "Properties", row: 2, column: "Responsible landlord emails", problem: "Choose only active Admin or Landlord users." },
    ]);
  });

  it("applies the residential and commercial lease rules for the unit's use", () => {
    const noChildren = without(lease, "Children reside in unit");
    expect(check({ ...base, Leases: [noChildren] })).toEqual([{ sheet: "Leases", row: 2, column: "Children reside in unit", problem: "Choose Yes or No." }]);
    const commercial = { ...base, Units: [{ ...unit, Use: "Commercial" }] };
    expect(check({ ...commercial, Leases: [lease] })).toEqual([{ sheet: "Leases", row: 2, column: "Children reside in unit", problem: "This applies to residential units only." }]);
    const plain = noChildren;
    expect(check({ ...commercial, Leases: [plain] })).toEqual([]);
    expect(check({ ...commercial, Leases: [{ ...plain, "Base tax year": 2025, "Tenant's share of tax increase (%)": 10 }] })).toEqual([
      { sheet: "Leases", row: 2, column: "Base tax year", problem: "Choose a tax year that has been entered for this property." },
    ]);
    expect(check({ ...base, Leases: [{ ...lease, "Base tax year": 2025 }] })).toEqual([{ sheet: "Leases", row: 2, column: "Base tax year", problem: "Tax terms apply to commercial units only." }]);
  });

  it("requires the end date after the start and a reason with a move-out date", () => {
    expect(check({ ...base, Leases: [{ ...lease, "Lease end date": "2027-01-01" }] })).toEqual([{ sheet: "Leases", row: 2, column: "Lease end date", problem: "The end date must be after the start date." }]);
    expect(check({ ...base, Leases: [{ ...lease, "Move-out date": "2027-06-01" }] })).toEqual([{ sheet: "Leases", row: 2, column: "Reason", problem: "Choose a reason." }]);
  });

  it("flags overlapping leases on one unit, honouring move-out dates", () => {
    const second = { ...lease, "Lease start date": "2027-06-01", "Lease end date": "2028-05-31" };
    expect(check({ ...base, Leases: [lease, second] })).toEqual([{ sheet: "Leases", row: 3, column: "Lease start date", problem: "This unit already has a lease for those dates." }]);
    const early = { ...lease, "Move-out date": "2027-05-31", Reason: "Tenant moved out" };
    expect(check({ ...base, Leases: [early, second] })).toEqual([]);
    const open = { ...lease, "Month-to-month": "Yes" };
    expect(check({ ...base, Leases: [open, { ...second, "Lease start date": "2030-01-01", "Lease end date": "2030-12-31" }] }).length).toBe(1);
  });

  it("skips link checks while a sheet or column is missing", () => {
    const out = checkImportSheets({ Owners: { rows: [] }, Properties: { rows: [] }, Units: { missing: ["Use"], rows: [row(2, unit)] }, Tenants: { rows: [] }, Leases: { rows: [row(2, lease)] } }, none);
    expect(out.errors).toEqual([{ sheet: "Units", row: 1, column: "Use", problem: "The column Use is missing. Use the template." }]);
  });
});
