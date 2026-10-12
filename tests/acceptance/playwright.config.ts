import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { APP_URL } from './helpers/env';

/**
 * Acceptance suite for SPEC.md §13. Serial, one worker: the app clock and the
 * database are shared (§13 intro). ACCEPTANCE_BROWSERS=chromium,firefox,webkit
 * selects browsers (default chromium). The `smoke` project runs only
 * smoke.prod.spec.ts against $PROD_URL (see scripts/smoke-prod.sh).
 */
const browsers = (process.env.ACCEPTANCE_BROWSERS ?? 'chromium').split(',').map((b) => b.trim()).filter(Boolean);
const deviceFor: Record<string, string> = { chromium: 'Desktop Chrome', firefox: 'Desktop Firefox', webkit: 'Desktop Safari' };

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 240_000,
  expect: { timeout: 15_000 },
  outputDir: 'test-results/artifacts',
  reporter: [['list'], ['json', { outputFile: path.join(__dirname, 'test-results', 'results.json') }]],
  globalSetup: './helpers/global-setup.ts',
  globalTeardown: './helpers/global-teardown.ts',
  use: { baseURL: APP_URL, trace: 'retain-on-failure', screenshot: 'only-on-failure', acceptDownloads: true, actionTimeout: 20_000, navigationTimeout: 30_000 },
  projects: [
    ...browsers.map((b) => ({
      name: `acceptance-${b}`,
      testIgnore: /smoke\.prod\.spec\.ts$/,
      use: { ...devices[deviceFor[b] ?? 'Desktop Chrome'], baseURL: APP_URL },
    })),
    {
      name: 'smoke',
      testMatch: /smoke\.prod\.spec\.ts$/,
      use: { ...devices['Desktop Chrome'], baseURL: process.env.PROD_URL ?? 'https://rentnerd-app.fly.dev' },
    },
  ],
});
