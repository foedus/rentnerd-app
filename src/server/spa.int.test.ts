import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createDb } from "../db/client";
import { createApp } from "./app";

const dir = mkdtempSync(path.join(tmpdir(), "spa-"));
mkdirSync(path.join(dir, "assets"));
writeFileSync(path.join(dir, "index.html"), "<!doctype html><title>RentNerd</title>");
writeFileSync(path.join(dir, "assets", "a.js"), "console.log(1)");
const { pool } = createDb("postgres://rentnerd:rentnerd@localhost:5432/rentnerd_test");
const app = createApp(pool, dir);
afterAll(() => pool.end());

describe("SPA serving", () => {
  it("serves index.html at /", async () => {
    const res = await app.request("/");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("RentNerd");
  });

  it("serves static assets", async () => {
    const res = await app.request("/assets/a.js");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("console.log(1)");
  });

  it("falls back to index.html for client routes", async () => {
    const res = await app.request("/properties/123");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("RentNerd");
  });

  it("returns 404, not the HTML shell, for a missing asset", async () => {
    const res = await app.request("/assets/missing.js");
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).not.toContain("text/html");
  });

  it("returns a JSON 404 for unknown /api paths", async () => {
    const res = await app.request("/api/nope");
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("NOT_FOUND");
  });

  it.each(["/", "/properties/1", "/api/health", "/api/nope", "/assets/a.js"])(
    "sets security headers on %s",
    async (p) => {
      const res = await app.request(p);
      expect(res.headers.get("content-security-policy")).toBe(
        "default-src 'self'; frame-ancestors 'none'",
      );
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("referrer-policy")).toBe("same-origin");
    },
  );
});
