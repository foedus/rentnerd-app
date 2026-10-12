import { expect, test, type Page } from '@playwright/test';
import { Api, asAdmin, asUser, trySignIn } from './helpers/api';
import { addDays, createLandlord, freshApp, setToday } from './helpers/app';
import { createProperty } from './helpers/builders';
import { ADMIN, SMOKE } from './helpers/env';
import { linkContaining, waitForMail } from './helpers/mailpit';
import { button, confirmIfDialog, dialog, field, heading1, noAccess, signIn, text } from './helpers/ui';

const INVITE_SUBJECT = "You're invited to RentNerd";
const INVALID_INVITE = 'This invitation is invalid or has expired. Ask the administrator to send a new one.';

test.beforeEach(async () => {
  await freshApp();
  await setToday('2026-10-12');
});

const pathOf = (url: string) => {
  const u = new URL(url);
  return u.pathname + u.search;
};

const usersTable = (page: Page) => page.getByRole('main').getByRole('table').first();
const userRow = (page: Page, s: string) => usersTable(page).getByRole('row').filter({ hasText: s });

async function inviteViaApi(name: string, email: string) {
  const admin = await asAdmin();
  await admin.ok('POST', '/api/invitations', { name, email });
  await admin.dispose();
  const mails = await waitForMail({ to: email, subject: INVITE_SUBJECT });
  return linkContaining(mails[mails.length - 1], '/accept-invite');
}

async function latestInviteLink(email: string, count: number) {
  const mails = await waitForMail({ to: email, subject: INVITE_SUBJECT }, { count });
  return linkContaining(mails[mails.length - 1], '/accept-invite');
}

async function expectInvalidInvite(page: Page, link: string) {
  await page.goto(pathOf(link));
  await expect(page.getByText(INVALID_INVITE)).toBeVisible();
}

async function rowAction(page: Page, rowText: string, action: string) {
  await page.goto('/users');
  await userRow(page, rowText).getByRole('button', { name: action }).click();
}

test('AC-USR-01 the Admin invites Pat Lee; the Users table and Mailpit show the invitation', async ({ page }) => {
  await signIn(page, ADMIN.email, ADMIN.password);
  await page.goto('/users');
  await button(page, 'Invite landlord').click();
  const d = dialog(page);
  await field(d, 'Name').fill('Pat Lee');
  await field(d, 'Email').fill('pat@example.com');
  await button(d, 'Send invitation').click();
  const row = userRow(page, 'pat@example.com');
  await expect(row).toContainText('Pat Lee');
  await expect(row).toContainText('Landlord');
  await expect(row).toContainText('Invited');
  const [mail] = await waitForMail({ to: 'pat@example.com', subject: INVITE_SUBJECT });
  expect(mail.HTML + mail.Text).toContain('Set your password');
  expect(linkContaining(mail, '/accept-invite?token=')).toBeTruthy();
});

test('AC-USR-02 opening the invitation and setting a password signs Pat in; Users shows Active', async ({ page, browser }) => {
  const link = await inviteViaApi('Pat Lee', 'pat@example.com');
  const ctx = await browser.newContext();
  const pat = await ctx.newPage();
  await pat.goto(pathOf(link));
  await expect(pat.getByText('You\'re joining RentNerd as pat@example.com.')).toBeVisible();
  await expect(field(pat, 'Your name')).toHaveValue('Pat Lee');
  await field(pat, 'Password').fill('Pat-password-00001');
  await field(pat, 'Confirm password').fill('Pat-password-00001');
  await button(pat, 'Create account').click();
  await expect(heading1(pat)).toHaveText('Dashboard');
  await ctx.close();

  await signIn(page, ADMIN.email, ADMIN.password);
  await page.goto('/users');
  await expect(userRow(page, 'pat@example.com')).toContainText('Active');
});

test('AC-USR-03 a used invitation link shows the invalid message', async ({ page }) => {
  const link = await inviteViaApi('Pat Lee', 'pat@example.com');
  const anon = await Api.anon();
  const token = new URL(link).searchParams.get('token');
  await anon.ok('POST', '/api/invitations/accept', { token, name: 'Pat Lee', password: 'Pat-password-00001' });
  await expectInvalidInvite(page, link);
});

test('AC-USR-04 eight days later the invitation is expired', async ({ page }) => {
  const link = await inviteViaApi('Pat Lee', 'pat@example.com');
  await setToday(addDays('2026-10-12', 8));
  await expectInvalidInvite(page, link);
  await signIn(page, ADMIN.email, ADMIN.password);
  await page.goto('/users');
  await expect(userRow(page, 'pat@example.com')).toContainText('Invitation expired');
});

test('AC-USR-05 revoke invalidates the link; resend sends a working link and invalidates the previous one', async ({ page, browser }) => {
  const first = await inviteViaApi('Pat Lee', 'pat@example.com');
  await signIn(page, ADMIN.email, ADMIN.password);
  await rowAction(page, 'pat@example.com', 'Revoke invitation');
  await confirmIfDialog(page, /Revoke/);
  await expect(userRow(page, 'pat@example.com')).toContainText('Invitation revoked');

  const anon = await (await browser.newContext()).newPage();
  await expectInvalidInvite(anon, first);

  await rowAction(page, 'pat@example.com', 'Resend invitation');
  const second = await latestInviteLink('pat@example.com', 2);
  await anon.goto(pathOf(second));
  await expect(anon.getByText("You're joining RentNerd as pat@example.com.")).toBeVisible();

  await rowAction(page, 'pat@example.com', 'Resend invitation');
  const third = await latestInviteLink('pat@example.com', 3);
  await expectInvalidInvite(anon, second);
  await anon.goto(pathOf(third));
  await expect(anon.getByText("You're joining RentNerd as pat@example.com.")).toBeVisible();
  await field(anon, 'Password').fill('Pat-password-00001');
  await field(anon, 'Confirm password').fill('Pat-password-00001');
  await button(anon, 'Create account').click();
  await expect(heading1(anon)).toHaveText('Dashboard');
});

test('AC-USR-06 inviting an existing email shows the duplicate message', async ({ page }) => {
  const l = await createLandlord('Existing Person');
  await signIn(page, ADMIN.email, ADMIN.password);
  await page.goto('/users');
  await button(page, 'Invite landlord').click();
  const d = dialog(page);
  await field(d, 'Name').fill('Someone Else');
  await field(d, 'Email').fill(l.email);
  await button(d, 'Send invitation').click();
  await expect(page.getByText('A user with this email already exists.').first()).toBeVisible();
});

test('AC-USR-07 deactivating a landlord ends their open session and blocks sign-in', async ({ page, browser }) => {
  const l = await createLandlord('Lou Landlord');
  const ctx = await browser.newContext();
  const lp = await ctx.newPage();
  await signIn(lp, l.email, l.password);
  await lp.goto('/properties');
  await expect(heading1(lp)).toHaveText('Properties');

  await signIn(page, ADMIN.email, ADMIN.password);
  await rowAction(page, l.email, 'Deactivate');
  const d = dialog(page);
  await expect(d).toContainText(`Deactivate ${l.name}? They will be signed out and can't sign in.`);
  await button(d, 'Deactivate').click();
  await expect(userRow(page, l.email)).toContainText('Deactivated');

  await lp.reload();
  await expect(lp).toHaveURL(/\/login/);
  expect(await trySignIn(l.email, l.password)).not.toBe(200);
  await ctx.close();
});

test('AC-USR-08 deactivation reassigns orphaned properties to the Admin and removes the landlord elsewhere', async ({ page }) => {
  const l = await createLandlord('Lou Landlord');
  const m = await createLandlord('Mia Landlord');
  const admin = await asAdmin();
  const p = await createProperty(admin, { name: 'P Orphan House', responsibleUserIds: [l.id] });
  const q = await createProperty(admin, { name: 'Q Shared House', responsibleUserIds: [l.id, m.id] });
  await admin.ok('POST', `/api/users/${l.id}/deactivate`, {});

  await signIn(page, ADMIN.email, ADMIN.password);
  await page.goto(`/properties/${p.id}`);
  await expect(page.getByRole('main')).toContainText(ADMIN.name);
  await expect(page.getByRole('main')).not.toContainText(l.name);
  await page.goto(`/properties/${q.id}`);
  await expect(page.getByRole('main')).toContainText(m.name);
  await expect(page.getByRole('main')).not.toContainText(l.name);
  await expect(page.getByRole('main')).not.toContainText(ADMIN.name);
});

test('AC-USR-09 Reactivate restores sign-in with the previous password', async ({ page }) => {
  const l = await createLandlord('Rae Activated');
  const admin = await asAdmin();
  await admin.ok('POST', `/api/users/${l.id}/deactivate`, {});
  expect(await trySignIn(l.email, l.password)).not.toBe(200);
  await signIn(page, ADMIN.email, ADMIN.password);
  await rowAction(page, l.email, 'Reactivate');
  await confirmIfDialog(page, /Reactivate/);
  await expect(userRow(page, l.email)).toContainText('Active');
  expect(await trySignIn(l.email, l.password)).toBe(200);
});

test('AC-USR-10 the Admin cannot be deactivated', async ({ page }) => {
  await signIn(page, ADMIN.email, ADMIN.password);
  await page.goto('/users');
  const row = userRow(page, ADMIN.email);
  await expect(row).toBeVisible();
  await expect(row.getByRole('button', { name: 'Deactivate' })).toHaveCount(0);
  const admin = await asAdmin();
  const me = await admin.me();
  const r = await admin.post(`/api/users/${me.id}/deactivate`, {});
  expect(r.status).toBe(403);
});

test('AC-USR-11 landlords cannot reach user management', async ({ page }) => {
  const l = await createLandlord('Lou Landlord');
  await inviteViaApi('Pending Person', 'pending@example.com');
  const admin = await asAdmin();
  const invitations = await admin.list('/api/invitations');
  const inv = invitations.find((i: any) => JSON.stringify(i).includes('pending@example.com')) ?? invitations[0];

  await signIn(page, l.email, l.password);
  for (const path of ['/users', '/activity']) {
    await page.goto(path);
    await expect(page.getByText(noAccess, { exact: true })).toBeVisible();
  }
  const api = await asUser(l.email);
  for (const [method, path, body] of [
    ['GET', '/api/users', undefined],
    ['POST', '/api/invitations', { name: 'X', email: 'x@example.com' }],
    ['POST', `/api/invitations/${inv.id}/resend`, {}],
    ['POST', `/api/invitations/${inv.id}/revoke`, {}],
  ] as const) {
    const r = await api.call(method, path, body);
    expect(r.status, `${method} ${path}`).toBe(403);
    expect(r.body.error.code).toBe('FORBIDDEN');
  }
});

test('AC-USR-12 Save name updates the user menu', async ({ page }) => {
  const l = await createLandlord('Old Name');
  await signIn(page, l.email, l.password);
  await page.goto('/account');
  await field(page, 'Name').fill('New Name');
  await button(page, 'Save name').click();
  await expect(text(page, 'Name saved.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'New Name' })).toBeVisible();
});

test('AC-USR-13 a wrong current password is rejected', async ({ page }) => {
  const l = await createLandlord('Careful Changer');
  await signIn(page, l.email, l.password);
  await page.goto('/account');
  await field(page, 'Current password').fill('Not-my-password-01');
  await field(page, 'New password').fill('Next-password-00001');
  await field(page, 'Confirm new password').fill('Next-password-00001');
  await button(page, 'Change password').click();
  await expect(page.getByText('Current password is incorrect.').first()).toBeVisible();
});

test('AC-USR-14 responsible landlords are visible with email; /api/people lists only active editors', async ({ page }) => {
  const l = await createLandlord('Lou Landlord');
  const gone = await createLandlord('Gone Landlord');
  await createLandlord('Invited Only', 'invited-only@example.com', { accept: false });
  const admin = await asAdmin();
  await admin.ok('POST', `/api/users/${gone.id}/deactivate`, {});
  const p = await createProperty(admin, { responsibleUserIds: [(await admin.me()).id, l.id] });

  await signIn(page, l.email, l.password);
  await page.goto(`/properties/${p.id}`);
  for (const s of [ADMIN.name, ADMIN.email, l.name, l.email]) await expect(page.getByRole('main')).toContainText(s);

  const api = await asUser(l.email);
  const body = await api.ok('GET', '/api/people');
  const people: any[] = Array.isArray(body) ? body : body.data;
  const emails = people.map((x) => x.email);
  expect(emails).toEqual(expect.arrayContaining([ADMIN.email, l.email]));
  for (const x of people) {
    expect(x.name).toBeTruthy();
  }
  expect(emails).not.toContain(gone.email);
  expect(emails).not.toContain('invited-only@example.com');
  expect(emails).not.toContain(SMOKE.email);
});
