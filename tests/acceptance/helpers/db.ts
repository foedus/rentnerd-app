/**
 * Direct database access, used ONLY by AC-PLAT-10 (backup/restore drill),
 * which by definition compares row counts between two databases. Runs psql
 * inside the Docker Compose `postgres` service.
 */
import { spawnSync } from 'node:child_process';
import { REPO_ROOT } from './env';

export function psql(database: string, sql: string): string {
  const r = spawnSync('docker', ['compose', 'exec', '-T', 'postgres', 'psql', '-U', 'rentnerd', '-d', database, '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  if (r.status !== 0) throw new Error(`psql failed: ${r.stderr}`);
  return r.stdout.trim();
}

export function rowCounts(database: string): Record<string, number> {
  const tables = psql(database, "select tablename from pg_tables where schemaname = 'public' order by 1").split('\n').filter(Boolean);
  const counts: Record<string, number> = {};
  for (const t of tables) counts[t] = Number(psql(database, `select count(*) from public."${t}"`));
  return counts;
}
