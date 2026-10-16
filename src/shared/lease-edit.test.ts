import { describe, expect, it } from "vitest";
import { draftsFromLease, leaseUpdateBody, type EditableLease } from "./lease-edit";

const lease: EditableLease = {
  startDate: "2026-11-01", endDate: "2027-10-31", baseRentCents: 215000, securityDepositCents: null, rentDueDay: 1, lateFeeCents: 5000, lateFeeGraceDays: 5,
  increaseType: "percent", increasePercent: 3, rentSteps: [], moveOutDate: null, endReason: null, pets: "One cat", parking: null, parkingChargeCents: null,
  childrenReside: false, breakClause: null, otherTerms: null, baseTaxYear: null, taxSharePercent: null,
  masterTenants: [{ tenantId: "a", isPrimary: false, displayName: "Ann Lee" }, { tenantId: "b", isPrimary: true, displayName: "Bo Diaz" }],
};

describe("draftsFromLease", () => {
  it("turns a lease into the wizard drafts", () => {
    const d = draftsFromLease(lease);
    expect(d.primary).toBe("b");
    expect(d.rows.map((r) => r.name)).toEqual(["Ann Lee", "Bo Diaz"]);
    expect(d.term).toMatchObject({ baseRentCents: 215000, rentDueDay: "1", lateFeeGraceDays: "5", increaseType: "percent", increasePercent: "3", moveOutDate: "" });
    expect(d.special).toMatchObject({ pets: "One cat", parking: "", childrenReside: "No", baseTaxYear: "" });
  });
  it("keeps rent steps in order and an unset children answer empty", () => {
    const d = draftsFromLease({ ...lease, increaseType: "schedule", increasePercent: null, childrenReside: null, rentSteps: [{ effectiveDate: "2027-03-01", amountCents: 220000 }] });
    expect(d.term.steps).toEqual([{ key: "step-0", effectiveDate: "2027-03-01", amountCents: 220000 }]);
    expect(d.special.childrenReside).toBe("");
  });
});

describe("leaseUpdateBody", () => {
  it("sends the version and existing tenants only, and leaves an early move-out alone", () => {
    const d = draftsFromLease({ ...lease, moveOutDate: "2027-03-01", endReason: "Tenant moved out" });
    const body = leaseUpdateBody(4, d.rows, d.primary, d.term, d.special, "Residential", "2026-12-01");
    expect(body.version).toBe(4);
    expect(body.tenants).toEqual([{ tenantId: "a", isPrimary: false }, { tenantId: "b", isPrimary: true }]);
    expect(body).not.toHaveProperty("newTenants");
    expect(body).not.toHaveProperty("moveOutDate");
    expect(body).not.toHaveProperty("endReason");
    expect(body).toMatchObject({ baseRentCents: 215000, increasePercent: 3, childrenReside: false });
  });
  it("sends the move-out fields when the end date is in the past", () => {
    const d = draftsFromLease({ ...lease, moveOutDate: "2027-03-01", endReason: "Tenant moved out" });
    const body = leaseUpdateBody(2, d.rows, d.primary, d.term, d.special, "Residential", "2028-01-01");
    expect(body).toMatchObject({ moveOutDate: "2027-03-01", endReason: "Tenant moved out" });
  });
});
