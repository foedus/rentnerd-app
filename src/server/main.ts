import { serve } from "@hono/node-server";
import { createDb } from "../db/client";
import { appBanner } from "../shared/app-info";
import { createApp } from "./app";

const port = Number(process.env.PORT ?? 8080);
const { pool } = createDb();
serve({ fetch: createApp(pool).fetch, port }, () =>
  console.log(`${appBanner("web")} listening on ${port}`),
);
