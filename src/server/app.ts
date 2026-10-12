import { Hono, type Context } from "hono";
import { isDatabaseReachable } from "../db/client";
import { securityHeaders } from "./security-headers";
import { mountSpa } from "./spa";

type Pinger = Parameters<typeof isDatabaseReachable>[0];

export function createApp(pool: Pinger, clientDir = "dist/client") {
  const app = new Hono();
  app.use("*", securityHeaders);
  const health = async (c: Context) =>
    (await isDatabaseReachable(pool))
      ? c.json({ status: "ok" })
      : c.json({ status: "unavailable" }, 503);
  app.get("/api/health", health);
  app.get("/healthz", health);
  mountSpa(app, clientDir);
  return app;
}
