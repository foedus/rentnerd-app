import { describe, expect, it } from "vitest";
import { findPlaceholder, PLACEHOLDERS, placeholdersFor } from "./placeholders";

describe("placeholder registry", () => {
  it("has the 40 keys of §8.1 with unique keys and labels", () => {
    expect(PLACEHOLDERS).toHaveLength(40);
    expect(new Set(PLACEHOLDERS.map((p) => p.key)).size).toBe(40);
    expect(new Set(PLACEHOLDERS.map((p) => p.label)).size).toBe(40);
  });
  it("offers extension-only keys only for extension templates", () => {
    expect(placeholdersFor("master_lease").some((p) => p.key === "extension_start_date")).toBe(false);
    expect(placeholdersFor("extension").some((p) => p.label === "Extension start date")).toBe(true);
    expect(placeholdersFor("master_lease")).toHaveLength(31);
    expect(placeholdersFor("extension")).toHaveLength(40);
  });
  it("finds a key and knows it is extension-only", () => {
    expect(findPlaceholder("tenant_names")).toMatchObject({ label: "Tenant names", extensionOnly: false });
    expect(findPlaceholder("removed_tenant_names")?.extensionOnly).toBe(true);
    expect(findPlaceholder("nope")).toBeUndefined();
  });
});
