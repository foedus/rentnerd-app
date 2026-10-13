import { PgBoss } from "pg-boss";

/** Queues the worker owns (SPEC §15.1). */
export const QUEUES = ["email.send", "pdf.render", "preview.render"] as const;

const STOP_TIMEOUT_MS = 20_000;

export interface Worker {
  boss: PgBoss;
  /** Finishes running jobs, then closes the pg-boss connections. Safe to call twice. */
  stop: () => Promise<void>;
}

/** Starts pg-boss (its tables live in the `pgboss` schema) and registers every queue. */
export async function startWorker(connectionString: string): Promise<Worker> {
  const boss = new PgBoss({ connectionString, schema: "pgboss" });
  boss.on("error", (error) => console.error("[worker] pg-boss error", error));
  await boss.start();
  for (const name of QUEUES) await boss.createQueue(name);
  let stopping: Promise<void> | undefined;
  const stop = () => (stopping ??= boss.stop({ graceful: true, timeout: STOP_TIMEOUT_MS }));
  return { boss, stop };
}
