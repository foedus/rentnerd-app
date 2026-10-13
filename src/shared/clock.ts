/**
 * Process-wide app clock (D-25). `installClock()` replaces the global `Date` so that every
 * `new Date()` and `Date.now()` (Better Auth, pg-boss, business logic) sees real time plus an
 * offset. Without an offset it behaves exactly like real time. `realNow()` always returns real
 * time (S3 request signing must not use the test clock).
 */
const RealDate = Date;
let offsetMs = 0;
let installed = false;

export const realNow = (): number => RealDate.now();

export function getClockOffset(): number {
  return offsetMs;
}

export function setClockOffset(ms: number): void {
  offsetMs = ms;
}

/** Sets the app clock so that "now" is the given instant (ms since epoch), or real time for null. */
export function setClockNow(target: number | null): void {
  offsetMs = target === null ? 0 : target - realNow();
}

export function installClock(): void {
  if (installed) return;
  installed = true;
  class AppDate extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(RealDate.now() + offsetMs);
      else super(...(args as [string]));
    }
    static override now(): number {
      return RealDate.now() + offsetMs;
    }
  }
  globalThis.Date = AppDate as unknown as DateConstructor;
}
