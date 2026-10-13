import { appBanner } from "../shared/app-info";
import { loadConfigOrExit } from "../shared/config";
import { installClock } from "../shared/clock";
import { createDb } from "../db/client";
import { loadClock, startClockSync } from "../db/test-clock";
import { keepAlive } from "./keep-alive";

const config = loadConfigOrExit("worker");
if (config.testRoutesEnabled) {
  installClock();
  const { pool } = createDb();
  await loadClock(pool);
  startClockSync(pool);
}
console.log(`${appBanner("worker")} started (stub)`);
const stop = keepAlive();
for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, stop);
