import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/** Signed download links live 5 minutes (SPEC §8.3, D-18). */
export const SIGNED_URL_SECONDS = 300;

export interface Storage {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  /** Removes the object; succeeds when it is already gone. */
  remove(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  /** Private-bucket download link; `contentDisposition` is sent back as the response header. */
  signedGetUrl(key: string, contentDisposition?: string): Promise<{ url: string; expiresAt: Date }>;
}

/** S3 client for Tigris (production) or MinIO (locally) from AWS_* and BUCKET_NAME (SPEC §4). */
export function createStorage(env: NodeJS.ProcessEnv = process.env): Storage {
  const bucket = env.BUCKET_NAME;
  if (!bucket) throw new Error("BUCKET_NAME is not set");
  const endpoint = env.AWS_ENDPOINT_URL_S3;
  const client = new S3Client({
    region: env.AWS_REGION ?? "auto",
    endpoint,
    credentials: env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY
      ? { accessKeyId: env.AWS_ACCESS_KEY_ID, secretAccessKey: env.AWS_SECRET_ACCESS_KEY }
      : undefined,
    // MinIO needs path-style addressing; Tigris uses virtual-hosted style.
    forcePathStyle: Boolean(endpoint) && !/tigris\.dev/.test(endpoint ?? ""),
  });
  return {
    async put(key, body, contentType) {
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
    },
    async remove(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
    async exists(key) {
      try {
        await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return true;
      } catch (error) {
        if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return false;
        throw error;
      }
    },
    async signedGetUrl(key, contentDisposition) {
      const url = await getSignedUrl(
        client,
        new GetObjectCommand({ Bucket: bucket, Key: key, ResponseContentDisposition: contentDisposition }),
        { expiresIn: SIGNED_URL_SECONDS },
      );
      return { url, expiresAt: new Date(Date.now() + SIGNED_URL_SECONDS * 1000) };
    },
  };
}
