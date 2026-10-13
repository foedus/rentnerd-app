import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { RateLimiter, clientIp, rateLimit } from "./rate-limit";

describe("RateLimiter", () => {
  it("allows the limit, then refuses until the window passes", () => {
    const l = new RateLimiter(3, 1000);
    expect([l.take("a", 0), l.take("a", 1), l.take("a", 2)]).toEqual([true, true, true]);
    expect(l.take("a", 3)).toBe(false);
    expect(l.take("b", 3)).toBe(true);
    expect(l.take("a", 1001)).toBe(true);
  });
});

describe("clientIp", () => {
  const ipOf = async (env: NodeJS.ProcessEnv, headers: Record<string, string>) => {
    const app = new Hono();
    app.get("/", (c) => c.text(clientIp(c, env)));
    const res = await app.request("/", { headers }, { incoming: { socket: { remoteAddress: "10.0.0.9" } } });
    return res.text();
  };
  it("trusts Fly-Client-IP only in production and ignores X-Forwarded-For", async () => {
    const headers = { "fly-client-ip": "1.2.3.4", "x-forwarded-for": "6.6.6.6" };
    expect(await ipOf({ NODE_ENV: "production" }, headers)).toBe("1.2.3.4");
    expect(await ipOf({}, headers)).toBe("10.0.0.9");
  });
});

describe("rateLimit middleware", () => {
  it("answers 429 RATE_LIMITED in the error envelope", async () => {
    const app = new Hono();
    app.use("*", rateLimit(new RateLimiter(1, 60_000)));
    app.get("/", (c) => c.text("ok"));
    expect((await app.request("/")).status).toBe(200);
    const res = await app.request("/");
    expect(res.status).toBe(429);
    expect((await res.json()).error).toMatchObject({ code: "RATE_LIMITED", message: "Too many attempts. Try again in a few minutes." });
  });
});
