import { build } from "esbuild";

await build({
  entryPoints: {
    server: "src/server/main.ts",
    worker: "src/worker/main.ts",
    migrate: "src/db/migrate.ts",
    cli: "src/cli/main.ts",
  },
  outdir: "dist",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  packages: "external",
  sourcemap: true,
});
