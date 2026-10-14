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
