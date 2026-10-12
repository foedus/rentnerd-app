/** Dashboard and statistics (DASH) and Investments (INV). */
import { expect, test, type Page } from '@playwright/test';
import { asAdmin } from './helpers/api';
import { freshApp, setToday } from './helpers/app';
import { addInvestment, createLease, createProperty, createTenant, createUnit, dollars, endLease, markMonthToMonth, uid } from './helpers/builders';
import { ADMIN } from './helpers/env';
import { dashboardFixture } from './helpers/fixtures';
import { button, cell, choose, confirmIfDialog, definition, dialog, field, optionsOf, signIn, text, valueOf } from './helpers/ui';

test.beforeEach(async ({ page }) => {
  await freshApp();
  await setToday('2026-10-12', page);
  await signIn(page, ADMIN.email, ADMIN.password);
});

async function summary(page: Page, term: string) {
  await expect(definition(page, term)).toBeVisible();
  return ((await definition(page, term).textContent()) ?? '').trim();
}

// ---------------------------------------------------------------- DASH

test('AC-DASH-01 the Portfolio summary totals the Dashboard fixture', async ({ page }) => {
  await dashboardFixture(await asAdmin());
  await page.goto('/');
  const expected: [string, string][] = [
    ['Units', '4'], ['Occupied', '3'], ['Vacant', '1'], ['Occupancy', '75.0%'], ['Monthly rent roll', '$6,000.00'],
    ['Annual rent roll', '$72,000.00'], ['Monthly other income', '$100.00'], ['Vacancy loss (monthly)', '$1,500.00'], ['Portfolio value', '$1,000,000.00'],
  ];
  for (const [term, value] of expected) expect(await summary(page, term), term).toBe(value);
});

test('AC-DASH-02 By property shows gross yield per property', async ({ page }) => {
  await dashboardFixture(await asAdmin());
  await page.goto('/');
  const t = page.getByRole('table', { name: 'By property' });
  expect(await cell(t, 'Property A', 'Gross yield')).toBe('6.12%');
  expect(await cell(t, 'Property B', 'Gross yield')).toBe('—');
  await expect(t.getByRole('link', { name: 'Property A' })).toBeVisible();
});

test('AC-DASH-03 the portfolio gross yield counts only properties with a value', async ({ page }) => {
  await dashboardFixture(await asAdmin());
  await page.goto('/');
  expect(await summary(page, 'Gross yield')).toContain('6.12%');
  await expect(page.getByText('Based on 1 of 2 properties with a value.')).toBeVisible();
});

test('AC-DASH-04 Leases ending in the next 90 days includes move-outs and excludes later, month-to-month and upcoming leases', async ({ page }) => {
  const api = await asAdmin();
  const p = await createProperty(api, { name: 'Ending Soon House' });
  const lease = async (label: string, startDate: string, endDate: string) => {
    const u = await createUnit(api, p.id, { label });
    const tn = await createTenant(api, { lastName: `Ten${label}` });
    return await createLease(api, u.id, { startDate, endDate, baseRentCents: dollars(1000), tenantIds: [tn.id] });
  };
  await lease('E45', '2025-11-27', '2026-11-26');
  const moving = await lease('M30', '2026-06-01', '2027-05-31');
  await endLease(api, moving.id, '2026-11-11');
  await lease('L120', '2026-02-10', '2027-02-09');
  const m2m = await lease('MTM', '2025-10-01', '2026-09-30');
  await markMonthToMonth(api, m2m.id);
  await lease('UPC', '2026-11-01', '2026-12-31');

  await page.goto('/');
  const t = page.getByRole('table', { name: 'Leases ending in the next 90 days' });
  expect(await cell(t, 'E45', 'Days left')).toBe('45');
  expect(await cell(t, 'M30', 'Days left')).toBe('30');
  for (const label of ['L120', 'MTM', 'UPC']) await expect(t.getByRole('row').filter({ hasText: label })).toHaveCount(0);
});

test('AC-DASH-05 a Month-to-month lease is occupied and not awaiting a decision', async ({ page }) => {
  const api = await asAdmin();
  const p = await createProperty(api, { name: 'Monthly House' });
  const u = await createUnit(api, p.id, { label: 'M1' });
  const tn = await createTenant(api);
  const l = await createLease(api, u.id, { startDate: '2025-10-01', endDate: '2026-09-30', baseRentCents: dollars(1800), tenantIds: [tn.id] });
  await markMonthToMonth(api, l.id);
  await page.goto('/');
  expect(await summary(page, 'Occupied')).toBe('1');
  expect(await summary(page, 'Vacant')).toBe('0');
  await expect(page.getByRole('table', { name: 'Leases needing a decision' }).getByRole('row').filter({ hasText: 'Monthly House' })).toHaveCount(0);
});

test('AC-DASH-06 an Upcoming lease leaves the unit vacant, shown as leased from its start', async ({ page }) => {
  const api = await asAdmin();
  const p = await createProperty(api, { name: 'Upcoming House' });
  const u = await createUnit(api, p.id, { label: 'U1' });
  const tn = await createTenant(api);
  await createLease(api, u.id, { startDate: '2026-11-01', endDate: '2027-10-31', baseRentCents: dollars(1800), tenantIds: [tn.id] });
  await page.goto('/');
  expect(await summary(page, 'Vacant')).toBe('1');
  expect(await summary(page, 'Occupied')).toBe('0');
  await page.goto(`/properties/${p.id}`);
  await page.getByRole('tab', { name: 'Units', exact: true }).click();
  await expect(page.getByRole('main').getByRole('row').filter({ hasText: 'U1' })).toContainText('Vacant · leased from Nov 1, 2026');
});

test('AC-DASH-07 a Needs decision lease is occupied at its last known rent', async ({ page }) => {
  const api = await asAdmin();
  const p = await createProperty(api, { name: 'Undecided House' });
  const u = await createUnit(api, p.id, { label: 'N1' });
  const tn = await createTenant(api);
  await createLease(api, u.id, { startDate: '2025-10-01', endDate: '2026-09-30', baseRentCents: dollars(2000), tenantIds: [tn.id] });
  await page.goto('/');
  expect(await summary(page, 'Occupied')).toBe('1');
  expect(await summary(page, 'Monthly rent roll')).toBe('$2,000.00');
  await expect(page.getByRole('table', { name: 'Leases needing a decision' }).getByRole('row').filter({ hasText: 'N1' })).toHaveCount(1);
});

// ---------------------------------------------------------------- INV

async function propertyWithUnits(name: string, labels: string[]) {
  const api = await asAdmin();
  const p = await createProperty(api, { name });
  const units = [];
  for (const label of labels) units.push(await createUnit(api, p.id, { label }));
  return { p, units };
}

const totalRow = (page: Page) => page.getByRole('main').getByRole('row').filter({ hasText: /^\s*Total/ });

test('AC-INV-01 adding an entry shows "Entry saved." and lists it', async ({ page }) => {
  await propertyWithUnits('Property A', ['A1']);
  await page.goto('/investments');
  await button(page, 'Add entry').click();
  const d = dialog(page);
  await field(d, 'Date').fill('2026-09-01');
  await choose(d, 'Property', 'Property A');
  await choose(d, 'Unit', 'Whole property');
  await choose(d, 'Category', 'Appliance');
  await field(d, 'Description').fill('Replace fridge');
  await field(d, 'Vendor').fill('AJ Madison');
  await field(d, 'Cost').fill('1250');
  await button(d, 'Save entry').click();
  await expect(text(page, 'Entry saved.')).toBeVisible();
  const row = page.getByRole('main').getByRole('row').filter({ hasText: 'Replace fridge' });
  await expect(row).toContainText('AJ Madison');
  await expect(row).toContainText('$1,250.00');
});

test('AC-INV-02 filters update the Total', async ({ page }) => {
  const api = await asAdmin();
  const { p: a } = await propertyWithUnits('Property A', []);
  const { p: b } = await propertyWithUnits(`Property B ${uid()}`, []);
  await addInvestment(api, { entryDate: '2026-09-01', propertyId: a.id, category: 'Appliance', description: 'Fridge', costCents: dollars(1250) });
  await addInvestment(api, { entryDate: '2026-09-02', propertyId: a.id, category: 'Appliance', description: 'Stove', costCents: dollars(750) });
  await addInvestment(api, { entryDate: '2026-09-03', propertyId: a.id, category: 'Repair', description: 'Leak', costCents: dollars(300) });
  await addInvestment(api, { entryDate: '2026-09-04', propertyId: b.id, category: 'Appliance', description: 'Washer', costCents: dollars(100) });
  await page.goto('/investments');
  await expect(totalRow(page)).toContainText('$2,400.00');
  await choose(page, 'Property', 'Property A');
  await choose(page, 'Category', 'Appliance');
  await expect(totalRow(page)).toContainText('$2,000.00');
});

test('AC-INV-03 property detail shows Total invested', async ({ page }) => {
  const api = await asAdmin();
  const { p } = await propertyWithUnits('Invested House', []);
  await addInvestment(api, { entryDate: '2026-09-01', propertyId: p.id, category: 'Renovation', description: 'Kitchen', costCents: dollars(20000) });
  await addInvestment(api, { entryDate: '2026-09-02', propertyId: p.id, category: 'Appliance', description: 'Dryer', costCents: dollars(900.5) });
  await page.goto(`/properties/${p.id}`);
  expect(await valueOf(page, 'Total invested')).toContain('$20,900.50');
});

test('AC-INV-04 the Unit select lists only units of the chosen property', async ({ page }) => {
  await propertyWithUnits('Property A', ['A1', 'A2']);
  await propertyWithUnits('Other Property', ['Z9']);
  await page.goto('/investments');
  await button(page, 'Add entry').click();
  const d = dialog(page);
  await choose(d, 'Property', 'Property A');
  const units = await optionsOf(d, 'Unit');
  expect(units[0]).toBe('Whole property');
  expect(units.slice(1).sort()).toEqual(['A1', 'A2']);
});

test('AC-INV-05 deleting an entry updates the totals', async ({ page }) => {
  const api = await asAdmin();
  const { p } = await propertyWithUnits('Delete Entry House', []);
  await addInvestment(api, { entryDate: '2026-09-01', propertyId: p.id, category: 'Repair', description: 'Keep me', costCents: dollars(100) });
  await addInvestment(api, { entryDate: '2026-09-02', propertyId: p.id, category: 'Repair', description: 'Remove me', costCents: dollars(50) });
  await page.goto('/investments');
  await expect(totalRow(page)).toContainText('$150.00');
  await page.getByRole('main').getByRole('row').filter({ hasText: 'Remove me' }).getByRole('button', { name: 'Delete' }).click();
  await confirmIfDialog(page, /Delete/);
  await expect(page.getByRole('main').getByRole('row').filter({ hasText: 'Remove me' })).toHaveCount(0);
  await expect(totalRow(page)).toContainText('$100.00');
  await page.goto(`/properties/${p.id}`);
  expect(await valueOf(page, 'Total invested')).toContain('$100.00');
});
