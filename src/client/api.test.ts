import { afterEach, expect, it, vi } from "vitest";
import { InvalidResetLinkError, TooManyRequestsError, resetPassword } from "./api";

afterEach(() => vi.unstubAllGlobals());

const respond = (status: number) => vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status })));

it("resetPassword resolves on success", async () => {
  respond(200);
  await expect(resetPassword("t", "a-long-password")).resolves.toBeUndefined();
});

it.each([400, 404])("resetPassword treats %i as an invalid or expired link", async (status) => {
  respond(status);
  await expect(resetPassword("t", "a-long-password")).rejects.toBeInstanceOf(InvalidResetLinkError);
});

it("resetPassword treats 429 as too many attempts", async () => {
  respond(429);
  await expect(resetPassword("t", "a-long-password")).rejects.toBeInstanceOf(TooManyRequestsError);
});

it.each([403, 500])("resetPassword shows the generic error for %i", async (status) => {
  respond(status);
  const err = await resetPassword("t", "a-long-password").catch((e: unknown) => e);
  expect(err).toBeInstanceOf(Error);
  expect(err).not.toBeInstanceOf(InvalidResetLinkError);
  expect((err as Error).message).toBe("Something went wrong. Please try again.");
});
