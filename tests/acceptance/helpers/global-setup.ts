import { MAILPIT_URL, TEST_ENV } from './env';
import { migrate, startApp, stopApp } from './processes';

async function reachable(url: string) {
  try {
    await fetch(url);
    return true;
  } catch {
    return false;
  }
}

export default async function globalSetup() {
  if (process.env.RENTNERD_SMOKE) return; // production smoke run: nothing to start
  for (const [name, url] of [
    ['Mailpit', `${MAILPIT_URL}/api/v1/info`],
    ['MinIO', `${TEST_ENV.AWS_ENDPOINT_URL_S3}/minio/health/live`],
  ]) {
    if (!(await reachable(url))) throw new Error(`${name} is not reachable at ${url}. Run \`docker compose up -d\` first.`);
  }
  await stopApp();
  await migrate();
  await startApp();
}
