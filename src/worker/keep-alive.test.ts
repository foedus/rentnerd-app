import { describe, expect, it, vi } from "vitest";
import { keepAlive } from "./keep-alive";

describe("keepAlive", () => {
  it("holds a timer until stopped", () => {
    vi.useFakeTimers();
    const stop = keepAlive();
    expect(vi.getTimerCount()).toBe(1);
    stop();
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });
});
