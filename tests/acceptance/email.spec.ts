/** Email reminders (EML). The daily job is triggered with POST /api/test/jobs/daily-digest. */
import { expect, test, type Page } from '@playwright/test';
import { asAdmin } from './helpers/api';
import { addDays, createLandlord, failNextEmail, freshApp, runDailyDigest, setToday } from './helpers/app';
import { archive, createProperty, createUnit, leasedUnit, tenantName, uid } from './helpers/builders';
import { ADMIN, APP_URL, SMOKE } from './helpers/env';
import { countMailAfter, findMail, linksIn, textOf, waitForMail } from './helpers/mailpit';
import { button, dialog, field, heading1, signIn, signInUi } from './helpers/ui';

const SMOKE_CO = 'Smoke and CO Detector Check';
const DIGEST = /^RentNerd: \d+ item\(s\) need attention – /;

test.beforeEach(async ({ page }) => {
  await freshApp();
  await setToday('2026-10-12', page);
  await signIn(page, ADMIN.email, ADMIN.password);
});

/** A non-NYC residential property: its only applicable seeded item is Smoke and CO (unscheduled). */
async function quietProperty(o: Record<string, unknown> = {}) {
  const api = await asAdmin();
  const p = await createProperty(api, { name: `Quiet House ${uid()}`, inNyc: false, ...o });
  await createUnit(api, p.id, { label: '1R', use: 'Residential' });
  return p;
}

async function setDueDate(page: Page, propertyId: string, item: string, date: string) {
  await page.goto(`/properties/${propertyId}`);
  await page.getByRole('tab', { name: 'Compliance', exact: true }).click();
  const row = page.getByRole('main').getByRole('row').filter({ hasText: item });
  await row.getByRole('button', { name: 'Set due date' }).click();
  const d = dialog(page);
  await field(d, 'Next due date').fill(date);
  await button(d, 'Save').click();
  await expect(d).toBeHidden();
}

async function digestOn(date: string) {
  await setToday(date);
  await runDailyDigest();
}

const digests = (to = ADMIN.email) => findMail({ to, subject: DIGEST });

test('AC-EML-01 30 days before a due date the responsible landlord gets one digest', async ({ page }) => {
  const p = await quietProperty();
  await setDueDate(page, p.id, SMOKE_CO, '2026-11-11');
  await runDailyDigest();
  const [mail] = await waitForMail({ to: ADMIN.email, subject: DIGEST });
  expect(mail.Subject).toBe('RentNerd: 1 item(s) need attention – Oct 12, 2026');
  const body = textOf(mail);
  expect(body).toContain(p.name);
  expect(body).toContain('Compliance due soon');
  expect(body).toContain(`${SMOKE_CO} – due Nov 11, 2026`);
  expect(await countMailAfter({ subject: DIGEST }, 3000)).toBe(1);
});

test('AC-EML-02 running the job twice on one day sends one email', async ({ page }) => {
  const p = await quietProperty();
  await setDueDate(page, p.id, SMOKE_CO, '2026-11-11');
  await runDailyDigest();
  await waitForMail({ to: ADMIN.email, subject: DIGEST });
  await runDailyDigest();
  expect(await countMailAfter({ subject: DIGEST })).toBe(1);
});

test('AC-EML-03 thresholds: sent at 30 days, not at 29, again at 7', async ({ page }) => {
  test.setTimeout(600_000);
  const p = await quietProperty();
  await setDueDate(page, p.id, SMOKE_CO, '2026-11-11');
  await digestOn('2026-10-12');
  await waitForMail({ to: ADMIN.email, subject: DIGEST });
  await digestOn('2026-10-13');
  expect(await countMailAfter({ subject: DIGEST })).toBe(1);
  for (let day = '2026-10-14'; day <= '2026-11-03'; day = addDays(day, 1)) await digestOn(day);
  expect(await countMailAfter({ subject: DIGEST })).toBe(1);
  await digestOn('2026-11-04');
  const mails = await waitForMail({ to: ADMIN.email, subject: DIGEST }, { count: 2 });
  expect(textOf(mails[1])).toContain(`${SMOKE_CO} – due Nov 11, 2026`);
});

test('AC-EML-04 an item 14 days overdue is listed as overdue', async ({ page }) => {
  const p = await quietProperty();
  await setDueDate(page, p.id, SMOKE_CO, '2026-09-28');
  await runDailyDigest();
  const [mail] = await waitForMail({ to: ADMIN.email, subject: DIGEST });
  expect(textOf(mail)).toContain('Overdue compliance');
  expect(textOf(mail)).toContain(`${SMOKE_CO} – overdue since Sep 28, 2026`);
});

test('AC-EML-05 a lease ending in 90 days is listed once', async () => {
  const api = await asAdmin();
  const { tenants } = await leasedUnit(api, { startDate: '2026-01-11', endDate: '2027-01-10', rent: 2000, unitLabel: '3B', property: { inNyc: false } });
  await digestOn('2026-10-12');
  const [mail] = await waitForMail({ to: ADMIN.email, subject: DIGEST });
  expect(textOf(mail)).toContain('Leases ending soon');
  expect(textOf(mail)).toContain(`Unit 3B – ${tenantName(tenants[0])} – lease ends Jan 10, 2027 (90 days)`);
  await digestOn('2026-10-13');
  expect(await countMailAfter({ subject: DIGEST })).toBe(1);
});

test('AC-EML-06 a Needs decision lease is listed 1 day and 8 days after the end', async () => {
  test.setTimeout(400_000);
  const api = await asAdmin();
  const { tenants } = await leasedUnit(api, { startDate: '2025-10-12', endDate: '2026-10-11', rent: 2000, unitLabel: '4C', property: { inNyc: false } });
  await digestOn('2026-10-12');
  const [first] = await waitForMail({ to: ADMIN.email, subject: DIGEST });
  expect(textOf(first)).toContain('Leases needing a decision');
  expect(textOf(first)).toContain(`Unit 4C – ${tenantName(tenants[0])} – lease ended Oct 11, 2026; extend, mark month-to-month, or end the lease`);
  for (let day = '2026-10-13'; day <= '2026-10-18'; day = addDays(day, 1)) await digestOn(day);
  expect(await countMailAfter({ subject: DIGEST })).toBe(1);
  await digestOn('2026-10-19');
  const all = await waitForMail({ to: ADMIN.email, subject: DIGEST }, { count: 2 });
  expect(textOf(all[1])).toContain('Leases needing a decision');
});

test('AC-EML-07 a missed threshold day is caught up the next day with the actual days left', async ({ page }) => {
  const api = await asAdmin();
  await leasedUnit(api, { startDate: '2026-01-11', endDate: '2027-01-10', rent: 2000, unitLabel: '5D', property: { inNyc: false } });
  const p = await quietProperty();
  await setDueDate(page, p.id, SMOKE_CO, '2026-11-11');
  await digestOn('2026-10-13');
  const [mail] = await waitForMail({ to: ADMIN.email, subject: DIGEST });
  expect(textOf(mail)).toContain('lease ends Jan 10, 2027 (89 days)');
  expect(textOf(mail)).toContain(`${SMOKE_CO} – due Nov 11, 2026`);
});

test('AC-EML-08 each responsible landlord gets their own digest', async ({ page }) => {
  const l = await createLandlord('Lena Digest');
  const m = await createLandlord('Milo Digest');
  const nobody = await createLandlord('Nora Nothing');
  const p1 = await quietProperty({ name: `Lena Only ${uid()}`, responsibleUserIds: [l.id] });
  const p2 = await quietProperty({ name: `Milo Only ${uid()}`, responsibleUserIds: [m.id] });
  const p3 = await quietProperty({ name: `Shared ${uid()}`, responsibleUserIds: [l.id, m.id] });
  for (const p of [p1, p2, p3]) await setDueDate(page, p.id, SMOKE_CO, '2026-11-11');
  await runDailyDigest();
  const [lm] = await waitForMail({ to: l.email, subject: DIGEST });
  const [mm] = await waitForMail({ to: m.email, subject: DIGEST });
  expect(textOf(lm)).toContain(p1.name);
  expect(textOf(lm)).toContain(p3.name);
  expect(textOf(lm)).not.toContain(p2.name);
  expect(textOf(mm)).toContain(p2.name);
  expect(textOf(mm)).toContain(p3.name);
  expect(textOf(mm)).not.toContain(p1.name);
  expect(await countMailAfter({ to: nobody.email, subject: DIGEST }, 3000)).toBe(0);
  expect((await digests(ADMIN.email)).length).toBe(0);
  expect((await digests(l.email)).length).toBe(1);
  expect((await digests(m.email)).length).toBe(1);
});

test('AC-EML-09 items of a deactivated landlord go to the Admin', async ({ page }) => {
  const l = await createLandlord('Gone Soon');
  const p = await quietProperty({ name: `Orphaned ${uid()}`, responsibleUserIds: [l.id] });
  await setDueDate(page, p.id, SMOKE_CO, '2026-11-11');
  const api = await asAdmin();
  await api.ok('POST', `/api/users/${l.id}/deactivate`, {});
  await runDailyDigest();
  const [mail] = await waitForMail({ to: ADMIN.email, subject: DIGEST });
  expect(textOf(mail)).toContain(p.name);
  expect(await countMailAfter({ to: l.email, subject: DIGEST }, 2000)).toBe(0);
});

test('AC-EML-10 archived and not-applicable items never appear', async ({ page }) => {
  const api = await asAdmin();
  const control = await quietProperty({ name: `Control ${uid()}` });
  await setDueDate(page, control.id, SMOKE_CO, '2026-11-11');

  const archivedProperty = await quietProperty({ name: `Archived Prop ${uid()}` });
  await setDueDate(page, archivedProperty.id, SMOKE_CO, '2026-11-11');
  await archive(api, `/api/properties/${archivedProperty.id}`);

  const leased = await leasedUnit(api, { startDate: '2026-01-11', endDate: '2027-01-10', rent: 2000, unitLabel: 'ARCH9', property: { inNyc: false } });
  await archive(api, `/api/units/${leased.unit.id}`);

  const typeName = `Archived type ${uid()}`;
  const type = await api.ok('POST', '/api/compliance/types', { name: typeName, appliesTo: 'All properties', nycOnly: false, scheduleType: 'interval', intervalMonths: 12 });
  await setDueDate(page, control.id, typeName, '2026-11-11');
  await api.ok('POST', `/api/compliance/types/${type.id}/archive`, { version: type.version });

  const na = await quietProperty({ name: `Switched Off ${uid()}` });
  await setDueDate(page, na.id, SMOKE_CO, '2026-11-11');
  await page.goto(`/properties/${na.id}`);
  await page.getByRole('tab', { name: 'Compliance', exact: true }).click();
  const row = page.getByRole('main').getByRole('row').filter({ hasText: SMOKE_CO });
  await row.getByRole('switch').or(row.getByRole('checkbox')).first().click();
  await expect(row).toContainText('Not applicable');

  await runDailyDigest();
  const [mail] = await waitForMail({ to: ADMIN.email, subject: DIGEST });
  const body = textOf(mail);
  expect(body).toContain(control.name);
  expect(body).not.toContain(archivedProperty.name);
  expect(body).not.toContain('Unit ARCH9');
  expect(body).not.toContain(typeName);
  expect(body).not.toContain(na.name);
  expect(mail.Subject).toMatch(/^RentNerd: 1 item\(s\)/);
});

test('AC-EML-11 every email comes from mail.rentnerd.xyz with text and HTML parts', async ({ page }) => {
  await createLandlord('Mail Format');
  const p = await quietProperty();
  await setDueDate(page, p.id, SMOKE_CO, '2026-11-11');
  await page.goto('/forgot-password');
  await field(page, 'Email').fill(ADMIN.email);
  await button(page, 'Send reset link').click();
  await runDailyDigest();
  await waitForMail({ subject: DIGEST });
  await waitForMail({ subject: 'Reset your RentNerd password' });
  const all = await findMail({});
  expect(all.length).toBeGreaterThanOrEqual(3);
  for (const m of all) {
    expect(m.From.Address, m.Subject).toMatch(/@mail\.rentnerd\.xyz$/);
    expect(m.Text.trim().length, `${m.Subject} text part`).toBeGreaterThan(0);
    expect(m.HTML.trim().length, `${m.Subject} html part`).toBeGreaterThan(0);
  }
});

test('AC-EML-12 digest links open the lease page and the property Compliance tab', async ({ page, browser }) => {
  const api = await asAdmin();
  const { lease, property } = await leasedUnit(api, { startDate: '2026-01-11', endDate: '2027-01-10', rent: 2000, property: { inNyc: false } });
  await setDueDate(page, property.id, SMOKE_CO, '2026-11-11');
  await runDailyDigest();
  const [mail] = await waitForMail({ to: ADMIN.email, subject: DIGEST });
  const links = linksIn(mail);
  const leaseLink = `${APP_URL}/leases/${lease.id}`;
  const complianceLink = `${APP_URL}/properties/${property.id}?tab=compliance`;
  expect(links).toContain(leaseLink);
  expect(links).toContain(complianceLink);

  await page.goto(leaseLink);
  await expect(heading1(page)).toContainText('Lease –');
  await page.goto(complianceLink);
  await expect(heading1(page)).toHaveText(property.name);
  await expect(page.getByRole('tab', { name: 'Compliance', exact: true })).toHaveAttribute('aria-selected', 'true');

  const ctx = await browser.newContext();
  const anon = await ctx.newPage();
  await anon.goto(leaseLink);
  await expect(anon).toHaveURL(/\/login/);
  await signInUi(anon, ADMIN.email, ADMIN.password);
  await expect(anon).toHaveURL(new RegExp(`/leases/${lease.id}$`));
  await ctx.close();
});

test('AC-EML-13 a permanently failed digest is resent the next day', async ({ page }) => {
  test.setTimeout(900_000);
  const p = await quietProperty();
  await setDueDate(page, p.id, SMOKE_CO, '2026-11-11');
  await failNextEmail();
  await runDailyDigest();
  await setToday('2026-10-13');
  // The failed job's pending rows are removed only after its retries are exhausted;
  // re-running the same next-day job is idempotent, so poll with it.
  const deadline = Date.now() + 600_000;
  let found = 0;
  while (Date.now() < deadline && found === 0) {
    await runDailyDigest();
    found = await countMailAfter({ to: ADMIN.email, subject: DIGEST }, 15_000);
  }
  expect(found).toBe(1);
  const [mail] = await findMail({ to: ADMIN.email, subject: DIGEST });
  expect(mail.Subject).toContain('Oct 13, 2026');
  expect(textOf(mail)).toContain(`${SMOKE_CO} – due Nov 11, 2026`);
});

test('AC-EML-14 the smoke user cannot be a responsible landlord', async () => {
  const api = await asAdmin();
  const smokeId = (await api.list('/api/users')).find((u: any) => u.email === SMOKE.email).id;
  const p = await createProperty(api);
  const r = await api.patch(`/api/properties/${p.id}`, { responsibleUserIds: [smokeId], version: p.version });
  expect(r.status).toBe(422);
});
