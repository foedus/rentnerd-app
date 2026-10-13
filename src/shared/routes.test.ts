import { describe, expect, it } from "vitest";
import { canAccess, documentTitle, navPagesFor, pages } from "./routes";

describe("navigation", () => {
  it("lists the nine shared entries in order for landlords", () => {
    expect(navPagesFor("landlord").map((p) => p.title)).toEqual([
      "Dashboard", "Properties", "Tenants", "Owners", "Leases", "Compliance", "Investments", "Templates", "Import",
    ]);
  });
  it("adds Users and Activity log for the Admin only", () => {
    expect(navPagesFor("admin").slice(-2).map((p) => p.title)).toEqual(["Users", "Activity log"]);
    expect(navPagesFor("smoke").some((p) => p.access === "admin")).toBe(false);
  });
  it("has unique titles and paths", () => {
    expect(new Set(pages.map((p) => p.title)).size).toBe(pages.length);
    expect(new Set(pages.map((p) => p.path)).size).toBe(pages.length);
  });
});

describe("canAccess", () => {
  it("applies the three access levels", () => {
    expect(canAccess("any", "smoke")).toBe(true);
    expect(canAccess("admin", "landlord")).toBe(false);
    expect(canAccess("admin", "admin")).toBe(true);
    expect(canAccess("write", "smoke")).toBe(false);
    expect(canAccess("write", "landlord")).toBe(true);
  });
});

it("formats titles", () => expect(documentTitle("Users")).toBe("Users – RentNerd"));
