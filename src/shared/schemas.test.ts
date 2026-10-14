import { describe, expect, it } from "vitest";
import { acceptInvitationSchema, extensionFieldsSchema, leaseFieldsSchema, leaseRuleIssues, termRuleIssues, createOwnerSchema, createPropertyTaxSchema, createPropertyValueSchema, ownerListQuerySchema, updateMeSchema, updateOwnerSchema, updatePropertyTaxSchema, updatePropertyValueSchema, versionSchema, createTenantSchema, normalizeTenantNames, tenantListQuerySchema, tenantRuleIssues, updateTenantSchema } from "./schemas";

describe("schemas", () => {
  it("enforces the 12–128 character password and a trimmed name", () => {
    const ok = { token: "t", name: "  Pat Lee ", password: "x".repeat(12) };
    expect(acceptInvitationSchema.parse(ok).name).toBe("Pat Lee");
    expect(acceptInvitationSchema.safeParse({ ...ok, password: "x".repeat(11) }).success).toBe(false);
    expect(acceptInvitationSchema.safeParse({ ...ok, password: "x".repeat(129) }).success).toBe(false);
    expect(acceptInvitationSchema.safeParse({ ...ok, password: "x".repeat(128) }).success).toBe(true);
  });
  it("rejects a blank or over-long name", () => {
    expect(updateMeSchema.safeParse({ name: "   " }).success).toBe(false);
    expect(updateMeSchema.safeParse({ name: "n".repeat(201) }).success).toBe(false);
  });
});

it("rejects all-space passwords in the reset form", async () => {
  const { newPasswordSchema, BLANK_PASSWORD } = await import("./schemas");
  const r = newPasswordSchema.safeParse({ newPassword: " ".repeat(12), confirmPassword: " ".repeat(12) });
  expect(r.success).toBe(false);
  expect(r.error?.issues[0]?.message).toBe(BLANK_PASSWORD);
});

describe("owner schemas", () => {
  const base = { name: "Acme LLC", ownerType: "LLC", addressLine1: "1 A St", city: "Brooklyn", state: "ny", zip: "11201" };
  it("normalises state, blank optionals and email", () => {
    const r = createOwnerSchema.parse({ ...base, email: " A@B.COM ", phone: " ", notes: undefined });
    expect(r).toMatchObject({ state: "NY", email: "a@b.com", phone: null });
  });
  it("reports each missing required field", () => {
    const r = createOwnerSchema.safeParse({});
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => i.path[0]).sort()).toEqual(["addressLine1", "city", "name", "ownerType", "state", "zip"]);
  });
  it("accepts 5 or 9 digit ZIPs only", () => {
    for (const zip of ["11201", "112011234"]) expect(createOwnerSchema.safeParse({ ...base, zip }).success).toBe(true);
    for (const zip of ["1120", "11201-1234", "abcde"]) expect(createOwnerSchema.safeParse({ ...base, zip }).success).toBe(false);
  });
  it("PATCH needs a version; actions don't", () => {
    expect(updateOwnerSchema.safeParse({ city: "Queens" }).success).toBe(false);
    expect(updateOwnerSchema.safeParse({ city: "Queens", version: 2 }).success).toBe(true);
    expect(versionSchema.safeParse({}).success).toBe(true);
  });
  it("list query defaults and limits", () => {
    expect(ownerListQuerySchema.parse({})).toMatchObject({ page: 1, pageSize: 50, sort: "name", order: "asc", archived: "false" });
    expect(ownerListQuerySchema.safeParse({ pageSize: "201" }).success).toBe(false);
  });
});

describe("propertyType", () => {
  it("is derived from unit uses", async () => {
    const { propertyType } = await import("./schemas");
    expect(propertyType([])).toBe("—");
    expect(propertyType(["Residential", "Residential"])).toBe("Residential");
    expect(propertyType(["Commercial"])).toBe("Commercial");
    expect(propertyType(["Residential", "Commercial"])).toBe("Mixed");
  });
});

describe("unit schemas", () => {
  it("requires a label and a use, and trims the label", async () => {
    const { createUnitSchema } = await import("./schemas");
    const bad = createUnitSchema.safeParse({});
    expect(bad.success).toBe(false);
    const ok = createUnitSchema.parse({ label: "  2R ", use: "Residential" });
    expect(ok.label).toBe("2R");
    expect(createUnitSchema.safeParse({ label: "2R", use: "Retail" }).success).toBe(false);
  });

  it("limits bedrooms to 0–20 and bathrooms to one decimal place", async () => {
    const { createUnitSchema } = await import("./schemas");
    const unit = { label: "A", use: "Commercial" as const };
    expect(createUnitSchema.safeParse({ ...unit, bedrooms: 0 }).success).toBe(true);
    expect(createUnitSchema.safeParse({ ...unit, bedrooms: 21 }).success).toBe(false);
    expect(createUnitSchema.safeParse({ ...unit, bedrooms: 1.5 }).success).toBe(false);
    expect(createUnitSchema.safeParse({ ...unit, bathrooms: 1.5 }).success).toBe(true);
    expect(createUnitSchema.safeParse({ ...unit, bathrooms: 1.25 }).success).toBe(false);
    expect(createUnitSchema.safeParse({ ...unit, squareFeet: 0 }).success).toBe(false);
  });

  it("treats blank optional values as null and requires a version to update", async () => {
    const { createUnitSchema, updateUnitSchema } = await import("./schemas");
    expect(createUnitSchema.parse({ label: "A", use: "Residential", bedrooms: "", notes: " " })).toMatchObject({ bedrooms: null, notes: null });
    expect(updateUnitSchema.safeParse({ label: "B" }).success).toBe(false);
    expect(updateUnitSchema.safeParse({ label: "B", version: 1 }).success).toBe(true);
  });
});

describe("property value schema (§6.5)", () => {
  const ok = { valueDate: "2026-06-01", kind: "market_estimate", amountCents: 95_000_000 };
  it("accepts a value with or without a source", () => {
    expect(createPropertyValueSchema.safeParse(ok).success).toBe(true);
    expect(createPropertyValueSchema.safeParse({ ...ok, source: "  " }).data?.source).toBeNull();
  });
  it("refuses a bad date, type or amount with the field message", () => {
    const msg = (v: unknown) => createPropertyValueSchema.safeParse(v).error?.issues[0]?.message;
    expect(msg({ ...ok, valueDate: "2026-02-30" })).toBe("Enter a valid date.");
    expect(msg({ ...ok, kind: "guess" })).toBe("Choose a value type.");
    expect(msg({ ...ok, amountCents: 0 })).toBe("Enter an amount above 0.");
    expect(msg({ ...ok, amountCents: Number.NaN })).toBe("Enter an amount.");
  });
  it("requires a version to update", () => {
    expect(updatePropertyValueSchema.safeParse({ amountCents: 5 }).success).toBe(false);
    expect(updatePropertyValueSchema.safeParse({ amountCents: 5, version: 1 }).success).toBe(true);
  });
});

describe("property tax schema (§6.6)", () => {
  const msg = (v: unknown) => createPropertyTaxSchema.safeParse(v).error?.issues[0]?.message;
  it("accepts years 1990–2100 and a zero amount", () => {
    for (const taxYear of [1990, 2025, 2100]) expect(createPropertyTaxSchema.safeParse({ taxYear, amountCents: 0 }).success).toBe(true);
  });
  it("refuses a year outside the range, a fraction, a blank or a bad amount with the field message", () => {
    const range = "Enter a tax year from 1990 to 2100.";
    expect(msg({ taxYear: 1989, amountCents: 1 })).toBe(range);
    expect(msg({ taxYear: 2101, amountCents: 1 })).toBe(range);
    expect(msg({ taxYear: 2025.5, amountCents: 1 })).toBe(range);
    expect(msg({ taxYear: null, amountCents: 1 })).toBe(range);
    expect(msg({ taxYear: 2025, amountCents: -1 })).toBe("The amount can't be negative.");
    expect(msg({ taxYear: 2025, amountCents: Number.NaN })).toBe("Enter an amount.");
  });
  it("requires a version to update", () => {
    expect(updatePropertyTaxSchema.safeParse({ amountCents: 5 }).success).toBe(false);
    expect(updatePropertyTaxSchema.safeParse({ amountCents: 5, version: 1 }).success).toBe(true);
  });
});

describe("tenant schemas", () => {
  it("accepts an Individual with only names and a Business with a contact person", () => {
    expect(createTenantSchema.safeParse({ tenantType: "Individual", firstName: "Ann", lastName: "Lee" }).success).toBe(true);
    expect(createTenantSchema.safeParse({ tenantType: "Business", businessName: "Acme", contactPerson: "Bo" }).success).toBe(true);
  });
  it("names the missing fields for each type", () => {
    const fields = (v: unknown) => createTenantSchema.safeParse(v).error?.issues.map((i) => `${String(i.path[0])}: ${i.message}`).sort();
    expect(fields({ tenantType: "Individual", firstName: " " })).toEqual(["firstName: Enter a first name.", "lastName: Enter a last name."]);
    expect(fields({ tenantType: "Business" })).toEqual(["businessName: Enter a business name.", "contactPerson: Enter a contact person."]);
    expect(fields({})).toEqual(["tenantType: Choose Individual or Business."]);
  });
  it("normalises blank optional text and validates the email", () => {
    const ok = createTenantSchema.parse({ tenantType: "Individual", firstName: "A", lastName: "B", email: " X@Y.COM ", phone: "", notes: " " });
    expect(ok).toMatchObject({ email: "x@y.com", phone: null, notes: null });
    expect(createTenantSchema.safeParse({ tenantType: "Individual", firstName: "A", lastName: "B", email: "nope" }).success).toBe(false);
  });
  it("PATCH needs a version; rules and normalisation are pure helpers", () => {
    expect(updateTenantSchema.safeParse({ phone: "1" }).success).toBe(false);
    expect(updateTenantSchema.safeParse({ phone: "1", version: 1 }).success).toBe(true);
    expect(tenantRuleIssues({ tenantType: "Business", businessName: "A", contactPerson: null })).toEqual({ contactPerson: "Enter a contact person." });
    expect(normalizeTenantNames({ tenantType: "Business", firstName: "A", lastName: "B", businessName: "C", contactPerson: "D" })).toMatchObject({ firstName: null, lastName: null, businessName: "C" });
  });
  it("list query defaults and limits", () => {
    expect(tenantListQuerySchema.parse({})).toMatchObject({ page: 1, pageSize: 50, sort: "name", order: "asc", archived: "false" });
    expect(tenantListQuerySchema.safeParse({ pageSize: "201" }).success).toBe(false);
  });
});

describe("lease and extension schemas (§6.9, §6.10)", () => {
  const T1 = "11111111-1111-4111-8111-111111111111";
  const T2 = "22222222-2222-4222-8222-222222222222";
  const base = { startDate: "2026-01-01", endDate: "2026-12-31", baseRentCents: 250000, tenants: [{ tenantId: T1, isPrimary: true }] };
  const term = { ...base, increaseType: "none" as const, rentSteps: [] };

  it("applies defaults: no increases, due day 1, not month-to-month", () => {
    const r = leaseFieldsSchema.parse({ unitId: T2, ...base });
    expect(r).toMatchObject({ increaseType: "none", rentDueDay: 1, monthToMonth: false, rentSteps: [] });
  });
  it("rejects bad money, due day and percentages with the field message", () => {
    const msgs = (v: object) => leaseFieldsSchema.safeParse({ unitId: T2, ...base, ...v }).error?.issues.map((i) => i.message) ?? [];
    expect(msgs({ baseRentCents: 0 })).toContain("Enter an amount above 0.");
    expect(msgs({ rentDueDay: 29 })).toContain("Enter a whole number from 1 to 28.");
    expect(msgs({ increasePercent: 51 })).toContain("Enter a percentage above 0 and up to 50.");
    expect(msgs({ taxSharePercent: 100.5 })).toContain("Enter a percentage above 0 and up to 100.");
    expect(msgs({ lateFeeGraceDays: 32 })).toContain("Enter a whole number from 0 to 31.");
    expect(msgs({ endReason: "Bored" })).toContain("Choose a reason.");
    expect(msgs({ securityDepositCents: -1 })).toContain("The amount can't be negative.");
  });
  it("accepts the extension fields with notes", () => {
    expect(extensionFieldsSchema.parse({ ...base, notes: "  hi " }).notes).toBe("hi");
  });
  it("termRuleIssues: dates, percent, schedule and tenants", () => {
    expect(termRuleIssues({ ...term, endDate: "2026-01-01" }, "Residential" as const).endDate).toBeDefined();
    const ok = { ...term, childrenReside: false };
    expect(termRuleIssues(ok, "Residential")).toEqual({});
    expect(termRuleIssues({ ...ok, increaseType: "percent" }, "Residential").increasePercent).toBe("Enter the annual increase.");
    const step = (effectiveDate: string) => ({ effectiveDate, amountCents: 1 });
    const sched = (steps: string[]) => termRuleIssues({ ...ok, increaseType: "schedule", rentSteps: steps.map(step) }, "Residential").rentSteps;
    expect(sched([])).toBeDefined();
    expect(sched(["2026-01-01"])).toBeDefined();
    expect(sched(["2026-12-31"])).toBeDefined();
    expect(sched(["2026-06-01", "2026-06-01"])).toBeDefined();
    expect(sched(["2026-04-01", "2026-06-01"])).toBeUndefined();
    expect(termRuleIssues({ ...ok, tenants: [] }, "Residential").tenants).toBeDefined();
    expect(termRuleIssues({ ...ok, tenants: [{ tenantId: T1, isPrimary: false }] }, "Residential").tenants).toBe("Choose exactly one primary tenant.");
    expect(termRuleIssues({ ...ok, tenants: [{ tenantId: T1, isPrimary: true }, { tenantId: T1, isPrimary: false }] }, "Residential").tenants).toBe("Each tenant can be added once.");
  });
  it("termRuleIssues: children is Residential only, tax terms Commercial only", () => {
    expect(termRuleIssues(term, "Residential").childrenReside).toBe("Choose Yes or No.");
    expect(termRuleIssues({ ...term, childrenReside: true, baseTaxYear: 2024 }, "Residential").baseTaxYear).toBeDefined();
    expect(termRuleIssues({ ...term, childrenReside: true }, "Commercial").childrenReside).toBeDefined();
    expect(termRuleIssues({ ...term, baseTaxYear: 2024 }, "Commercial").taxSharePercent).toBeDefined();
    expect(termRuleIssues({ ...term, taxSharePercent: 10 }, "Commercial").baseTaxYear).toBeDefined();
    expect(termRuleIssues({ ...term, baseTaxYear: 2024, taxSharePercent: 10 }, "Commercial")).toEqual({});
    expect(termRuleIssues(term, "Commercial")).toEqual({});
  });
  it("leaseRuleIssues: move-out date and reason go together", () => {
    const l = { ...term, childrenReside: false };
    expect(leaseRuleIssues({ ...l, moveOutDate: "2026-05-01" }, "Residential").endReason).toBe("Choose a reason.");
    expect(leaseRuleIssues({ ...l, endReason: "Other" }, "Residential").moveOutDate).toBe("Enter the move-out date.");
    expect(leaseRuleIssues({ ...l, moveOutDate: "2026-05-01", endReason: "Other" }, "Residential")).toEqual({});
  });
});
