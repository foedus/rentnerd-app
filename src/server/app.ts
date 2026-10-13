import { Hono, type Context } from "hono";
import { isDatabaseReachable } from "../db/client";
import type { Auth } from "./auth";
import type { AppConfig } from "../shared/config";
import { mountErrorHandlers, originCheck, sessionGuard } from "./api-guard";
import { securityHeaders } from "./security-headers";
import { mountSpa } from "./spa";
import { mountTestRoutes } from "./test-routes";

type Pinger = Parameters<typeof isDatabaseReachable>[0];

export function createApp(
  pool: Pinger,
  clientDir = "dist/client",
  auth?: Auth,
  config: AppConfig = { testRoutesEnabled: false },
  appUrl: string | undefined = process.env.APP_URL,
) {
  const app = new Hono();
  app.use("*", securityHeaders);
  mountErrorHandlers(app);
  app.use("/api/*", originCheck(appUrl));
  if (auth) app.use("/api/*", sessionGuard(auth));
  const health = async (c: Context) =>
    (await isDatabaseReachable(pool))
      ? c.json({ status: "ok" })
      : c.json({ status: "unavailable" }, 503);
  app.get("/api/health", health);
  app.get("/healthz", health);
  if (auth) app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));
  // Test-only routes (D-25); when disabled /api/test/* does not exist. Registered before the SPA fallback.
  if (config.testRoutesEnabled) mountTestRoutes(app, pool);
  else app.all("/api/test/*", (c) => c.json({ error: { code: "NOT_FOUND", message: "Not found" } }, 404));
  mountSpa(app, clientDir);
  return app;
}
