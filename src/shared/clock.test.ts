import { afterEach, describe, expect, it } from "vitest";
import { getClockOffset, installClock, realNow, setClockNow, setClockOffset } from "./clock";

installClock();
afterEach(() => setClockNow(null));

describe("app clock", () => {
  it("follows real time when no offset is set", () => {
    expect(Math.abs(Date.now() - realNow())).toBeLessThan(50);
    expect(getClockOffset()).toBe(0);
  });

  it("moves Date.now() and new Date() to the chosen instant, still ticking", async () => {
    const target = Date.parse("2030-01-15T16:00:00.000Z");
    setClockNow(target);
    expect(Math.abs(Date.now() - target)).toBeLessThan(100);
    expect(Math.abs(new Date().getTime() - target)).toBeLessThan(100);
    const a = Date.now();
    await new Promise((r) => setTimeout(r, 20));
    expect(Date.now()).toBeGreaterThan(a);
  });

  it("leaves explicit dates, parsing and instanceof alone", () => {
    setClockNow(Date.parse("2030-01-15T16:00:00.000Z"));
    expect(new Date("2024-02-29T00:00:00Z").toISOString()).toBe("2024-02-29T00:00:00.000Z");
    expect(new Date(2020, 0, 1).getFullYear()).toBe(2020);
    expect(new Date(0).getTime()).toBe(0);
    expect(new Date() instanceof Date).toBe(true);
    expect(Date.UTC(2020, 0, 1)).toBe(1577836800000);
  });

  it("keeps realNow() on real time while the app clock is moved", () => {
    const before = realNow();
    setClockNow(Date.parse("2040-01-01T00:00:00.000Z"));
    expect(Math.abs(realNow() - before)).toBeLessThan(100);
  });

  it("clears back to real time", () => {
    setClockOffset(86_400_000);
    setClockNow(null);
    expect(getClockOffset()).toBe(0);
  });
});
