import { serve } from "@hono/node-server";
import { loadConfigOrExit } from "../shared/config";
import { createDb } from "../db/client";
import { appBanner } from "../shared/app-info";
import { installClock } from "../shared/clock";
import { loadClock, startClockSync } from "../db/test-clock";
import { createApp } from "./app";
import { createAuth } from "./auth";
import { seedSmokeUser } from "./seed";

const config = loadConfigOrExit("web");
const port = Number(process.env.PORT ?? 8080);
const { pool, db } = createDb();
if (config.testRoutesEnabled) {
  installClock();
  await loadClock(pool);
  startClockSync(pool);
}
const auth = createAuth(db);
await seedSmokeUser(auth, db);
serve({ fetch: createApp(pool, undefined, auth, config).fetch, port }, () =>
  console.log(`${appBanner("web")} listening on ${port}`),
);
