import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const yml = readFileSync(
  new URL("../../.github/workflows/deploy.yml", import.meta.url),
  "utf8",
);

describe("deploy workflow", () => {
  it("runs on pushes to main and by hand with a forced-smoke-failure input", () => {
    expect(yml).toMatch(/push:\s*\n\s*branches: \[main\]/);
    expect(yml).toMatch(/workflow_dispatch:/);
    expect(yml).toMatch(/force_smoke_failure:/);
  });

  it("verifies in the default (Chromium only, no @slow) mode", () => {
    expect(yml).toMatch(/run: \.\/scripts\/verify\.sh$/m);
    expect(yml).not.toMatch(/VERIFY_ALL|VERIFY_SLOW|ACCEPTANCE_BROWSERS/);
    expect(yml).toMatch(/docker compose up -d --wait/);
    expect(yml).toMatch(/playwright install --with-deps chromium/);
  });

  it("deploys only after verification, scales to one machine each, then smoke-tests", () => {
    expect(yml).toMatch(/deploy:\s*\n\s*needs: verify/);
    const order = [
      "flyctl deploy --remote-only",
      "scale count web=1 worker=1",
      "./scripts/smoke-prod.sh",
    ].map((s) => yml.indexOf(s));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(yml).toMatch(/secrets\.FLY_API_TOKEN/);
    expect(yml).toMatch(/secrets\.SMOKE_USER_EMAIL/);
    expect(yml).toMatch(/secrets\.SMOKE_USER_PASSWORD/);
  });

  it("redeploys the previous release image when the smoke step fails", () => {
    expect(yml).toMatch(
      /if: \$\{\{ failure\(\) && steps\.previous\.outputs\.image != '' \}\}/,
    );
    expect(yml).toMatch(
      /flyctl deploy --image "\$\{\{ steps\.previous\.outputs\.image \}\}"/,
    );
    expect(yml.indexOf("Remember the current release image")).toBeLessThan(
      yml.indexOf("flyctl deploy --remote-only"),
    );
  });

  it("can force the smoke step to fail", () => {
    expect(yml).toMatch(
      /FORCE_SMOKE_FAILURE: \$\{\{ inputs\.force_smoke_failure \}\}/,
    );
    expect(yml).toMatch(/"\$FORCE_SMOKE_FAILURE" = "true"[\s\S]*exit 1/);
  });
});
