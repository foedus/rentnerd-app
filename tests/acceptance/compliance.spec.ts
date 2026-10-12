/** Compliance (CMP). */
import { expect, test, type Page } from '@playwright/test';
import { asAdmin } from './helpers/api';
import { createLandlord, freshApp, runDailyDigest, setToday } from './helpers/app';
import { createProperty, createUnit, uid } from './helpers/builders';
import { ADMIN } from './helpers/env';
import { countMailAfter } from './helpers/mailpit';
import { button, choose, confirmIfDialog, dialog, field, setChecked, signIn } from './helpers/ui';

const SEEDED = [
  'HPD Property Registration', 'Bed Bug Annual Filing', 'Window Guard Annual Notice', 'Lead-Based Paint Annual Notice',
  'Stove Knob Cover Annual Notice', 'Smoke and CO Detector Check', 'Storefront Registry Filing', 'Boiler Inspection',
  'Gas Piping Inspection (Local Law 152)',
];
const NOTICE = 'Default dates are starting points. Check current requirements with the relevant agency; RentNerd does not provide legal advice.';

test.beforeAll(async () => {
  await freshApp();
});

test.beforeEach(async ({ page }) => {
  await setToday('2026-10-12', page);
  await signIn(page, ADMIN.email, ADMIN.password);
});

const mainOf = (page: Page) => page.getByRole('main');

async function complianceTab(page: Page, propertyId: string) {
  await page.goto(`/properties/${propertyId}`);
  await page.getByRole('tab', { name: 'Compliance', exact: true }).click();
  return mainOf(page).getByRole('table').filter({ hasText: 'Applies to this property' });
}

async function itemRow(page: Page, propertyId: string, item: string) {
  const t = await complianceTab(page, propertyId);
  const row = t.getByRole('row').filter({ hasText: item });
  await expect(row).toHaveCount(1);
  return row;
}

const switchIn = (row: ReturnType<Page['getByRole']>) => row.getByRole('switch').or(row.getByRole('checkbox')).first();

async function setDueDate(page: Page, propertyId: string, item: string, date: string) {
  const row = await itemRow(page, propertyId, item);
  await row.getByRole('button', { name: 'Set due date' }).click();
  const d = dialog(page);
  await field(d, 'Next due date').fill(date);
  await button(d, 'Save').click();
  await expect(d).toBeHidden();
}

async function openMarkDone(page: Page, propertyId: string, item: string) {
  const row = await itemRow(page, propertyId, item);
  await row.getByRole('button', { name: 'Mark done' }).click();
  const d = dialog(page);
  await expect(d).toBeVisible();
  return d;
}

async function nycResidential(name = `NYC Res ${uid()}`) {
  const api = await asAdmin();
  const p = await createProperty(api, { name, inNyc: true });
  await createUnit(api, p.id, { label: '1R', use: 'Residential' });
  return p;
}

async function addItemType(page: Page, o: { name: string; appliesTo: string; nycOnly: boolean; schedule: string; months?: string; month?: string; day?: string }) {
  await page.goto('/compliance');
  await page.getByRole('tab', { name: 'Item types', exact: true }).click();
  await button(page, 'Add item type').click();
  const scope = (await dialog(page).count()) > 0 ? dialog(page) : page;
  await field(scope, 'Name').fill(o.name);
  await choose(scope, 'Applies to', o.appliesTo);
  await setChecked(scope, 'New York City properties only', o.nycOnly);
  await choose(scope, 'Schedule', o.schedule);
  if (o.months) await field(scope, 'Repeat every (months)').fill(o.months);
  if (o.month) await choose(scope, 'Month', o.month).catch(async () => field(scope, 'Month').fill(o.month!));
  if (o.day) await field(scope, 'Day').fill(o.day);
  await button(scope, 'Save item type').click();
}

test('AC-CMP-01 the nine seeded item types and the notice are listed', async ({ page }) => {
  await page.goto('/compliance');
  await page.getByRole('tab', { name: 'Item types', exact: true }).click();
  await expect(page.getByText(NOTICE)).toBeVisible();
  for (const name of SEEDED) await expect(mainOf(page).getByRole('row').filter({ hasText: name })).toHaveCount(1);
});

test('AC-CMP-02 applicability follows units and the NYC flag', async ({ page }) => {
  const api = await asAdmin();
  const p = await createProperty(api, { name: `Empty NYC ${uid()}`, inNyc: true });
  await expect(await itemRow(page, p.id, 'HPD Property Registration')).toContainText('Not applicable');
  await createUnit(api, p.id, { label: '1R', use: 'Residential' });
  const row = await itemRow(page, p.id, 'HPD Property Registration');
  await expect(row).not.toContainText('Not applicable');
  await expect(row).toContainText('Sep 1, 2027');

  const q = await createProperty(api, { name: `Upstate Store ${uid()}`, inNyc: false });
  await createUnit(api, q.id, { label: 'Store', use: 'Commercial' });
  await expect(await itemRow(page, q.id, 'HPD Property Registration')).toContainText('Not applicable');
  await expect(await itemRow(page, q.id, 'Storefront Registry Filing')).toContainText('Not applicable');
});

test('AC-CMP-03 a new NYC residential property has Bed Bug due Dec 31, 2026 and Smoke/CO not scheduled', async ({ page }) => {
  const p = await nycResidential();
  const bedBug = await itemRow(page, p.id, 'Bed Bug Annual Filing');
  await expect(bedBug).toContainText('Dec 31, 2026');
  await expect(bedBug).toContainText('Upcoming');
  await expect(await itemRow(page, p.id, 'Smoke and CO Detector Check')).toContainText('Not scheduled');
});

test('AC-CMP-04 switching an item off hides it from the due list, dashboard and emails', async ({ page }) => {
  await freshApp();
  await setToday('2026-12-01', page);
  await signIn(page, ADMIN.email, ADMIN.password);
  const p = await nycResidential('Switch Off House');
  const row = await itemRow(page, p.id, 'Bed Bug Annual Filing');
  await expect(row).toContainText('Due soon');
  await switchIn(row).click();
  await expect(row).toContainText('Not applicable');

  await page.goto('/compliance');
  await expect(mainOf(page).getByRole('row').filter({ hasText: 'Switch Off House' }).filter({ hasText: 'Bed Bug Annual Filing' })).toHaveCount(0);
  await page.goto('/');
  for (const name of ['Overdue compliance', 'Compliance due in the next 30 days']) {
    await expect(page.getByRole('table', { name }).getByRole('row').filter({ hasText: 'Bed Bug Annual Filing' })).toHaveCount(0);
  }
  await runDailyDigest();
  expect(await countMailAfter({ body: /Bed Bug Annual Filing/ })).toBe(0);
});

test('AC-CMP-05 Mark done suggests next year and records the completion', async ({ page }) => {
  await setToday('2026-12-15', page);
  const p = await nycResidential();
  const d = await openMarkDone(page, p.id, 'Bed Bug Annual Filing');
  await expect(field(d, 'Completed on')).toHaveValue('2026-12-15');
  await expect(field(d, 'Next due date')).toHaveValue('2027-12-31');
  await button(d, 'Save').click();
  await expect(d).toBeHidden();
  const row = await itemRow(page, p.id, 'Bed Bug Annual Filing');
  await expect(row).toContainText('Dec 15, 2026');
  await row.getByRole('button', { name: 'History' }).click();
  await expect(dialog(page).getByRole('row').filter({ hasText: 'Dec 15, 2026' })).toHaveCount(1);
});

test('AC-CMP-06 an every-12-months item suggests one year after completion', async ({ page }) => {
  const p = await nycResidential();
  const d = await openMarkDone(page, p.id, 'Smoke and CO Detector Check');
  await expect(field(d, 'Next due date')).toHaveValue('2027-10-12');
});

test('AC-CMP-07 an item due before today is Overdue and on the dashboard', async ({ page }) => {
  const p = await nycResidential(`Overdue House ${uid()}`);
  await setDueDate(page, p.id, 'Smoke and CO Detector Check', '2026-10-01');
  await expect(await itemRow(page, p.id, 'Smoke and CO Detector Check')).toContainText('Overdue');
  await page.goto('/');
  await expect(page.getByRole('table', { name: 'Overdue compliance' }).getByRole('row').filter({ hasText: p.name }).filter({ hasText: 'Smoke and CO Detector Check' })).toHaveCount(1);
});

test('AC-CMP-08 a new item type is added to every property', async ({ page }) => {
  const api = await asAdmin();
  const withUnit = await createProperty(api, { name: `Has Unit ${uid()}`, inNyc: false });
  await createUnit(api, withUnit.id, { label: 'A' });
  const empty = await createProperty(api, { name: `No Units ${uid()}`, inNyc: true });
  const name = `Elevator inspection ${uid()}`;
  await addItemType(page, { name, appliesTo: 'All properties', nycOnly: false, schedule: 'Every N months after completion', months: '12' });
  const a = await itemRow(page, withUnit.id, name);
  await expect(a).toContainText('Not scheduled');
  await expect(switchIn(a)).toBeChecked();
  await expect(await itemRow(page, empty.id, name)).toContainText('Not applicable');
});

test('AC-CMP-09 a yearly schedule needs a month and day', async ({ page }) => {
  await page.goto('/compliance');
  await page.getByRole('tab', { name: 'Item types', exact: true }).click();
  await button(page, 'Add item type').click();
  const scope = (await dialog(page).count()) > 0 ? dialog(page) : page;
  await field(scope, 'Name').fill(`No date ${uid()}`);
  await choose(scope, 'Applies to', 'All properties');
  await choose(scope, 'Schedule', 'Same date every year');
  await button(scope, 'Save item type').click();
  await expect(page.getByText('Choose a month and day.').first()).toBeVisible();
});

test('AC-CMP-10 the due list filters by responsible landlord', async ({ page }) => {
  const l = await createLandlord('Lena Filter');
  const m = await createLandlord('Milo Filter');
  const api = await asAdmin();
  const pl = await createProperty(api, { name: `Lena House ${uid()}`, inNyc: true, responsibleUserIds: [l.id] });
  await createUnit(api, pl.id, { label: '1' });
  const pm = await createProperty(api, { name: `Milo House ${uid()}`, inNyc: true, responsibleUserIds: [m.id] });
  await createUnit(api, pm.id, { label: '1' });
  await page.goto('/compliance');
  await choose(page, 'Responsible landlord', l.name).catch(async () => choose(page, 'Responsible landlord', `${l.name} (${l.email})`));
  const rows = mainOf(page).getByRole('row');
  await expect(rows.filter({ hasText: pl.name }).first()).toBeVisible();
  await expect(rows.filter({ hasText: pm.name })).toHaveCount(0);
  for (const r of await rows.filter({ has: page.getByRole('cell') }).all()) await expect(r).toContainText(l.name);
});

test('AC-CMP-11 a switch turned off by an editor stays off when units are added', async ({ page }) => {
  const api = await asAdmin();
  const p = await nycResidential();
  const row = await itemRow(page, p.id, 'HPD Property Registration');
  await switchIn(row).click();
  await expect(row).toContainText('Not applicable');
  await createUnit(api, p.id, { label: '2R', use: 'Residential' });
  const after = await itemRow(page, p.id, 'HPD Property Registration');
  await expect(switchIn(after)).not.toBeChecked();
  await expect(after).toContainText('Not applicable');
});

test('AC-CMP-12 a long-overdue annual item suggests the next future date', async ({ page }) => {
  const p = await nycResidential();
  await setDueDate(page, p.id, 'HPD Property Registration', '2024-09-01');
  const d = await openMarkDone(page, p.id, 'HPD Property Registration');
  await expect(field(d, 'Next due date')).toHaveValue('2027-09-01');
});

test('AC-CMP-13 a monthly item done on Jan 31 suggests Feb 28', async ({ page }) => {
  await setToday('2027-01-31', page);
  const name = `Monthly check ${uid()}`;
  await addItemType(page, { name, appliesTo: 'All properties', nycOnly: false, schedule: 'Every N months after completion', months: '1' });
  const p = await nycResidential();
  const d = await openMarkDone(page, p.id, name);
  await expect(field(d, 'Completed on')).toHaveValue('2027-01-31');
  await expect(field(d, 'Next due date')).toHaveValue('2027-02-28');
});

test('AC-CMP-14 deleting an unused item type removes it from properties only', async ({ page }) => {
  const p = await nycResidential(`Type Delete House ${uid()}`);
  const name = `Gutter check ${uid()}`;
  await addItemType(page, { name, appliesTo: 'All properties', nycOnly: false, schedule: 'Every N months after completion', months: '6' });
  const t = await complianceTab(page, p.id);
  await expect(t.getByRole('row').filter({ hasText: name })).toHaveCount(1);
  const otherRowsBefore = (await t.getByRole('row').count()) - 1;

  await page.goto('/compliance');
  await page.getByRole('tab', { name: 'Item types', exact: true }).click();
  await mainOf(page).getByRole('row').filter({ hasText: name }).getByRole('button', { name: 'Delete' }).click();
  await confirmIfDialog(page, /Delete/);
  const after = await complianceTab(page, p.id);
  await expect(after.getByRole('row').filter({ hasText: name })).toHaveCount(0);
  await expect(after.getByRole('row')).toHaveCount(otherRowsBefore);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(p.name);
});

test('AC-CMP-15 a completed one-time item shows Completed', async ({ page }) => {
  const name = `One time setup ${uid()}`;
  await addItemType(page, { name, appliesTo: 'All properties', nycOnly: false, schedule: 'One time' });
  const p = await nycResidential();
  const d = await openMarkDone(page, p.id, name);
  const next = field(d, 'Next due date');
  if ((await next.count()) > 0) await next.fill('');
  await button(d, 'Save').click();
  await expect(d).toBeHidden();
  await expect(await itemRow(page, p.id, name)).toContainText('Completed');
});
