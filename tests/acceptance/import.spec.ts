/** Import (IMP). */
import { expect, test, type Page } from '@playwright/test';
import { asAdmin } from './helpers/api';
import { freshApp, setToday } from './helpers/app';
import { createProperty, createUnit, createTenant, uid } from './helpers/builders';
import { ADMIN } from './helpers/env';
import { stepIs, wizardTenants, fillTerm } from './helpers/flows';
import { downloadBuffer } from './helpers/pdf';
import { button, signIn } from './helpers/ui';
import { buildImport, downloadTemplate, sheetNames, validRows, type Rows } from './helpers/xlsx';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

test.beforeAll(async () => {
  await freshApp();
});

test.beforeEach(async ({ page }) => {
  await setToday('2026-10-12', page);
  await signIn(page, ADMIN.email, ADMIN.password);
});

async function checkFile(page: Page, name: string, buffer: Buffer, mimeType = XLSX) {
  await page.goto('/import');
  await page.getByLabel(/^Spreadsheet file/).setInputFiles({ name, mimeType, buffer });
  await button(page, 'Check file').click();
}

async function fileFor(rows: Rows) {
  return await buildImport(await downloadTemplate(await asAdmin()), rows);
}

async function totals() {
  const api = await asAdmin();
  const out: Record<string, number> = {};
  for (const path of ['/api/owners', '/api/properties', '/api/tenants', '/api/leases']) out[path] = (await api.ok('GET', `${path}?archived=true&pageSize=1`)).total;
  return out;
}

const problems = (page: Page) => page.getByRole('main').getByRole('table');

test('AC-IMP-01 Download template gives the workbook with the six sheets', async ({ page }) => {
  await page.goto('/import');
  const [dl] = await Promise.all([page.waitForEvent('download'), button(page, 'Download template').click()]);
  expect(dl.suggestedFilename()).toBe('rentnerd-import-template.xlsx');
  expect((await sheetNames(await downloadBuffer(dl))).sort()).toEqual(expect.arrayContaining(['Instructions', 'Owners', 'Properties', 'Units', 'Tenants', 'Leases'].sort()));
});

test('AC-IMP-02 a valid file reports what will be imported', async ({ page }) => {
  const { buffer } = await fileFor(validRows(uid()));
  await checkFile(page, 'portfolio.xlsx', buffer);
  await expect(page.getByText('Ready to import: 1 owners, 1 properties, 2 units, 2 tenants, 1 leases.')).toBeVisible();
});

test('AC-IMP-03 Import creates the records with their compliance items', async ({ page }) => {
  const tag = uid();
  const { buffer } = await fileFor(validRows(tag));
  await checkFile(page, 'portfolio.xlsx', buffer);
  await button(page, 'Import').click();
  await expect(page.getByText('Import complete.')).toBeVisible();
  await expect(page.getByRole('link', { name: /Properties/ }).first()).toBeVisible();

  await page.goto('/properties');
  await page.getByRole('main').getByRole('link', { name: `Imported House ${tag}` }).click();
  await page.getByRole('tab', { name: 'Units', exact: true }).click();
  for (const label of ['1R', '2R']) await expect(page.getByRole('main').getByRole('row').filter({ hasText: label })).toHaveCount(1);
  await page.getByRole('tab', { name: 'Compliance', exact: true }).click();
  await expect(page.getByRole('main').getByRole('row').filter({ hasText: 'HPD Property Registration' })).not.toContainText('Not applicable');
  await page.goto('/tenants');
  await expect(page.getByRole('main').getByRole('row').filter({ hasText: `Port${tag}` })).toHaveCount(2);
  await page.goto('/leases');
  await expect(page.getByRole('main').getByRole('row').filter({ hasText: `Imported House ${tag}` })).toHaveCount(1);
});

test('AC-IMP-04 an unknown Property key is reported by sheet, row and column, and nothing is imported', async ({ page }) => {
  const before = await totals();
  const rows = validRows(uid());
  rows.Units = [{ 'Unit key': 'U1', 'Property key': 'X', 'Unit label': '1R', Use: 'Residential' }];
  delete rows.Leases;
  const { buffer, rowNumbers } = await fileFor(rows);
  await checkFile(page, 'bad-key.xlsx', buffer);
  await expect(page.getByText(/^We found \d+ problems?\. Fix them in the spreadsheet and check the file again\.$/)).toBeVisible();
  const row = problems(page).getByRole('row').filter({ hasText: "No property with key 'X' in the Properties sheet." });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('Units');
  await expect(row).toContainText('Property key');
  await expect(row).toContainText(String(rowNumbers.Units[0]));
  await expect(button(page, 'Import')).toHaveCount(0);
  expect(await totals()).toEqual(before);
});

test('AC-IMP-05 any error means nothing is imported', async ({ page }) => {
  const before = await totals();
  const rows = validRows(uid());
  rows.Tenants!.push({ 'Tenant key': 'T3', 'Tenant type': 'Individual', 'First name': 'No', 'Last name': 'Email', Email: 'not-an-email' });
  const { buffer } = await fileFor(rows);
  await checkFile(page, 'one-error.xlsx', buffer);
  await expect(page.getByText(/^We found \d+ problems?\./)).toBeVisible();
  await expect(button(page, 'Import')).toHaveCount(0);
  expect(await totals()).toEqual(before);
});

test('AC-IMP-06 wrong file types and files over 5 MB are rejected', async ({ page }) => {
  await checkFile(page, 'notes.txt', Buffer.from('not a spreadsheet'), 'text/plain');
  await expect(page.getByText('Choose an .xlsx file.').first()).toBeVisible();
  await checkFile(page, 'huge.xlsx', Buffer.alloc(5 * 1024 * 1024 + 1, 65));
  await expect(page.getByText('The file must be 5 MB or smaller.').first()).toBeVisible();
});

test('AC-IMP-07 a property name that already exists is reported', async ({ page }) => {
  const tag = uid();
  await createProperty(await asAdmin(), { name: `Imported House ${tag}` });
  const { buffer } = await fileFor(validRows(tag));
  await checkFile(page, 'dup.xlsx', buffer);
  await expect(problems(page).getByRole('row').filter({ hasText: 'A property with this name already exists.' })).toHaveCount(1);
});

test('AC-IMP-08 a residential lease without "Children reside in unit" gets the field\'s normal error', async ({ page }) => {
  const rows = validRows(uid());
  delete rows.Leases![0]['Children reside in unit'];
  const { buffer } = await fileFor(rows);
  await checkFile(page, 'children.xlsx', buffer);
  const row = problems(page).getByRole('row').filter({ hasText: 'Children reside in unit' });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('Leases');
  const cells = (await row.locator(':scope > td, :scope > th').allTextContents()).map((s) => s.trim());
  const message = cells[cells.length - 1];
  expect(message.length).toBeGreaterThan(0);

  // The same message the lease wizard shows for that field.
  const api = await asAdmin();
  const p = await createProperty(api);
  const u = await createUnit(api, p.id, { use: 'Residential' });
  const tn = await createTenant(api);
  await page.goto(`/units/${u.id}/leases/new`);
  await wizardTenants(page, { tenants: [{ search: tn.lastName, name: `${tn.firstName} ${tn.lastName}` }] });
  await fillTerm(page, { start: '2026-11-01', end: '2027-10-31', rent: '2000' });
  await button(page, 'Next').click();
  await stepIs(page, 3);
  await button(page, 'Next').click();
  await expect(page.getByText(message, { exact: true }).first()).toBeVisible();
});

test('AC-IMP-09 Import re-validates against data created after Check file', async ({ page }) => {
  const tag = uid();
  const before = await totals();
  const { buffer } = await fileFor(validRows(tag));
  await checkFile(page, 'race.xlsx', buffer);
  await expect(page.getByText('Ready to import: 1 owners, 1 properties, 2 units, 2 tenants, 1 leases.')).toBeVisible();
  await createProperty(await asAdmin(), { name: `Imported House ${tag}` });
  const afterCreate = await totals();
  await button(page, 'Import').click();
  await expect(problems(page).getByRole('row').filter({ hasText: 'A property with this name already exists.' })).toHaveCount(1);
  expect(await totals()).toEqual(afterCreate);
  expect(afterCreate['/api/properties']).toBe(before['/api/properties'] + 1);
});
