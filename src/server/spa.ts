import { readFile } from "node:fs/promises";
import path from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import type { Hono } from "hono";

/** Serves the built SPA from `clientDir`; non-/api GETs without a file get index.html. */
export function mountSpa(app: Hono, clientDir: string) {
  const root = path.relative(process.cwd(), path.resolve(clientDir)) || ".";
  app.all("/api/*", (c) => c.json({ error: { code: "NOT_FOUND", message: "Not found" } }, 404));
  app.use("*", serveStatic({ root }));
  app.get("*", async (c) => {
    const html = await readFile(path.join(clientDir, "index.html"), "utf8");
    return c.html(html);
  });
}
