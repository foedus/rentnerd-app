import { Hono, type Context } from "hono";
import { isDatabaseReachable } from "../db/client";
import type { Auth } from "./auth";
import { securityHeaders } from "./security-headers";
import { mountSpa } from "./spa";

type Pinger = Parameters<typeof isDatabaseReachable>[0];

export function createApp(pool: Pinger, clientDir = "dist/client", auth?: Auth) {
  const app = new Hono();
  app.use("*", securityHeaders);
  const health = async (c: Context) =>
    (await isDatabaseReachable(pool))
      ? c.json({ status: "ok" })
      : c.json({ status: "unavailable" }, 503);
  app.get("/api/health", health);
  app.get("/healthz", health);
  if (auth) app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));
  mountSpa(app, clientDir);
  return app;
}
