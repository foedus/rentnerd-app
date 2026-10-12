import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const toml = readFileSync(new URL("../../fly.toml", import.meta.url), "utf8");

describe("fly.toml", () => {
  it("names the app and region", () => {
    expect(toml).toMatch(/^app = "rentnerd-app"$/m);
    expect(toml).toMatch(/^primary_region = "sjc"$/m);
  });

  it("defines the web and worker process groups and the release command", () => {
    expect(toml).toMatch(/^\s*web = "node dist\/server\.js"$/m);
    expect(toml).toMatch(/^\s*worker = "node dist\/worker\.js"$/m);
    expect(toml).toMatch(/^\s*release_command = "node dist\/migrate\.js"$/m);
  });

  it("sets the non-secret environment from SPEC §15", () => {
    expect(toml).toMatch(/APP_URL = "https:\/\/rentnerd-app\.fly\.dev"/);
    expect(toml).toMatch(/NODE_ENV = "production"/);
    expect(toml).toMatch(/TZ = "UTC"/);
  });

  it("serves only the web group on 8080 with a 15 s health check", () => {
    const http = toml.slice(toml.indexOf("[http_service]"), toml.indexOf("[[vm]]"));
    expect(http).toMatch(/internal_port = 8080/);
    expect(http).toMatch(/processes = \["web"\]/);
    expect(http).toMatch(/path = "\/api\/health"/);
    expect(http).toMatch(/interval = "15s"/);
  });

  it("sizes the machines per D-34", () => {
    const vms = toml.split("[[vm]]").slice(1);
    expect(vms).toHaveLength(2);
    expect(vms[0]).toMatch(/size = "shared-cpu-1x"[\s\S]*memory = "512mb"[\s\S]*processes = \["web"\]/);
    expect(vms[1]).toMatch(/size = "shared-cpu-1x"[\s\S]*memory = "1gb"[\s\S]*processes = \["worker"\]/);
  });

  it("contains no secrets", () => {
    expect(toml).not.toMatch(/SECRET|PASSWORD|TOKEN|DATABASE_URL/i);
  });
});
