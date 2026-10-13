import { describe, expect, it } from "vitest";
import { ConfigError, databaseName, loadConfig } from "./config";

const safe = {
  ENABLE_TEST_ROUTES: "true",
  NODE_ENV: "test",
  DATABASE_URL: "postgres://u:p@localhost:5432/rentnerd_test",
};

describe("databaseName", () => {
  it("reads the name, ignoring query strings", () => {
    expect(databaseName("postgres://u:p@h:5432/rentnerd_test?sslmode=disable")).toBe("rentnerd_test");
  });
  it("returns empty for missing or invalid urls", () => {
    expect(databaseName(undefined)).toBe("");
    expect(databaseName("nonsense")).toBe("");
  });
});

describe("loadConfig", () => {
  it("disables test routes unless ENABLE_TEST_ROUTES is exactly true", () => {
    expect(loadConfig({ NODE_ENV: "production" })).toEqual({ testRoutesEnabled: false });
    expect(loadConfig({ ENABLE_TEST_ROUTES: "false", NODE_ENV: "production" }).testRoutesEnabled).toBe(false);
  });
  it("enables them in a safe test environment", () => {
    expect(loadConfig(safe).testRoutesEnabled).toBe(true);
  });
  it.each([
    ["NODE_ENV", { NODE_ENV: "production" }],
    ["FLY_APP_NAME", { FLY_APP_NAME: "rentnerd-app" }],
    ["database name", { DATABASE_URL: "postgres://u:p@localhost:5432/rentnerd" }],
    ["missing database", { DATABASE_URL: undefined }],
  ])("refuses when %s is unsafe", (_label, override) => {
    expect(() => loadConfig({ ...safe, ...override })).toThrow(ConfigError);
    expect(() => loadConfig({ ...safe, ...override })).toThrow(/ENABLE_TEST_ROUTES/);
  });
});

describe("loadConfig ADMIN_EMAIL in production", () => {
  it("makes the web process refuse to start without ADMIN_EMAIL", () => {
    expect(() => loadConfig({ NODE_ENV: "production" }, "web")).toThrow(/ADMIN_EMAIL/);
    expect(() => loadConfig({ NODE_ENV: "production", ADMIN_EMAIL: "  " }, "web")).toThrow(ConfigError);
  });
  it("accepts it when set, and does not require it elsewhere", () => {
    expect(() => loadConfig({ NODE_ENV: "production", ADMIN_EMAIL: "a@b.c" }, "web")).not.toThrow();
    expect(() => loadConfig({ NODE_ENV: "production" }, "worker")).not.toThrow();
    expect(() => loadConfig({ NODE_ENV: "test" }, "web")).not.toThrow();
  });
});
