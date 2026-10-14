import { describe, expect, it } from "vitest";
import { tenantStepIssue } from "./lease-wizard";

const rows = [
  { key: "a", tenantId: "t1", name: "Ann Lee" },
  { key: "b", name: "Bo Diaz" },
];

describe("tenantStepIssue", () => {
  it("needs at least one tenant", () => expect(tenantStepIssue([], null)).toBe("Add at least one tenant."));
  it("needs a primary contact", () => expect(tenantStepIssue(rows, null)).toBe("Choose a primary contact."));
  it("ignores a primary contact who was removed", () => expect(tenantStepIssue(rows, "gone")).toBe("Choose a primary contact."));
  it("passes with a primary contact", () => expect(tenantStepIssue(rows, "b")).toBeNull());
});

import { blankTermStep, draftRentTerm, showsMoveOut, termStepIssues, type TermStepDraft } from "./lease-wizard";

const TODAY = "2026-10-12";
const ok: TermStepDraft = { ...blankTermStep, startDate: "2026-11-01", endDate: "2027-10-31", baseRentCents: 215000 };

describe("termStepIssues", () => {
  it("passes a complete term", () => expect(termStepIssues(ok, TODAY)).toEqual({}));
  it("asks for the required fields", () =>
    expect(termStepIssues(blankTermStep, TODAY)).toEqual({
      startDate: "Enter the lease start date.", endDate: "Enter the lease end date.", baseRentCents: "Enter the monthly rent.",
    }));
  it("refuses an end date on or before the start", () => {
    expect(termStepIssues({ ...ok, endDate: "2026-11-01" }, TODAY).endDate).toBe("Lease end date must be after the start date.");
    expect(termStepIssues({ ...ok, endDate: "2026-10-01" }, TODAY).endDate).toBe("Lease end date must be after the start date.");
  });
  it("refuses a term longer than 50 years", () => {
    expect(termStepIssues({ ...ok, endDate: "2076-11-02" }, TODAY).endDate).toBe("Lease end date must be within 50 years of the start date.");
    expect(termStepIssues({ ...ok, endDate: "2076-11-01" }, TODAY)).toEqual({});
    expect(draftRentTerm({ ...ok, endDate: "9999-12-31" })).toBeNull();
  });
  it("checks the due day, grace days and money fields", () => {
    const r = termStepIssues({ ...ok, rentDueDay: "29", lateFeeGraceDays: "32", securityDepositCents: -5, lateFeeCents: Number.NaN, baseRentCents: 0 }, TODAY);
    expect(r).toMatchObject({
      rentDueDay: "Enter a whole number from 1 to 28.", lateFeeGraceDays: "Enter a whole number from 0 to 31.",
      securityDepositCents: "The amount can't be negative.", lateFeeCents: "Enter an amount.", baseRentCents: "Enter an amount above 0.",
    });
  });
  it("checks the percentage only for a fixed percentage", () => {
    expect(termStepIssues({ ...ok, increasePercent: "99" }, TODAY)).toEqual({});
    for (const p of ["", "0", "51", "abc", "3.12345"]) expect(termStepIssues({ ...ok, increaseType: "percent", increasePercent: p }, TODAY).increasePercent).toBe("Enter a percentage above 0 and up to 50.");
    expect(termStepIssues({ ...ok, increaseType: "percent", increasePercent: "3" }, TODAY)).toEqual({});
  });
  it("needs a schedule row inside the term, in order", () => {
    const sched = (...rows: [string, number | null][]): TermStepDraft => ({
      ...ok, increaseType: "schedule", steps: rows.map(([effectiveDate, amountCents], i) => ({ key: `r${i}`, effectiveDate, amountCents })),
    });
    expect(termStepIssues(sched(), TODAY).steps).toBe("Add at least one rent step.");
    expect(termStepIssues(sched(["2028-06-01", 220000]), TODAY)["steps.r0.date"]).toBe("Effective date must fall within the lease term.");
    expect(termStepIssues(sched(["2026-11-01", 220000]), TODAY)["steps.r0.date"]).toBe("Effective date must fall within the lease term.");
    expect(termStepIssues(sched(["2027-10-31", 220000]), TODAY)["steps.r0.date"]).toBe("Effective date must fall within the lease term.");
    expect(termStepIssues(sched(["2027-03-01", 220000], ["2027-02-01", 230000]), TODAY)["steps.r1.date"]).toBe("Effective dates must be in increasing order.");
    expect(termStepIssues(sched(["", null]), TODAY)).toMatchObject({ "steps.r0.date": "Enter the effective date.", "steps.r0.amount": "Enter the monthly rent." });
    expect(termStepIssues(sched(["2027-03-01", 220000]), TODAY)).toEqual({});
  });
  it("offers Move-out date and Reason only for a lease that ended before today, and needs both or neither", () => {
    const past = { ...ok, startDate: "2025-01-01", endDate: "2025-12-31" };
    expect(showsMoveOut(past, TODAY)).toBe(true);
    expect(showsMoveOut(ok, TODAY)).toBe(false);
    expect(showsMoveOut({ endDate: TODAY }, TODAY)).toBe(false);
    expect(termStepIssues(past, TODAY)).toEqual({});
    expect(termStepIssues({ ...past, moveOutDate: "2025-12-01" }, TODAY).endReason).toBe("Choose a reason.");
    expect(termStepIssues({ ...past, endReason: "Other" }, TODAY).moveOutDate).toBe("Enter the move-out date.");
    expect(termStepIssues({ ...past, moveOutDate: "2025-12-01", endReason: "Other" }, TODAY)).toEqual({});
  });
});

describe("draftRentTerm", () => {
  it("is null until the dates and rent make a term", () => {
    expect(draftRentTerm(blankTermStep)).toBeNull();
    expect(draftRentTerm({ ...ok, endDate: ok.startDate })).toBeNull();
  });
  it("builds the term for each increase type, ignoring unfinished rows", () => {
    expect(draftRentTerm(ok)).toEqual({ startDate: "2026-11-01", endDate: "2027-10-31", rentCents: 215000, increaseType: "none" });
    expect(draftRentTerm({ ...ok, increaseType: "percent", increasePercent: "3" })).toMatchObject({ increaseType: "percent", increasePercent: "3" });
    expect(draftRentTerm({ ...ok, increaseType: "percent", increasePercent: "" })).toMatchObject({ increaseType: "none" });
    const t = draftRentTerm({ ...ok, increaseType: "schedule", steps: [{ key: "a", effectiveDate: "2027-03-01", amountCents: 220000 }, { key: "b", effectiveDate: "", amountCents: null }] });
    expect(t).toMatchObject({ increaseType: "schedule", steps: [{ effectiveDate: "2027-03-01", amountCents: 220000 }] });
    const outside = draftRentTerm({ ...ok, increaseType: "schedule", steps: [{ key: "a", effectiveDate: ok.startDate, amountCents: 1 }, { key: "b", effectiveDate: ok.endDate, amountCents: 1 }] });
    expect(outside).toMatchObject({ steps: [] });
  });
});
