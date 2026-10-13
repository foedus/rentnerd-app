import { AsyncLocalStorage } from "node:async_hooks";
import type { MiddlewareHandler } from "hono";
import { clientIp } from "./rate-limit";

const store = new AsyncLocalStorage<{ ip: string }>();

/** Makes the client IP (§14.1) available to code that has no Hono context, such as Better Auth hooks. */
export const requestContext: MiddlewareHandler = (c, next) => store.run({ ip: clientIp(c) }, next);

export const currentIp = (): string | null => store.getStore()?.ip ?? null;
