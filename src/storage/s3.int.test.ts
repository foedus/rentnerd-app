import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createStorage, SIGNED_URL_SECONDS } from "./s3";

const env = {
  AWS_ACCESS_KEY_ID: "minio",
  AWS_SECRET_ACCESS_KEY: "minio12345",
  AWS_ENDPOINT_URL_S3: "http://localhost:9000",
  AWS_REGION: "us-east-1",
  BUCKET_NAME: "rentnerd-test",
};

describe("S3 storage on MinIO", () => {
  it("stores, signs a 5-minute download link with the response headers, and deletes", async () => {
    const storage = createStorage(env);
    const key = `documents/test/${randomUUID()}.pdf`;
    const body = Buffer.from("%PDF-1.4 hello");
    expect(await storage.exists(key)).toBe(false);
    await storage.put(key, body, "application/pdf");
    expect(await storage.exists(key)).toBe(true);

    const disposition = `attachment; filename="Lease.pdf"; filename*=UTF-8''Lease.pdf`;
    const { url, expiresAt } = await storage.signedGetUrl(key, disposition);
    expect(new URL(url).searchParams.get("X-Amz-Expires")).toBe(String(SIGNED_URL_SECONDS));
    expect(SIGNED_URL_SECONDS).toBe(300);
    expect(expiresAt.getTime() - Date.now()).toBeGreaterThan(290_000);
    const res = await fetch(url);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBe(disposition);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(Buffer.from(await res.arrayBuffer()).equals(body)).toBe(true);

    expect((await fetch(`http://localhost:9000/rentnerd-test/${key}`)).status).toBe(403);

    await storage.remove(key);
    await storage.remove(key);
    expect(await storage.exists(key)).toBe(false);
  });

  it("needs a bucket name", () => {
    expect(() => createStorage({})).toThrow("BUCKET_NAME");
  });
});
