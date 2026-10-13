import type { Context, Hono, MiddlewareHandler } from "hono";
import type { Auth } from "./auth";

export type ErrorCode = "BAD_REQUEST" | "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_ERROR" | "RATE_LIMITED" | "INTERNAL";

const STATUS = { BAD_REQUEST: 400, UNAUTHENTICATED: 401, FORBIDDEN: 403, NOT_FOUND: 404, VALIDATION_ERROR: 422, RATE_LIMITED: 429, INTERNAL: 500 } as const;

/** The §14.1 error envelope. `fields` is only for validation errors. */
export function errorBody(code: ErrorCode, message: string, fields?: Record<string, string>) {
  return { error: { code, message, ...(fields ? { fields } : {}) } };
}

export function apiError(c: Context, code: ErrorCode, message: string, fields?: Record<string, string>) {
  return c.json(errorBody(code, message, fields), STATUS[code]);
}

const WRITE_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);
const PUBLIC_PATHS = new Set(["/api/health", "/api/invitations/lookup", "/api/invitations/accept"]);

const isApi = (path: string) => path === "/api" || path.startsWith("/api/");
const isTest = (path: string) => path.startsWith("/api/test/");
const isAuthPath = (path: string) => path.startsWith("/api/auth/");
const isSignInOrOut = (path: string) => path.startsWith("/api/auth/sign-in/") || path === "/api/auth/sign-out";

/** POST/PATCH/PUT/DELETE must carry the app's own Origin (SPEC §14, AC-API-06). Test routes are exempt. */
export function originCheck(appUrl: string | undefined): MiddlewareHandler {
  const allowed = appUrl ? new URL(appUrl).origin : undefined;
  return async (c, next) => {
    const path = c.req.path;
    if (isApi(path) && !isTest(path) && WRITE_METHODS.has(c.req.method)) {
      const origin = c.req.header("origin");
      if (!allowed || origin !== allowed) return apiError(c, "FORBIDDEN", "Request origin is not allowed.");
    }
    await next();
  };
}

export interface SessionUser {
  id: string;
  role: "admin" | "landlord" | "smoke";
  status: "invited" | "active" | "deactivated";
}

declare module "hono" {
  interface ContextVariableMap {
    user: SessionUser;
  }
}

/**
 * Requires a valid session for every /api route except health, auth and the public invitation routes.
 * Deactivated and invited users count as signed out. The smoke user can't write (D-24).
 */
export function sessionGuard(auth: Auth): MiddlewareHandler {
  return async (c, next) => {
    const path = c.req.path;
    if (!isApi(path) || isTest(path) || PUBLIC_PATHS.has(path)) return next();
    const writes = WRITE_METHODS.has(c.req.method);
    // Auth endpoints are public; only a signed-in smoke user's other writes need blocking.
    if (isAuthPath(path) && (!writes || isSignInOrOut(path))) return next();

    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    const u = session?.user as (SessionUser & { id: string }) | undefined;
    if (!u || u.status !== "active") {
      if (isAuthPath(path)) return next();
      return apiError(c, "UNAUTHENTICATED", "Please sign in.");
    }
    if (u.role === "smoke" && writes) return apiError(c, "FORBIDDEN", "This account is read-only.");
    c.set("user", { id: u.id, role: u.role, status: u.status });
    return next();
  };
}

/** Unexpected errors become a 500 INTERNAL in the §14.1 envelope (404s come from the SPA module). */
export function mountErrorHandlers(app: Hono) {
  app.onError((err, c) => {
    console.error(err);
    return apiError(c, "INTERNAL", "Something went wrong.");
  });
}
