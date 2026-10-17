import type pg from "pg";
import { getClockOffset, setClockNow, setClockOffset } from "../shared/clock";

type Queryable = Pick<pg.Pool, "query">;

/** Persists the offset (ms) in the single TestClock row. */
export async function writeClockOffset(pool: Queryable, offsetMs: number): Promise<void> {
  await pool.query(
    "insert into test_clock (id, offset_ms) values (1, $1) on conflict (id) do update set offset_ms = excluded.offset_ms",
    [offsetMs],
  );
}

export async function readClockOffset(pool: Queryable): Promise<number> {
  const { rows } = await pool.query<{ offset_ms: string }>("select offset_ms from test_clock where id = 1");
  return rows[0] ? Number(rows[0].offset_ms) : 0;
}

/*
 * A load that was in flight while this process changed the clock may have read the old offset
 * (the change was not committed yet). Applying it afterwards would put the clock back until the
 * next sync, and a session opened in that window expires as soon as the clock catches up.
 * Local changes therefore bump `changeSeq` when they start and end, and such loads are dropped.
 */
let changeSeq = 0;
let changing = 0;

/** Runs a change of this process's clock (and the stored offset) that in-flight loads must not undo. */
export async function changeClock<T>(change: () => Promise<T>): Promise<T> {
  changeSeq++;
  changing++;
  try {
    return await change();
  } finally {
    changing--;
    changeSeq++;
  }
}

/** Sets (ISO string) or clears (null) the app clock in this process and in the database. */
export async function applyClock(pool: Queryable, now: string | null): Promise<void> {
  await changeClock(async () => {
    setClockNow(now === null ? null : Date.parse(now));
    await writeClockOffset(pool, getClockOffset());
  });
}

/** Loads the stored offset into this process's clock, unless a local change overlapped the read. */
export async function loadClock(pool: Queryable): Promise<void> {
  const seq = changeSeq;
  const offset = await readClockOffset(pool);
  if (changing === 0 && seq === changeSeq) setClockOffset(offset);
}

/** Keeps this process's clock in step with the database (worker; the CLI loads once). */
export function startClockSync(pool: Queryable, intervalMs = 250): () => void {
  const timer = setInterval(() => void loadClock(pool).catch(() => undefined), intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
