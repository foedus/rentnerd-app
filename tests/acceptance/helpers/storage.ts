/** MinIO / S3 access for storage assertions (SPEC.md §13 intro). */
import { ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { TEST_ENV } from './env';

const s3 = new S3Client({
  endpoint: TEST_ENV.AWS_ENDPOINT_URL_S3,
  region: TEST_ENV.AWS_REGION,
  forcePathStyle: true,
  credentials: { accessKeyId: TEST_ENV.AWS_ACCESS_KEY_ID, secretAccessKey: TEST_ENV.AWS_SECRET_ACCESS_KEY },
});

export async function listKeys(prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const r = await s3.send(new ListObjectsV2Command({ Bucket: TEST_ENV.BUCKET_NAME, Prefix: prefix, ContinuationToken: token }));
    for (const o of r.Contents ?? []) if (o.Key) keys.push(o.Key);
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
  return keys;
}
