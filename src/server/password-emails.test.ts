import { describe, expect, it, vi } from "vitest";
import { newPasswordSchema } from "../shared/schemas";
import { passwordChangedEmail, resetEmail, sendResetEmail } from "./password-emails";

const active = { email: "Pat@Example.com", status: "active", emailVerified: true };

describe("password emails", () => {
  it("links to /reset-password with the token and states the 1-hour expiry", () => {
    const e = resetEmail("a b", "https://x.test/");
    expect(e.action).toEqual({ label: "Reset password", url: "https://x.test/reset-password?token=a%20b" });
    expect(e.paragraphs[0]).toContain("expires in 1 hour");
  });

  it("shows the change time in Eastern time and links to /forgot-password", () => {
    const e = passwordChangedEmail(new Date("2026-10-13T19:05:00Z"), "https://x.test");
    expect(e.paragraphs[0]).toContain("October 13, 2026 at 3:05 PM ET");
    expect(e.action?.url).toBe("https://x.test/forgot-password");
    expect(e.paragraphs[0]).toMatch(/reset your password now:$/);
  });

  it("sends only to active verified users, at most 3 per address per hour", async () => {
    const enqueue = vi.fn(async () => undefined);
    const mail = { enqueue, appUrl: "https://x.test" };
    expect(await sendResetEmail(mail, { ...active, status: "invited" }, "t")).toBe(false);
    expect(await sendResetEmail(mail, { ...active, status: "deactivated" }, "t")).toBe(false);
    expect(await sendResetEmail(mail, { ...active, emailVerified: false }, "t")).toBe(false);
    expect(enqueue).not.toHaveBeenCalled();
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await sendResetEmail(mail, active, "t"));
    expect(results).toEqual([true, true, true, false]);
    expect(enqueue).toHaveBeenCalledTimes(3);
  });
});

describe("newPasswordSchema", () => {
  it("enforces 12 characters and matching confirmation", () => {
    const msgs = (p: string, c: string) => {
      const r = newPasswordSchema.safeParse({ newPassword: p, confirmPassword: c });
      return r.success ? [] : r.error.issues.map((i) => i.message);
    };
    expect(msgs("short1", "short1")).toEqual(["Password must be at least 12 characters."]);
    expect(msgs("Long-enough-password-1", "Long-enough-password-2")).toEqual(["Passwords don't match."]);
    expect(msgs("Long-enough-password-1", "Long-enough-password-1")).toEqual([]);
  });
});
