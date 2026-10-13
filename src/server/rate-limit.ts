import type { Context, MiddlewareHandler } from "hono";
import { apiError } from "./api-guard";

/** In-memory sliding-window counter. One web machine runs the app (§15), so memory is enough. */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();
  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Records an attempt for `key`; false once the limit within the window is used up. */
  take(key: string, now = Date.now()): boolean {
    const recent = (this.hits.get(key) ?? []).filter((t) => t > now - this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 10_000) this.prune(now);
    return true;
  }

  private prune(now: number) {
    for (const [key, times] of this.hits) if (!times.some((t) => t > now - this.windowMs)) this.hits.delete(key);
  }
}

/** Client IP (§14.1): Fly's header in production, the socket address elsewhere; X-Forwarded-For is ignored. */
export function clientIp(c: Context, env: NodeJS.ProcessEnv = process.env): string {
  if (env.NODE_ENV === "production") {
    const fly = c.req.header("fly-client-ip");
    if (fly) return fly;
  }
  const incoming = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)?.incoming;
  return incoming?.socket?.remoteAddress ?? "unknown";
}

export function rateLimit(limiter: RateLimiter): MiddlewareHandler {
  return async (c, next) => {
    if (!limiter.take(clientIp(c))) return apiError(c, "RATE_LIMITED", "Too many attempts. Try again in a few minutes.");
    await next();
  };
}
