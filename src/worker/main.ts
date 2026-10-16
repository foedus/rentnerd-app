import { appBanner } from "../shared/app-info";
import { loadConfigOrExit } from "../shared/config";
import { installClock } from "../shared/clock";
import { createDb, requireDatabaseUrl } from "../db/client";
import { loadClock, startClockSync } from "../db/test-clock";
import { startWorker } from "./boss";
import { startEmailConsumer } from "./email";
import { PdfRenderer } from "./pdf-renderer";

const config = loadConfigOrExit("worker");
const { pool } = createDb();
let stopClockSync: (() => void) | undefined;
if (config.testRoutesEnabled) {
  installClock();
  await loadClock(pool);
  stopClockSync = startClockSync(pool);
}
// Chromium starts on the first PDF job and is then reused (SPEC 15.1).
const pdfRenderer = new PdfRenderer();
const worker = await startWorker(requireDatabaseUrl());
await startEmailConsumer(worker.boss, pool, config.testRoutesEnabled);
console.log(`${appBanner("worker")} started`);

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  stopClockSync?.();
  await worker.stop();
  await pdfRenderer.close();
  await pool.end();
  process.exit(0);
}
for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => void shutdown());
