import { expect, test } from '@playwright/test';
import { Api, asAdmin, trySignIn } from './helpers/api';
import { clearClock, createLandlord, freshApp, setNow, setToday } from './helpers/app';
import { ADMIN, PASSWORD } from './helpers/env';
import { countMailAfter, linkContaining, waitForMail } from './helpers/mailpit';
import { button, field, heading1, signIn, signInUi, signOutUi } from './helpers/ui';

const INCORRECT = 'Incorrect email or password.';
const TOO_MANY = 'Too many attempts. Try again in a few minutes.';
const RESET_SENT = "If an account exists for that email, we've sent a reset link.";
const RESET_SUBJECT = 'Reset your RentNerd password';

test.beforeEach(async () => {
  await freshApp();
  await setToday('2026-10-12');
});

async function requestReset(page: import('@playwright/test').Page, email: string) {
  await page.goto('/forgot-password');
  await field(page, 'Email').fill(email);
  await button(page, 'Send reset link').click();
  await expect(page.getByText(RESET_SENT, { exact: true })).toBeVisible();
}

const pathOf = (url: string) => {
  const u = new URL(url);
  return u.pathname + u.search;
};

/** The invalid-link message may appear on load or after submitting; both satisfy §11.3. */
async function expectInvalidResetLink(page: import('@playwright/test').Page, link: string) {
  const invalid = page.getByText('This reset link is invalid or has expired.');
  await page.goto(link);
  try {
    await invalid.waitFor({ timeout: 5000 });
  } catch {
    await field(page, 'New password').fill('Unused-password-0009');
    await field(page, 'Confirm new password').fill('Unused-password-0009');
    await button(page, 'Reset password').click();
  }
  await expect(invalid).toBeVisible();
  await expect(page.getByRole('link', { name: 'Request a new link' })).toBeVisible();
}

test('AC-AUTH-01 signed-out visits redirect to /login and return to the requested page after sign-in', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login/);
  await page.goto('/properties');
  await expect(page).toHaveURL(/\/login/);
  await signInUi(page, ADMIN.email, ADMIN.password);
  await expect(page).toHaveURL(/\/properties$/);
  await expect(heading1(page)).toHaveText('Properties');
});

test('AC-AUTH-02 a wrong password shows the error and stays on /login', async ({ page }) => {
  await signInUi(page, ADMIN.email, 'Wrong-password-000');
  await expect(page.getByText(INCORRECT, { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

test('AC-AUTH-03 a deactivated user with correct credentials sees the generic error', async ({ page }) => {
  const l = await createLandlord('Dee Activated');
  const admin = await asAdmin();
  await admin.ok('POST', `/api/users/${l.id}/deactivate`, {});
  await signInUi(page, l.email, l.password);
  await expect(page.getByText(INCORRECT, { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

test('AC-AUTH-04 the 6th attempt within 15 minutes is rate-limited, for existing and unknown emails', async ({ page }) => {
  const l = await createLandlord('Rate Limited');
  for (let i = 0; i < 5; i++) expect(await trySignIn(l.email, `Wrong-password-${i}000`)).not.toBe(200);
  await signInUi(page, l.email, l.password);
  await expect(page.getByText(TOO_MANY, { exact: true })).toBeVisible();

  const ghost = 'nobody-here@example.com';
  for (let i = 0; i < 5; i++) expect(await trySignIn(ghost, `Wrong-password-${i}000`)).not.toBe(200);
  await page.goto('/login');
  await signInUi(page, ghost, 'Wrong-password-x000');
  await expect(page.getByText(TOO_MANY, { exact: true })).toBeVisible();
});

test('AC-AUTH-05 reset requests always show the same message; email only for active verified users, max 3 per hour', async ({ page }) => {
  const l = await createLandlord('Reset Requester');
  const gone = await createLandlord('Reset Deactivated');
  const admin = await asAdmin();
  await admin.ok('POST', `/api/users/${gone.id}/deactivate`, {});
  await requestReset(page, 'no-account@example.com');
  await requestReset(page, gone.email);
  await requestReset(page, l.email);
  await waitForMail({ to: l.email, subject: RESET_SUBJECT });
  expect(await countMailAfter({ to: 'no-account@example.com' }, 3000)).toBe(0);
  expect(await countMailAfter({ to: gone.email, subject: RESET_SUBJECT }, 0)).toBe(0);
  for (let i = 0; i < 4; i++) await requestReset(page, l.email);
  const sent = await countMailAfter({ to: l.email, subject: RESET_SUBJECT });
  expect(sent).toBeGreaterThanOrEqual(1);
  expect(sent).toBeLessThanOrEqual(3);
});

test('AC-AUTH-06 resetting the password works, revokes other sessions and sends a confirmation', async ({ page, browser }) => {
  const l = await createLandlord('Reset Success');
  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await signIn(otherPage, l.email, l.password);
  await otherPage.goto('/properties');
  await expect(heading1(otherPage)).toHaveText('Properties');

  await requestReset(page, l.email);
  const [mail] = await waitForMail({ to: l.email, subject: RESET_SUBJECT });
  await page.goto(pathOf(linkContaining(mail, '/reset-password')));
  const newPassword = 'Brand-new-password-0002';
  await field(page, 'New password').fill(newPassword);
  await field(page, 'Confirm new password').fill(newPassword);
  await button(page, 'Reset password').click();
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByText('Your password has been reset. Please sign in.')).toBeVisible();
  await signInUi(page, l.email, newPassword);
  await expect(heading1(page)).toHaveText('Dashboard');
  expect(await trySignIn(l.email, l.password)).not.toBe(200);

  await otherPage.reload();
  await expect(otherPage).toHaveURL(/\/login/);
  await waitForMail({ to: l.email, subject: 'Your RentNerd password was changed' });
  await other.close();
});

test('AC-AUTH-07 a reset link used twice, or after 1 hour, is invalid', async ({ page }) => {
  const l = await createLandlord('Reset Twice');
  await requestReset(page, l.email);
  const [mail] = await waitForMail({ to: l.email, subject: RESET_SUBJECT });
  const link = pathOf(linkContaining(mail, '/reset-password'));
  await page.goto(link);
  await field(page, 'New password').fill('Another-password-0003');
  await field(page, 'Confirm new password').fill('Another-password-0003');
  await button(page, 'Reset password').click();
  await expect(page).toHaveURL(/\/login/);
  await expectInvalidResetLink(page, link);

  // Expired: issued at 12:00, used at 13:01 (test clock).
  const m = await createLandlord('Reset Expired');
  await setNow('2026-10-12T16:00:00.000Z');
  await requestReset(page, m.email);
  const [mail2] = await waitForMail({ to: m.email, subject: RESET_SUBJECT });
  await setNow('2026-10-12T17:01:00.000Z');
  await expectInvalidResetLink(page, pathOf(linkContaining(mail2, '/reset-password')));
});

test('AC-AUTH-08 new-password fields enforce 12 characters and matching confirmation', async ({ page }) => {
  const l = await createLandlord('Short Password');
  await requestReset(page, l.email);
  const [mail] = await waitForMail({ to: l.email, subject: RESET_SUBJECT });
  await page.goto(pathOf(linkContaining(mail, '/reset-password')));
  await field(page, 'New password').fill('short1');
  await field(page, 'Confirm new password').fill('short1');
  await button(page, 'Reset password').click();
  await expect(page.getByText('Password must be at least 12 characters.').first()).toBeVisible();
  await field(page, 'New password').fill('Long-enough-password-1');
  await field(page, 'Confirm new password').fill('Long-enough-password-2');
  await button(page, 'Reset password').click();
  await expect(page.getByText("Passwords don't match.").first()).toBeVisible();

  // Account settings use the same rules.
  await signIn(page, l.email, l.password);
  await page.goto('/account');
  await field(page, 'Current password').fill(l.password);
  await field(page, 'New password').fill('short2');
  await field(page, 'Confirm new password').fill('short2');
  await button(page, 'Change password').click();
  await expect(page.getByText('Password must be at least 12 characters.').first()).toBeVisible();
  await field(page, 'New password').fill('Long-enough-password-1');
  await field(page, 'Confirm new password').fill('Long-enough-password-3');
  await button(page, 'Change password').click();
  await expect(page.getByText("Passwords don't match.").first()).toBeVisible();
});

test('AC-AUTH-09 sign out returns to /login and Back + reload shows no protected data', async ({ page }) => {
  await signInUi(page, ADMIN.email, ADMIN.password);
  await expect(heading1(page)).toHaveText('Dashboard');
  await page.goto('/properties');
  await signOutUi(page, ADMIN.name);
  await expect(page).toHaveURL(/\/login/);
  await page.goBack();
  await page.reload();
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole('heading', { name: 'Properties', level: 1 })).toHaveCount(0);
});

test('AC-AUTH-10 the session cookie is HttpOnly, SameSite=Lax and expires 7 days after sign-in', async ({ page, context }) => {
  // Secure is only required in production (checked by the production smoke test).
  await clearClock();
  const before = Date.now() / 1000;
  await signInUi(page, ADMIN.email, ADMIN.password);
  await expect(heading1(page)).toHaveText('Dashboard');
  // The spec doesn't name the cookie: one of the cookies set by signing in must be the 7-day session cookie.
  const cookies = await context.cookies();
  const session = cookies.find((c) => c.httpOnly && c.sameSite === 'Lax' && Math.abs(c.expires - (before + 7 * 24 * 3600)) <= 3600);
  expect(session, JSON.stringify(cookies)).toBeTruthy();
});

test('AC-AUTH-11 an invited user cannot sign in or reset, and /verify-email is not a page', async ({ page }) => {
  const invited = await createLandlord('Not Yet Accepted', undefined, { accept: false });
  await signInUi(page, invited.email, PASSWORD);
  await expect(page.getByText(INCORRECT, { exact: true })).toBeVisible();
  await requestReset(page, invited.email);
  expect(await countMailAfter({ to: invited.email, subject: RESET_SUBJECT })).toBe(0);
  await page.goto('/verify-email');
  await expect(page.getByText('Page not found', { exact: true })).toBeVisible();
});

test('AC-AUTH-12 there is no sign-up', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('link', { name: /sign up|create (an )?account|register/i })).toHaveCount(0);
  const api = await Api.anon();
  const r = await api.post('/api/auth/sign-up/email', { email: 'new@example.com', password: 'Some-password-0001', name: 'New' });
  expect(r.status).toBeGreaterThanOrEqual(400);
  expect(await trySignIn('new@example.com', 'Some-password-0001')).not.toBe(200);
});
