import { describe, expect, it } from "vitest";
import { isDatabaseReachable, requireDatabaseUrl } from "./client";

describe("requireDatabaseUrl", () => {
  it("returns DATABASE_URL", () => {
    expect(requireDatabaseUrl({ DATABASE_URL: "postgres://x" })).toBe("postgres://x");
  });
  it("throws when missing", () => {
    expect(() => requireDatabaseUrl({})).toThrow("DATABASE_URL");
  });
});

describe("isDatabaseReachable", () => {
  it("is true when the query succeeds", async () => {
    expect(await isDatabaseReachable({ query: async () => ({}) as never })).toBe(true);
  });
  it("is false when the query fails", async () => {
    expect(await isDatabaseReachable({ query: async () => { throw new Error("down"); } })).toBe(false);
  });
});
