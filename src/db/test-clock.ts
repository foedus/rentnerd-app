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

/** Sets (ISO string) or clears (null) the app clock in this process and in the database. */
export async function applyClock(pool: Queryable, now: string | null): Promise<void> {
  setClockNow(now === null ? null : Date.parse(now));
  await writeClockOffset(pool, getClockOffset());
}

/** Loads the stored offset into this process's clock. */
export async function loadClock(pool: Queryable): Promise<void> {
  setClockOffset(await readClockOffset(pool));
}

/** Keeps this process's clock in step with the database (worker; the CLI loads once). */
export function startClockSync(pool: Queryable, intervalMs = 250): () => void {
  const timer = setInterval(() => void loadClock(pool).catch(() => undefined), intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
