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
