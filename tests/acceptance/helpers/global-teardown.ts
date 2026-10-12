import { stopApp } from './processes';

export default async function globalTeardown() {
  if (process.env.RENTNERD_SMOKE) return;
  await stopApp();
}
