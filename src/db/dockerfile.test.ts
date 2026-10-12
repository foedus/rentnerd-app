import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dockerfile = readFileSync("Dockerfile", "utf8");
const dockerignore = readFileSync(".dockerignore", "utf8");

describe("Dockerfile", () => {
  it("installs postgresql-client and runs as a non-root user", () => {
    expect(dockerfile).toMatch(/apt-get install[^\n]*postgresql-client/);
    expect(dockerfile).toMatch(/^USER node$/m);
  });

  it("ships all four programs and the migrations next to dist/", () => {
    expect(dockerfile).toContain("COPY --from=build /app/dist ./dist");
    expect(dockerfile).toContain("/app/src/db/migrations ./src/db/migrations");
    expect(dockerfile).toContain('CMD ["node", "dist/server.js"]');
  });

  it("keeps secrets and build output out of the build context", () => {
    for (const entry of [".env", "node_modules", "dist"]) {
      expect(dockerignore.split("\n")).toContain(entry);
    }
  });
});
