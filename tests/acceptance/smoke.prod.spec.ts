/**
 * Production smoke test (SPEC.md D-24): read-only, runs after every deploy
 * against $PROD_URL as SMOKE_USER_EMAIL / SMOKE_USER_PASSWORD. It never
 * creates data (the smoke role can't write), so there is nothing to clean up.
 * Run with scripts/smoke-prod.sh (project "smoke").
 */
import { expect, test } from '@playwright/test';

const email = process.env.SMOKE_USER_EMAIL ?? '';
const password = process.env.SMOKE_USER_PASSWORD ?? '';

test.beforeAll(() => {
  if (!email || !password) throw new Error('SMOKE_USER_EMAIL and SMOKE_USER_PASSWORD must be set');
});

test('AC-PLAT-01 @smoke health endpoints answer 200', async ({ request }) => {
  const health = await request.get('/api/health');
  expect(health.status()).toBe(200);
  expect(await health.json()).toEqual({ status: 'ok' });
  expect((await request.get('/healthz')).status()).toBe(200);
});

test('AC-PLAT-02 @smoke the smoke user signs in, sees the Dashboard and Properties, and signs out', async ({ page, baseURL }) => {
  await page.goto('/login');
  await page.getByLabel(/^Email/).fill(email);
  await page.getByLabel(/^Password/).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Dashboard');
  await page.goto('/properties');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Properties');
  const me = await (await page.request.get(`${baseURL}/api/me`)).json();
  await page.getByRole('button', { name: me.name, exact: true }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).or(page.getByRole('button', { name: 'Sign out' })).first().click();
  await expect(page).toHaveURL(/\/login/);
});

test('AC-PLAT-03 @smoke the smoke user cannot write', async ({ request, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const signIn = await request.post('/api/auth/sign-in/email', { data: { email, password }, headers: { Origin: origin } });
  expect(signIn.status()).toBe(200);
  const r = await request.post('/api/properties', { data: { name: 'Smoke test must not be created' }, headers: { Origin: origin } });
  expect(r.status()).toBe(403);
  expect((await r.json()).error.code).toBe('FORBIDDEN');
  await request.post('/api/auth/sign-out', { data: {}, headers: { Origin: origin } });
});

test('AC-AUTH-10 @smoke the production session cookie is Secure, HttpOnly and SameSite=Lax', async ({ page, context }) => {
  await page.goto('/login');
  await page.getByLabel(/^Email/).fill(email);
  await page.getByLabel(/^Password/).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Dashboard');
  const session = (await context.cookies()).filter((c) => /session/i.test(c.name));
  expect(session.length).toBeGreaterThan(0);
  for (const c of session) {
    expect(c.secure, c.name).toBe(true);
    expect(c.httpOnly, c.name).toBe(true);
    expect(c.sameSite, c.name).toBe('Lax');
  }
});
