import { Hono, type Context } from "hono";
import { isDatabaseReachable, type Db } from "../db/client";
import type { Auth } from "./auth";
import type { AppConfig } from "../shared/config";
import { mountErrorHandlers, originCheck, sessionGuard } from "./api-guard";
import { requestContext } from "./request-context";
import { securityHeaders } from "./security-headers";
import { mountInvitationRoutes } from "./invitation-routes";
import { mountOwnerRoutes } from "./owner-routes";
import { mountTenantRoutes } from "./tenant-routes";
import { mountPropertyRoutes } from "./property-routes";
import { mountPropertyTaxRoutes } from "./property-tax-routes";
import { mountPropertyValueRoutes } from "./property-value-routes";
import { mountUnitRoutes } from "./unit-routes";
import { mountMeRoutes } from "./me-routes";
import { mountUserRoutes } from "./user-routes";
import type { EnqueueEmail } from "../worker/email";
import { RateLimiter, rateLimit, signInRateLimit } from "./rate-limit";
import { mountSpa } from "./spa";
import { mountTestRoutes } from "./test-routes";

type Pinger = Parameters<typeof isDatabaseReachable>[0];

export function createApp(
  pool: Pinger,
  clientDir = "dist/client",
  auth?: Auth,
  config: AppConfig = { testRoutesEnabled: false },
  appUrl: string | undefined = process.env.APP_URL,
  db?: Db,
  enqueueEmail?: (email: EnqueueEmail) => Promise<unknown>,
) {
  const app = new Hono();
  app.use("*", securityHeaders);
  mountErrorHandlers(app);
  app.use("/api/*", requestContext);
  app.use("/api/*", originCheck(appUrl));
  if (auth) app.use("/api/*", sessionGuard(auth));
  const health = async (c: Context) =>
    (await isDatabaseReachable(pool))
      ? c.json({ status: "ok" })
      : c.json({ status: "unavailable" }, 503);
  app.get("/api/health", health);
  app.get("/healthz", health);
  if (auth) app.use("/api/auth/sign-in/email", signInRateLimit());
  if (auth) {
    // §16: forgot-password 20 per IP per hour; reset-password 20 per IP per 15 minutes.
    const forgot = new RateLimiter(20, 60 * 60_000);
    const reset = new RateLimiter(20, 15 * 60_000);
    for (const path of ["/api/auth/request-password-reset", "/api/auth/forget-password"]) app.post(path, rateLimit(forgot));
    app.post("/api/auth/reset-password", rateLimit(reset));
  }
  if (auth) app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));
  if (auth && db) {
    mountInvitationRoutes(app, db, auth);
    mountMeRoutes(app, db);
    mountOwnerRoutes(app, db);
    mountTenantRoutes(app, db);
    mountPropertyRoutes(app, db);
    mountUnitRoutes(app, db);
    mountPropertyValueRoutes(app, db);
    mountPropertyTaxRoutes(app, db);
    if (enqueueEmail) mountUserRoutes(app, db, enqueueEmail, appUrl ?? "");
  }
  // Test-only routes (D-25); when disabled /api/test/* does not exist. Registered before the SPA fallback.
  if (config.testRoutesEnabled) mountTestRoutes(app, pool);
  else app.all("/api/test/*", (c) => c.json({ error: { code: "NOT_FOUND", message: "Not found" } }, 404));
  mountSpa(app, clientDir);
  return app;
}
