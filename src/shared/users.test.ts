import { expect, it } from "vitest";
import { roleLabel, userStatusLabel } from "./users";

it("labels roles as in SPEC §11.23", () => {
  expect([roleLabel("admin"), roleLabel("landlord"), roleLabel("smoke")]).toEqual(["Admin", "Landlord", "Smoke test (read-only)"]);
});

it("derives the status label from the user status and the newest invitation", () => {
  const inv = (state: "valid" | "expired" | "revoked" | "accepted") => ({ id: "i", state });
  expect(userStatusLabel({ status: "active", invitation: null })).toBe("Active");
  expect(userStatusLabel({ status: "deactivated", invitation: null })).toBe("Deactivated");
  expect(userStatusLabel({ status: "invited", invitation: inv("valid") })).toBe("Invited");
  expect(userStatusLabel({ status: "invited", invitation: null })).toBe("Invited");
  expect(userStatusLabel({ status: "invited", invitation: inv("expired") })).toBe("Invitation expired");
  expect(userStatusLabel({ status: "invited", invitation: inv("revoked") })).toBe("Invitation revoked");
});
