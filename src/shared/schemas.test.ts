import { describe, expect, it } from "vitest";
import { acceptInvitationSchema, createOwnerSchema, ownerListQuerySchema, updateMeSchema, updateOwnerSchema, versionSchema } from "./schemas";

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
