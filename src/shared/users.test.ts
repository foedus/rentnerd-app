import { expect, it } from "vitest";
import { roleLabel, rowActions, userStatusLabel } from "./users";

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

it("chooses row actions by role, status and invitation state (SPEC §11.23)", () => {
  const inv = (state: "valid" | "expired" | "revoked") => ({ id: "i", state });
  expect(rowActions({ role: "admin", status: "active", invitation: null })).toEqual([]);
  expect(rowActions({ role: "smoke", status: "active", invitation: null })).toEqual([]);
  expect(rowActions({ role: "landlord", status: "active", invitation: null })).toEqual(["deactivate"]);
  expect(rowActions({ role: "landlord", status: "deactivated", invitation: null })).toEqual(["reactivate"]);
  expect(rowActions({ role: "landlord", status: "invited", invitation: inv("valid") })).toEqual(["resend", "revoke"]);
  expect(rowActions({ role: "landlord", status: "invited", invitation: inv("expired") })).toEqual(["resend"]);
  expect(rowActions({ role: "landlord", status: "invited", invitation: inv("revoked") })).toEqual(["resend"]);
});
