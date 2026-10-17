import { afterEach, describe, expect, it } from "vitest";
import { getClockOffset, setClockNow, setClockOffset } from "../shared/clock";
import { applyClock, changeClock, loadClock } from "./test-clock";

/** A fake pool whose queries stay pending until released, to replay exact interleavings. */
function fakePool() {
  let stored = 0;
  const pending: Array<() => void> = [];
  const pool = {
    query: (sql: string, params?: unknown[]) =>
      new Promise((resolve) => {
        if (sql.startsWith("select")) {
          const seen = stored; // the snapshot is taken when the query runs, not when it answers
          pending.push(() => resolve({ rows: [{ offset_ms: String(seen) }] }));
        } else {
          pending.push(() => {
            stored = Number(params?.[0]);
            resolve({ rows: [] });
          });
        }
      }),
  };
  const flush = async () => {
    while (pending.length) {
      pending.shift()?.();
      await new Promise((r) => setImmediate(r));
    }
  };
  return { pool: pool as never, release: () => pending.shift()?.(), flush, stored: () => stored };
}
const tick = () => new Promise((r) => setImmediate(r));
const YEAR = 365 * 24 * 3600 * 1000;

afterEach(() => setClockNow(null));

describe("test clock sync", () => {
  it("a load that read the old offset before a local change cannot put the clock back", async () => {
    const db = fakePool();
    const load = loadClock(db.pool); // sync poll reads offset 0 ...
    const apply = applyClock(db.pool, new Date(Date.now() + YEAR).toISOString());
    await tick();
    expect(getClockOffset()).toBeGreaterThan(YEAR - 5000);
    db.release(); // ... and answers after the clock moved
    await load;
    expect(getClockOffset()).toBeGreaterThan(YEAR - 5000);
    await db.flush();
    await apply;
    expect(db.stored()).toBe(getClockOffset());
  });

  it("a load started while a change is being written is dropped too", async () => {
    const db = fakePool();
    const apply = applyClock(db.pool, new Date(Date.now() + YEAR).toISOString());
    const load = loadClock(db.pool); // reads before the write is committed
    await db.flush();
    await Promise.all([apply, load]);
    expect(getClockOffset()).toBeGreaterThan(YEAR - 5000);
  });

  it("a reset's clock change is protected the same way", async () => {
    const db = fakePool();
    const apply = applyClock(db.pool, new Date(Date.now() + YEAR).toISOString());
    await db.flush();
    await apply;
    const load = loadClock(db.pool); // reads the year-ahead offset ...
    await changeClock(async () => setClockOffset(0)); // ... while a reset clears the clock
    db.release();
    await load;
    expect(getClockOffset()).toBe(0);
  });

  it("a load with no local change in between applies the stored offset", async () => {
    const db = fakePool();
    const apply = applyClock(db.pool, new Date(Date.now() + YEAR).toISOString());
    await db.flush();
    await apply;
    setClockOffset(0);
    const load = loadClock(db.pool);
    await db.flush();
    await load;
    expect(getClockOffset()).toBe(db.stored());
  });
});
