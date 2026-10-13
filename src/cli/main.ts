import { appBanner } from "../shared/app-info";
import { loadConfigOrExit } from "../shared/config";
import { installClock } from "../shared/clock";
import { createDb } from "../db/client";
import { loadClock } from "../db/test-clock";

const config = loadConfigOrExit("cli");
if (config.testRoutesEnabled) {
  installClock();
  const { pool } = createDb();
  await loadClock(pool);
  await pool.end();
}
console.log(`${appBanner("cli")}: no commands yet`);
