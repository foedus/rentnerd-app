import { execFile } from "node:child_process";
import { connect } from "node:net";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const run = promisify(execFile);

function canConnect(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: "localhost", port }, () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("error", () => resolve(false));
  });
}

describe("docker compose services", () => {
  it("accepts connections on Postgres and the Mailpit SMTP port", async () => {
    expect(await canConnect(5432)).toBe(true);
    expect(await canConnect(1025)).toBe(true);
  });

  it("serves the Mailpit API", async () => {
    const res = await fetch("http://localhost:8025/api/v1/info");
    expect(res.ok).toBe(true);
  });

  it("has MinIO running", async () => {
    const res = await fetch("http://localhost:9000/minio/health/live");
    expect(res.ok).toBe(true);
  });

  // The init container keeps its `mc` alias, so ask it to list each bucket.
  it.each(["rentnerd-test", "rentnerd-dev"])("has the %s bucket", async (bucket) => {
    const { stdout } = await run("docker", [
      "compose", "exec", "-T", "minio-init", "mc", "stat", `local/${bucket}`,
    ]);
    expect(stdout).toContain(bucket);
  });

  it.each(["rentnerd", "rentnerd_test"])("has the %s database", async (database) => {
    const { stdout } = await run("docker", [
      "compose", "exec", "-T", "postgres",
      "psql", "-U", "rentnerd", "-d", database, "-tAc", "select 1",
    ]);
    expect(stdout.trim()).toBe("1");
  });
});
