import type pg from "pg";
import { setClockOffset } from "../shared/clock";
import { changeClock } from "./test-clock";

type Queryable = Pick<pg.Pool, "query">;

/**
 * Test-only (D-25): empties every application table (all of `public`, so new tables are covered)
 * and every queued pg-boss job. Schemas, queues and schedules stay; startup seeding refills the rest.
 */
export async function resetAppData(pool: Queryable): Promise<void> {
  await changeClock(() => emptyAppData(pool));
}

async function emptyAppData(pool: Queryable): Promise<void> {
  const { rows } = await pool.query<{ name: string }>(
    "select format('%I.%I', schemaname, tablename) as name from pg_tables where schemaname = 'public'",
  );
  const tables = rows.map((r) => r.name);
  if (tables.length > 0) await pool.query(`truncate table ${tables.join(", ")} restart identity cascade`);
  const boss = await pool.query("select to_regclass('pgboss.job') as job");
  if (boss.rows[0]?.job) await pool.query("truncate table pgboss.job cascade");
  setClockOffset(0);
}
