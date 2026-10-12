import fs from 'node:fs';
import path from 'node:path';

export const ACCEPTANCE_DIR = path.resolve(__dirname, '..');
export const REPO_ROOT = path.resolve(ACCEPTANCE_DIR, '..', '..');
export const STATE_DIR = path.join(ACCEPTANCE_DIR, '.state');

export function parseEnvFile(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 0) continue;
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

export const TEST_ENV = parseEnvFile(path.join(ACCEPTANCE_DIR, 'test.env'));
export const APP_URL = TEST_ENV.APP_URL;
export const MAILPIT_URL = process.env.MAILPIT_URL ?? 'http://localhost:8025';

/** The Admin is bootstrapped by accepting the startup invitation (D-05) after every reset. */
export const ADMIN = { name: 'Ada Admin', email: TEST_ENV.ADMIN_EMAIL, password: 'Admin-password-0001' };
export const SMOKE = { email: TEST_ENV.SMOKE_USER_EMAIL, password: TEST_ENV.SMOKE_USER_PASSWORD };
/** Password used for every landlord the tests create. */
export const PASSWORD = 'Landlord-password-0001';
