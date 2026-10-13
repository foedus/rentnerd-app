import { serve } from "@hono/node-server";
import { loadConfigOrExit } from "../shared/config";
import { createDb } from "../db/client";
import { appBanner } from "../shared/app-info";
import { installClock } from "../shared/clock";
import { loadClock, startClockSync } from "../db/test-clock";
import { createApp } from "./app";
import { createAuth } from "./auth";
import { seedSmokeUser } from "./seed";
import { bootstrapAdmin } from "./bootstrap";
import { PgBoss } from "pg-boss";
import { EMAIL_QUEUE, enqueueEmail } from "../worker/email";
import { requireDatabaseUrl } from "../db/client";

const config = loadConfigOrExit("web");
const port = Number(process.env.PORT ?? 8080);
const { pool, db } = createDb();
if (config.testRoutesEnabled) {
  installClock();
  await loadClock(pool);
  startClockSync(pool);
}
// The web process only produces jobs (the worker owns the queues' consumers and maintenance).
const boss = new PgBoss({ connectionString: requireDatabaseUrl(), schema: "pgboss", supervise: false, schedule: false });
boss.on("error", (error) => console.error("[web] pg-boss error", error));
await boss.start();
await boss.createQueue(EMAIL_QUEUE);
const enqueue = (email: Parameters<typeof enqueueEmail>[2]) => enqueueEmail(pool, boss, email);
const auth = createAuth(db, process.env, { enqueue, appUrl: process.env.APP_URL ?? "" });
await seedSmokeUser(auth, db);
await bootstrapAdmin(db, pool, boss);
serve({ fetch: createApp(pool, undefined, auth, config, undefined, db, enqueue).fetch, port }, () =>
  console.log(`${appBanner("web")} listening on ${port}`),
);
