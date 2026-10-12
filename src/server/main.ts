import { serve } from "@hono/node-server";
import { createDb } from "../db/client";
import { appBanner } from "../shared/app-info";
import { createApp } from "./app";
import { createAuth } from "./auth";
import { seedSmokeUser } from "./seed";

const port = Number(process.env.PORT ?? 8080);
const { pool, db } = createDb();
const auth = createAuth(db);
await seedSmokeUser(auth, db);
serve({ fetch: createApp(pool, undefined, auth).fetch, port }, () =>
  console.log(`${appBanner("web")} listening on ${port}`),
);
