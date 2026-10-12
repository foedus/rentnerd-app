import { Hono, type Context } from "hono";
import { isDatabaseReachable } from "../db/client";

type Pinger = Parameters<typeof isDatabaseReachable>[0];

export function createApp(pool: Pinger) {
  const app = new Hono();
  const health = async (c: Context) =>
    (await isDatabaseReachable(pool))
      ? c.json({ status: "ok" })
      : c.json({ status: "unavailable" }, 503);
  app.get("/api/health", health);
  app.get("/healthz", health);
  return app;
}
