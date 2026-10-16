import { describe, expect, it } from "vitest";
import { IMPORT_COLUMNS, IMPORT_SHEETS } from "./import-template";

describe("import template columns", () => {
  it("has no repeated heading on a sheet", () => {
    for (const s of IMPORT_SHEETS) {
      const headers = IMPORT_COLUMNS[s].map((c) => c.header);
      expect(new Set(headers).size).toBe(headers.length);
    }
  });

  it("starts each sheet with the key columns the spec names", () => {
    expect(IMPORT_COLUMNS.Owners[0]?.header).toBe("Owner key");
    expect(IMPORT_COLUMNS.Properties.slice(0, 2).map((c) => c.header)).toEqual(["Property key", "Owner key"]);
    expect(IMPORT_COLUMNS.Units.map((c) => c.header)).toEqual(expect.arrayContaining(["Unit key", "Property key", "Owner override key"]));
    expect(IMPORT_COLUMNS.Tenants[0]?.header).toBe("Tenant key");
    expect(IMPORT_COLUMNS.Leases.slice(0, 5).map((c) => c.header)).toEqual(["Unit key", "Tenant 1 key", "Tenant 2 key", "Tenant 3 key", "Tenant 4 key"]);
  });

  it("uses the §6 labels, the landlord emails column and no Single-unit column", () => {
    expect(IMPORT_COLUMNS.Properties.map((c) => c.header)).toContain("Responsible landlord emails");
    expect(IMPORT_COLUMNS.Properties.map((c) => c.header)).toContain("Located in New York City");
    expect(IMPORT_COLUMNS.Leases.map((c) => c.header)).toEqual(expect.arrayContaining(["Lease start date", "Monthly rent", "Rent increases", "Children reside in unit", "Month-to-month", "Move-out date", "Reason"]));
    for (const s of IMPORT_SHEETS) expect(IMPORT_COLUMNS[s].map((c) => c.header)).not.toContain("Single-unit property");
  });
});
