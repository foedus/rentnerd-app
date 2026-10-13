import { describe, expect, it } from "vitest";
import { acceptInvitationSchema, updateMeSchema } from "./schemas";

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
