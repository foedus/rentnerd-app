import { appBanner } from "../shared/app-info";
import { loadConfigOrExit } from "../shared/config";
import { installClock } from "../shared/clock";
import { createDb, requireDatabaseUrl } from "../db/client";
import { loadClock, startClockSync } from "../db/test-clock";
import { startWorker } from "./boss";

const config = loadConfigOrExit("worker");
const { pool } = createDb();
let stopClockSync: (() => void) | undefined;
if (config.testRoutesEnabled) {
  installClock();
  await loadClock(pool);
  stopClockSync = startClockSync(pool);
}
const worker = await startWorker(requireDatabaseUrl());
console.log(`${appBanner("worker")} started`);

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  stopClockSync?.();
  await worker.stop();
  await pool.end();
  process.exit(0);
}
for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => void shutdown());
