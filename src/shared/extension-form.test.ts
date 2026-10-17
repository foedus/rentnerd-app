import { describe, expect, it } from "vitest";
import { createExtensionSchema } from "./schemas";
import { draftFromExtension, extensionBody, extensionIssues, keepsMasterTenant, MASTER_TENANT_MESSAGE, newExtensionDraft } from "./extension-form";

const today = "2027-01-01";
const previous = {
  startDate: "2026-11-01", endDate: "2027-10-31", baseRentCents: 200000, increaseType: "none" as const, increasePercent: null, rentSteps: [],
  securityDepositCents: 215000, rentDueDay: 5, lateFeeCents: 5000, lateFeeGraceDays: 5, pets: "One cat", parking: "Space #4", parkingChargeCents: 10000,
  childrenReside: true, breakClause: null, otherTerms: "Tenant pays electricity.", baseTaxYear: null, taxSharePercent: null,
  tenants: [{ tenantId: "t1", isPrimary: true, displayName: "Ann Lee" }, { tenantId: "t2", isPrimary: false, displayName: "Bo Lee" }],
};
const fresh = () => newExtensionDraft(previous, "2027-10-31");
const ready = () => {
  const d = fresh();
  return { ...d, term: { ...d.term, endDate: "2028-10-31", baseRentCents: 225000 } };
};

describe("extension form", () => {
  it("starts the day after the effective end, with tenants and terms from the previous term", () => {
    expect(fresh().term.startDate).toBe("2027-11-01");
    expect(newExtensionDraft(previous, "2027-12-31").term.startDate).toBe("2028-01-01");
    const d = fresh();
    expect(d.rows).toEqual([{ key: "t1", tenantId: "t1", name: "Ann Lee" }, { key: "t2", tenantId: "t2", name: "Bo Lee" }]);
    expect(d.primary).toBe("t1");
    expect(d.term).toMatchObject({ securityDepositCents: 215000, rentDueDay: "5", lateFeeCents: 5000, lateFeeGraceDays: "5", baseRentCents: null, endDate: "" });
    expect(d.special).toMatchObject({ pets: "One cat", parking: "Space #4", parkingChargeCents: 10000, childrenReside: "Yes", otherTerms: "Tenant pays electricity." });
  });

  it("has no problems when the dates and rent are filled in", () => {
    expect(extensionIssues(ready(), today, "Residential")).toEqual({});
  });

  it("asks for the end date and rent, naming the extension", () => {
    expect(extensionIssues(fresh(), today, "Residential")).toEqual({ endDate: "Enter the extension end date.", baseRentCents: "Enter the monthly rent." });
  });

  it("checks the other terms too", () => {
    const d = ready();
    d.term.rentDueDay = "31";
    d.special.childrenReside = "";
    expect(extensionIssues(d, today, "Residential")).toMatchObject({ rentDueDay: "Enter a whole number from 1 to 28.", childrenReside: "Choose Yes or No." });
    expect(extensionIssues(d, today, "Commercial").childrenReside).toBeUndefined();
  });

  it("says Extension end date when the end is not after the start", () => {
    const d = ready();
    d.term.endDate = "2027-11-01";
    expect(extensionIssues(d, today, "Residential").endDate).toBe("Extension end date must be after the start date.");
  });

  it("checks a percentage and the custom schedule rows", () => {
    const d = ready();
    d.term.increaseType = "percent";
    expect(extensionIssues(d, today, "Residential").increasePercent).toBeDefined();
    d.term.increaseType = "schedule";
    expect(extensionIssues(d, today, "Residential").steps).toBe("Add at least one rent step.");
    d.term.steps = [{ key: "a", effectiveDate: "2029-01-01", amountCents: 230000 }];
    expect(extensionIssues(d, today, "Residential")["steps.a.date"]).toBe("Effective date must fall within the extension term.");
  });

  it("limits the notes", () => {
    const d = ready();
    d.notes = "x".repeat(5001);
    expect(extensionIssues(d, today, "Residential").notes).toBe("Use 5000 characters or fewer.");
  });

  it("needs a master-lease tenant to stay", () => {
    const rows = [{ key: "n", tenantId: "t9", name: "New" }];
    expect(keepsMasterTenant(rows, ["t1", "t2"])).toBe(false);
    expect(keepsMasterTenant([...rows, { key: "t2", tenantId: "t2", name: "Bo" }], ["t1", "t2"])).toBe(true);
    expect(MASTER_TENANT_MESSAGE).toBe("At least one tenant from the original lease must stay. To change all tenants, end this lease and create a new lease.");
  });

  it("builds a body with the tenants and every term", () => {
    const d = ready();
    d.rows = [d.rows[0]!, { key: "row-0", tenantId: "t9", name: "New" }];
    d.primary = "row-0";
    d.special.parkingChargeCents = 15000;
    const body = extensionBody({ ...d, notes: "  Renewal " }, 3, "Residential");
    expect(body).toMatchObject({
      tenants: [{ tenantId: "t1", isPrimary: false }, { tenantId: "t9", isPrimary: true }],
      startDate: "2027-11-01", endDate: "2028-10-31", baseRentCents: 225000, increaseType: "none", increasePercent: null, rentSteps: [], notes: "Renewal", version: 3,
      securityDepositCents: 215000, rentDueDay: 5, lateFeeCents: 5000, lateFeeGraceDays: 5, pets: "One cat", parking: "Space #4", parkingChargeCents: 15000, childrenReside: true,
      breakClause: null, otherTerms: "Tenant pays electricity.", baseTaxYear: null, taxSharePercent: null,
    });
  });

  it("sends the percentage or the schedule only for its increase type", () => {
    const d = ready();
    d.term.increaseType = "percent";
    d.term.increasePercent = "3";
    expect(extensionBody(d, 1, "Residential")).toMatchObject({ increasePercent: 3, rentSteps: [] });
    d.term.increaseType = "schedule";
    d.term.steps = [{ key: "a", effectiveDate: "2028-05-01", amountCents: 230000 }];
    expect(extensionBody(d, 1, "Residential")).toMatchObject({ increasePercent: null, rentSteps: [{ effectiveDate: "2028-05-01", amountCents: 230000 }] });
  });

  it("sends tax terms only for a commercial unit", () => {
    const d = ready();
    d.special.baseTaxYear = "2024";
    d.special.taxSharePercent = "12.5";
    expect(extensionBody(d, 1, "Commercial")).toMatchObject({ childrenReside: null, baseTaxYear: 2024, taxSharePercent: 12.5 });
    expect(extensionBody(d, 1, "Residential")).toMatchObject({ baseTaxYear: null, taxSharePercent: null });
  });

  it("fills the draft from a saved extension", () => {
    const d = draftFromExtension({ ...previous, startDate: "2027-11-01", endDate: "2028-10-31", baseRentCents: 225000, increaseType: "percent", increasePercent: 2.5, notes: null });
    expect(d.term).toMatchObject({ startDate: "2027-11-01", increasePercent: "2.5", baseRentCents: 225000 });
    expect(d.notes).toBe("");
  });
});

describe("extension request version", () => {
  const message = (version: unknown) => {
    const r = createExtensionSchema.safeParse({ endDate: "2028-10-31", baseRentCents: 225000, version });
    return r.success ? null : r.error.issues[0]?.message;
  };
  it("asks for a version when missing and for a positive whole number when it is 0 or fractional", () => {
    expect(message(undefined)).toBe("version is required");
    expect(message(0)).toBe("version must be a positive whole number");
    expect(message(1.5)).toBe("version must be a positive whole number");
    expect(message(2)).toBeNull();
  });
});
