import { describe, expect, it } from "vitest";
import { draftFromExtension, extensionBody, extensionIssues, newExtensionDraft } from "./extension-form";

const today = "2027-01-01";
const ready = () => {
  const d = newExtensionDraft("2027-10-31");
  return { ...d, term: { ...d.term, endDate: "2028-10-31", baseRentCents: 225000 } };
};

describe("extension form", () => {
  it("starts the day after the effective end", () => {
    expect(newExtensionDraft("2027-10-31").term.startDate).toBe("2027-11-01");
    expect(newExtensionDraft("2027-12-31").term.startDate).toBe("2028-01-01");
  });

  it("has no problems when the dates and rent are filled in", () => {
    expect(extensionIssues(ready(), today)).toEqual({});
  });

  it("asks for the end date and rent, naming the extension", () => {
    const issues = extensionIssues(newExtensionDraft("2027-10-31"), today);
    expect(issues).toEqual({ endDate: "Enter the extension end date.", baseRentCents: "Enter the monthly rent." });
  });

  it("says Extension end date when the end is not after the start", () => {
    const d = ready();
    d.term.endDate = "2027-11-01";
    expect(extensionIssues(d, today).endDate).toBe("Extension end date must be after the start date.");
  });

  it("checks a percentage and the custom schedule rows", () => {
    const d = ready();
    d.term.increaseType = "percent";
    expect(extensionIssues(d, today).increasePercent).toBeDefined();
    d.term.increaseType = "schedule";
    expect(extensionIssues(d, today).steps).toBe("Add at least one rent step.");
    d.term.steps = [{ key: "a", effectiveDate: "2029-01-01", amountCents: 230000 }];
    expect(extensionIssues(d, today)["steps.a.date"]).toBe("Effective date must fall within the extension term.");
  });

  it("limits the notes", () => {
    const d = ready();
    d.notes = "x".repeat(5001);
    expect(extensionIssues(d, today).notes).toBe("Use 5000 characters or fewer.");
  });

  it("builds a body that leaves tenants and other terms to the server", () => {
    const body = extensionBody({ ...ready(), notes: "  Renewal " }, 3);
    expect(body).toEqual({ startDate: "2027-11-01", endDate: "2028-10-31", baseRentCents: 225000, increaseType: "none", increasePercent: null, rentSteps: [], notes: "Renewal", version: 3 });
    expect(body).not.toHaveProperty("tenants");
  });

  it("sends the percentage or the schedule only for its increase type", () => {
    const d = ready();
    d.term.increaseType = "percent";
    d.term.increasePercent = "3";
    expect(extensionBody(d, 1)).toMatchObject({ increasePercent: 3, rentSteps: [] });
    d.term.increaseType = "schedule";
    d.term.steps = [{ key: "a", effectiveDate: "2028-05-01", amountCents: 230000 }];
    expect(extensionBody(d, 1)).toMatchObject({ increasePercent: null, rentSteps: [{ effectiveDate: "2028-05-01", amountCents: 230000 }] });
  });

  it("fills the draft from a saved extension", () => {
    const d = draftFromExtension({ startDate: "2027-11-01", endDate: "2028-10-31", baseRentCents: 225000, increaseType: "percent", increasePercent: 2.5, rentSteps: [], notes: null });
    expect(d.term).toMatchObject({ startDate: "2027-11-01", increasePercent: "2.5", baseRentCents: 225000 });
    expect(d.notes).toBe("");
  });
});
