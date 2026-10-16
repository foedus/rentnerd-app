import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { installClock, setClockOffset } from "../shared/clock";
import { RateLimiter, clientIp, rateLimit, signInRateLimit } from "./rate-limit";

describe("RateLimiter", () => {
  it("allows the limit, then refuses until the window passes", () => {
    const l = new RateLimiter(3, 1000);
    expect([l.take("a", 0), l.take("a", 1), l.take("a", 2)]).toEqual([true, true, true]);
    expect(l.take("a", 3)).toBe(false);
    expect(l.take("b", 3)).toBe(true);
    expect(l.take("a", 1001)).toBe(true);
  });

  it("counts attempts in real time when the app clock jumps", () => {
    installClock();
    const l = new RateLimiter(3, 15 * 60_000);
    try {
      setClockOffset(-365 * 24 * 3600_000);
      expect([l.take("a"), l.take("a"), l.take("a")]).toEqual([true, true, true]);
      setClockOffset(365 * 24 * 3600_000);
      expect(l.take("a")).toBe(false);
    } finally {
      setClockOffset(0);
    }
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

describe("signInRateLimit", () => {
  const build = (perIpLimit = 30) => {
    const app = new Hono();
    app.use("/in", signInRateLimit(new RateLimiter(5, 60_000), new RateLimiter(perIpLimit, 60_000)));
    app.post("/in", async (c) => {
      const { password } = await c.req.json();
      return password === "right" ? c.json({ ok: true }) : c.json({ error: "bad" }, 401);
    });
    const post = (email: string, password: string, ip = "10.0.0.1") =>
      app.request("/in", { method: "POST", body: JSON.stringify({ email, password }), headers: { "content-type": "application/json" } }, {
        incoming: { socket: { remoteAddress: ip } },
      });
    return post;
  };

  it("refuses the 6th attempt for an email, even with the right password, whatever the IP", async () => {
    const post = build();
    for (let i = 0; i < 5; i++) expect((await post("a@x.com", "wrong", `10.0.0.${i}`)).status).toBe(401);
    const res = await post("A@X.com ", "right", "10.0.0.99");
    expect(res.status).toBe(429);
    expect((await res.json()).error).toMatchObject({ code: "RATE_LIMITED", message: "Too many attempts. Try again in a few minutes." });
    expect((await post("b@x.com", "right")).status).toBe(200);
  });

  it("applies to unknown emails the same way", async () => {
    const post = build();
    for (let i = 0; i < 5; i++) await post("ghost@x.com", "wrong");
    expect((await post("ghost@x.com", "wrong")).status).toBe(429);
  });

  it("does not count successful sign-ins", async () => {
    const post = build();
    for (let i = 0; i < 10; i++) expect((await post("a@x.com", "right")).status).toBe(200);
  });

  it("limits failures per IP across emails", async () => {
    const post = build(3);
    for (let i = 0; i < 3; i++) expect((await post(`u${i}@x.com`, "wrong")).status).toBe(401);
    expect((await post("u9@x.com", "wrong")).status).toBe(429);
    expect((await post("u9@x.com", "wrong", "10.0.0.2")).status).toBe(401);
  });

  it("does not use up the email's allowance when the IP limit refuses", async () => {
    const post = build(1);
    await post("a@x.com", "wrong");
    for (let i = 0; i < 4; i++) expect((await post("a@x.com", "wrong")).status).toBe(429);
    expect((await post("a@x.com", "wrong", "10.0.0.2")).status).toBe(401);
  });
});
