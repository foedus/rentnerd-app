/** Leases (LEASE) and Extensions (EXT). */
import { expect, test, type Page } from '@playwright/test';
import { asAdmin } from './helpers/api';
import { createLandlord, freshApp, runDailyDigest, setToday } from './helpers/app';
import {
  addExtension, addTax, createLease, createProperty, createTenant, createUnit, dollars, endLease, getLease, leasedUnit,
  markMonthToMonth, tenantName, templateIdByName, generateDocument, waitForDocument, downloadDocument,
} from './helpers/builders';
import { ADMIN } from './helpers/env';
import {
  addExistingTenant, completeWizard, createTemplateUi, fillTerm, leaseIdFromUrl, stepIs, wizardTenants,
} from './helpers/flows';
import { countMailAfter } from './helpers/mailpit';
import { pdfText, squash } from './helpers/pdf';
import { button, choose, dialog, field, sectionOf, signIn, valueOf } from './helpers/ui';

test.beforeAll(async () => {
  await freshApp();
});

test.beforeEach(async ({ page }) => {
  await setToday('2026-10-12', page);
  await signIn(page, ADMIN.email, ADMIN.password);
});

const mainOf = (page: Page) => page.getByRole('main');

async function goLease(page: Page, id: string) {
  await page.goto(`/leases/${id}`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Lease –');
}

async function expectStatus(page: Page, leaseId: string, status: string | RegExp) {
  await goLease(page, leaseId);
  await expect(mainOf(page).getByText(status).first()).toBeVisible();
}

async function expectCurrentRent(page: Page, leaseId: string, rent: string) {
  await goLease(page, leaseId);
  expect(await valueOf(page, 'Current monthly rent')).toContain(rent);
}

async function expectUnitStatus(page: Page, unitId: string, status: string) {
  await page.goto(`/units/${unitId}`);
  expect(await valueOf(page, 'Status')).toContain(status);
}

/** Moves through the remaining wizard steps (answering "Children reside in unit" if asked) and saves. */
async function finishWizard(page: Page) {
  for (let i = 0; i < 6; i++) {
    if (/\/leases\/[0-9a-f-]{36}$/.test(page.url())) return;
    const save = button(page, 'Save lease');
    if (await save.isVisible()) {
      await save.click();
      await page.waitForURL(/\/leases\/[0-9a-f-]{36}$/, { timeout: 10_000 }).catch(() => {});
      continue;
    }
    const children = page.getByRole('radiogroup', { name: /^Children reside in unit/ }).or(page.getByLabel(/^Children reside in unit/));
    if (await children.first().isVisible()) await choose(page, 'Children reside in unit', 'No');
    await button(page, 'Next').click();
  }
}

/** Fills steps 1-2 and moves on until either the clash error appears or the lease would be saved. */
async function wizardUntilClash(page: Page, unitId: string, tenant: { search: string; name: string }, start: string, end: string, rent: string) {
  await page.goto(`/units/${unitId}/leases/new`);
  await wizardTenants(page, { tenants: [tenant] });
  await stepIs(page, 2);
  await fillTerm(page, { start, end, rent });
  await button(page, 'Next').click();
  const clash = page.getByText('This unit already has a lease for those dates.').first();
  try {
    await clash.waitFor({ timeout: 4000 });
  } catch {
    await finishWizard(page);
  }
  await expect(clash).toBeVisible();
}

const replaceControl = (page: Page) =>
  page
    .getByRole('button', { name: 'Replace current lease' })
    .or(page.getByRole('checkbox', { name: 'Replace current lease' }))
    .or(page.getByRole('radio', { name: 'Replace current lease' }))
    .or(page.getByRole('switch', { name: 'Replace current lease' }));

const t = (x: any) => ({ search: x.lastName as string, name: tenantName(x) });

// ---------------------------------------------------------------- LEASE

test('AC-LEASE-01 the wizard creates an Upcoming lease with two tenants and one primary contact', async ({ page }) => {
  const api = await asAdmin();
  const p = await createProperty(api, { name: 'Wizard House' });
  const u = await createUnit(api, p.id, { label: '2R' });
  const a = await createTenant(api, { firstName: 'Ann', lastName: 'Wizardlee' });
  const b = await createTenant(api, { firstName: 'Bo', lastName: 'Wizarddiaz' });
  await completeWizard(page, u.id, { tenants: [t(a), t(b)], primary: 'Bo Wizarddiaz', start: '2026-11-01', end: '2027-10-31', rent: '2150', children: 'No' });
  await expect(mainOf(page).getByText('Upcoming').first()).toBeVisible();
  const tenants = await sectionOf(page, 'Tenants');
  await expect(tenants).toContainText('Ann Wizardlee');
  await expect(tenants).toContainText('Bo Wizarddiaz');
  const items = tenants.getByRole('row').or(tenants.getByRole('listitem'));
  await expect(items.filter({ hasText: 'Bo Wizarddiaz' }).first()).toContainText('Primary contact');
  await expect(items.filter({ hasText: 'Ann Wizardlee' }).first()).not.toContainText('Primary contact');
});

test('AC-LEASE-02 step 1 requires a tenant', async ({ page }) => {
  const api = await asAdmin();
  const p = await createProperty(api);
  const u = await createUnit(api, p.id);
  await page.goto(`/units/${u.id}/leases/new`);
  await stepIs(page, 1);
  await button(page, 'Next').click();
  await expect(page.getByText('Add at least one tenant.').first()).toBeVisible();
  await stepIs(page, 1);
});

test('AC-LEASE-03 the end date must be after the start date', async ({ page }) => {
  const api = await asAdmin();
  const p = await createProperty(api);
  const u = await createUnit(api, p.id);
  const a = await createTenant(api);
  await page.goto(`/units/${u.id}/leases/new`);
  await wizardTenants(page, { tenants: [t(a)] });
  await fillTerm(page, { start: '2026-11-01', end: '2026-11-01', rent: '2150' });
  await button(page, 'Next').click();
  await expect(page.getByText('Lease end date must be after the start date.').first()).toBeVisible();
});

test('AC-LEASE-04 step 3 asks about children for Residential units and about taxes for Commercial units', async ({ page }) => {
  const api = await asAdmin();
  const p = await createProperty(api);
  const res = await createUnit(api, p.id, { label: 'Res', use: 'Residential' });
  const com = await createUnit(api, p.id, { label: 'Com', use: 'Commercial' });
  const a = await createTenant(api);

  await page.goto(`/units/${res.id}/leases/new`);
  await wizardTenants(page, { tenants: [t(a)] });
  await fillTerm(page, { start: '2026-11-01', end: '2027-10-31', rent: '2150' });
  await button(page, 'Next').click();
  await stepIs(page, 3);
  await button(page, 'Next').click();
  await stepIs(page, 3);
  await expect(page.getByText('There is a problem').first()).toBeVisible();

  await page.goto(`/units/${com.id}/leases/new`);
  await wizardTenants(page, { tenants: [t(a)] });
  await fillTerm(page, { start: '2026-11-01', end: '2027-10-31', rent: '2150' });
  await button(page, 'Next').click();
  await stepIs(page, 3);
  await expect(page.getByLabel(/^Children reside in unit/).or(page.getByRole('radiogroup', { name: /^Children reside in unit/ }))).toHaveCount(0);
  await expect(page.getByLabel(/^Base tax year/).first()).toBeVisible();
  await expect(page.getByLabel(/^Tenant's share of tax increase \(%\)/).first()).toBeVisible();
});

test('AC-LEASE-05 on 2026-11-15 the lease is Active, the unit Occupied and the rent $2,150.00', async ({ page }) => {
  const api = await asAdmin();
  const { unit, lease } = await leasedUnit(api, { startDate: '2026-11-01', endDate: '2027-10-31', rent: 2150, tenants: 2 });
  await setToday('2026-11-15', page);
  await expectStatus(page, lease.id, 'Active');
  await expectCurrentRent(page, lease.id, '$2,150.00');
  await expectUnitStatus(page, unit.id, 'Occupied');
});

test('AC-LEASE-06 a 3% annual increase compounds and updates the current rent', async ({ page }) => {
  const api = await asAdmin();
  const p = await createProperty(api);
  const u = await createUnit(api, p.id);
  const a = await createTenant(api);
  await page.goto(`/units/${u.id}/leases/new`);
  await wizardTenants(page, { tenants: [t(a)] });
  await fillTerm(page, { start: '2026-01-01', end: '2028-12-31', rent: '2000', increase: 'Fixed percentage each year', percent: '3' });
  const preview = page.getByRole('table', { name: 'Rent schedule' });
  for (const amount of ['$2,000.00', '$2,060.00', '$2,121.80']) await expect(preview.getByRole('row').filter({ hasText: amount })).toHaveCount(1);
  await button(page, 'Next').click();
  await finishWizard(page);
  const id = leaseIdFromUrl(page);
  await setToday('2027-01-01', page);
  await expectCurrentRent(page, id, '$2,060.00');
  const schedule = page.getByRole('table', { name: 'Rent schedule' });
  for (const amount of ['$2,000.00', '$2,060.00', '$2,121.80']) await expect(schedule.getByRole('row').filter({ hasText: amount })).toHaveCount(1);
});

test('AC-LEASE-07 a custom schedule sets the current rent by date', async ({ page }) => {
  const api = await asAdmin();
  const { lease } = await leasedUnit(api, {
    startDate: '2026-01-01', endDate: '2028-12-31', rent: 2000,
    lease: { increaseType: 'schedule', rentSteps: [{ effectiveDate: '2027-01-01', amountCents: dollars(2100) }, { effectiveDate: '2028-01-01', amountCents: dollars(2200) }] },
  });
  await setToday('2027-06-01', page);
  await expectCurrentRent(page, lease.id, '$2,100.00');
  await setToday('2028-01-01', page);
  await expectCurrentRent(page, lease.id, '$2,200.00');
});

test('AC-LEASE-08 a schedule row outside the term is rejected', async ({ page }) => {
  const api = await asAdmin();
  const p = await createProperty(api);
  const u = await createUnit(api, p.id);
  const a = await createTenant(api);
  await page.goto(`/units/${u.id}/leases/new`);
  await wizardTenants(page, { tenants: [t(a)] });
  await fillTerm(page, { start: '2026-01-01', end: '2026-12-31', rent: '2000', increase: 'Custom schedule', steps: [{ date: '2027-06-01', rent: '2100' }] });
  await button(page, 'Next').click();
  await expect(page.getByText('Effective date must fall within the lease term.').first()).toBeVisible();
});

test('AC-LEASE-09 overlapping the current Active lease shows the clash and offers Replace current lease', async ({ page }) => {
  const api = await asAdmin();
  const { unit } = await leasedUnit(api, { startDate: '2026-01-01', endDate: '2026-12-31', rent: 2000 });
  const b = await createTenant(api);
  await wizardUntilClash(page, unit.id, t(b), '2026-11-01', '2027-10-31', '2100');
  await expect(replaceControl(page).first()).toBeVisible();
});

test('AC-LEASE-10 a day after the end without a decision the lease Needs decision and the unit stays Occupied', async ({ page }) => {
  const api = await asAdmin();
  const { unit, lease, property } = await leasedUnit(api, { startDate: '2026-01-01', endDate: '2026-12-31', rent: 2000, unitLabel: 'ND1' });
  await setToday('2027-01-01', page);
  await expectStatus(page, lease.id, 'Needs decision');
  await page.goto('/');
  const table = page.getByRole('table', { name: 'Leases needing a decision' });
  await expect(table.getByRole('row').filter({ hasText: property.name }).filter({ hasText: 'ND1' })).toHaveCount(1);
  await expectUnitStatus(page, unit.id, 'Occupied');
});

test('AC-LEASE-11 Mark month-to-month resolves Needs decision with the new rent', async ({ page }) => {
  const api = await asAdmin();
  const { lease, property } = await leasedUnit(api, { startDate: '2026-01-01', endDate: '2026-12-31', rent: 2000, unitLabel: 'MM1' });
  await setToday('2027-01-01', page);
  await goLease(page, lease.id);
  await button(page, 'Mark month-to-month').click();
  const d = dialog(page);
  await expect(d).toContainText('Mark this lease month-to-month after Dec 31, 2026?');
  await field(d, 'Month-to-month monthly rent').fill('2300');
  await button(d, 'Mark month-to-month').click();
  await expect(d).toBeHidden();
  await expectStatus(page, lease.id, 'Month-to-month');
  await expectCurrentRent(page, lease.id, '$2,300.00');
  await page.goto('/');
  const table = page.getByRole('table', { name: 'Leases needing a decision' });
  await expect(table.getByRole('row').filter({ hasText: property.name })).toHaveCount(0);
});

test('AC-LEASE-12 End lease: moving out, then Ended with the unit Vacant at its last rent', async ({ page }) => {
  const api = await asAdmin();
  const { lease, unit } = await leasedUnit(api, { startDate: '2026-01-01', endDate: '2027-06-30', rent: 2150 });
  await goLease(page, lease.id);
  await button(page, 'End lease').click();
  const d = dialog(page);
  await field(d, 'Move-out date').fill('2026-12-31');
  await choose(d, 'Reason', 'Tenant moved out');
  await button(d, 'End lease').click();
  await expect(d).toBeHidden();
  await setToday('2026-12-31', page);
  await expectStatus(page, lease.id, 'Active · moving out Dec 31, 2026');
  await setToday('2027-01-01', page);
  await expectStatus(page, lease.id, 'Ended');
  await expectUnitStatus(page, unit.id, 'Vacant');
  expect(await valueOf(page, 'Potential rent')).toContain('$2,150.00');
});

test('AC-LEASE-13 deleting a lease removes it from history and its PDFs', async ({ page }) => {
  const api = await asAdmin();
  const { lease, unit } = await leasedUnit(api, { startDate: '2026-11-01', endDate: '2027-10-31', rent: 2150 });
  await createTemplateUi(page, { name: 'Delete lease template', body: 'Tenants: {{tenant_names}}' });
  const doc = await generateDocument(api, lease.id, await templateIdByName(api, 'Delete lease template'));
  await waitForDocument(api, doc.id);
  await goLease(page, lease.id);
  await button(page, 'Delete lease').click();
  const d = dialog(page);
  await expect(d).toContainText('Delete this lease, its extensions and all generated PDFs? This cannot be undone.');
  await button(d, 'Delete lease').click();
  await page.goto(`/units/${unit.id}`);
  const history = page.getByRole('table', { name: 'Lease history' });
  await expect(history.getByRole('row').filter({ hasText: /Nov 1, 2026/ })).toHaveCount(0);
  expect((await api.get(`/api/documents/${doc.id}/download`)).status).toBe(404);
});

test('AC-LEASE-14 commercial tax reimbursement is calculated with its explanation', async ({ page }) => {
  const api = await asAdmin();
  const p = await createProperty(api, { name: 'Tax Store Building' });
  await addTax(api, p.id, 2020, dollars(40000));
  await addTax(api, p.id, 2025, dollars(52000));
  const u = await createUnit(api, p.id, { label: 'Store', use: 'Commercial' });
  const a = await createTenant(api, { tenantType: 'Business', businessName: 'Bagels Inc', contactPerson: 'Bea Gel' });
  const lease = await createLease(api, u.id, { startDate: '2026-01-01', endDate: '2030-12-31', baseRentCents: dollars(5000), tenantIds: [a.id], baseTaxYear: 2020, taxSharePercent: '25' });
  await goLease(page, lease.id);
  const other = await sectionOf(page, 'Other income');
  await expect(other).toContainText('$250.00');
  await expect(other).toContainText('25% × (2025 tax $52,000.00 − 2020 tax $40,000.00) ÷ 12');
});

test('AC-LEASE-15 a lower latest tax gives $0.00 reimbursement', async ({ page }) => {
  const api = await asAdmin();
  const p = await createProperty(api);
  await addTax(api, p.id, 2020, dollars(40000));
  await addTax(api, p.id, 2025, dollars(30000));
  const u = await createUnit(api, p.id, { label: 'Store', use: 'Commercial' });
  const a = await createTenant(api, { tenantType: 'Business', businessName: 'Lower Tax LLC', contactPerson: 'Lo Tax' });
  const lease = await createLease(api, u.id, { startDate: '2026-01-01', endDate: '2030-12-31', baseRentCents: dollars(5000), tenantIds: [a.id], baseTaxYear: 2020, taxSharePercent: '25' });
  await goLease(page, lease.id);
  expect(await valueOf(await sectionOf(page, 'Other income'), 'Tax reimbursement (monthly)')).toContain('$0.00');
});

test('AC-LEASE-16 a concurrent edit shows the version conflict alert', async ({ page, browser }) => {
  const api = await asAdmin();
  const l = await createLandlord('Concurrent Editor');
  const { lease } = await leasedUnit(api, { startDate: '2026-11-01', endDate: '2027-10-31', rent: 2150 });
  const ctx = await browser.newContext();
  const other = await ctx.newPage();
  await signIn(other, l.email, l.password);
  for (const p of [page, other]) {
    await goLease(p, lease.id);
    await button(p, 'Edit lease').click();
    await expect(field(p, 'Monthly rent').first()).toBeVisible();
  }
  await field(page, 'Monthly rent').first().fill('2200');
  await button(page, 'Save lease').click();
  await expect(page).toHaveURL(new RegExp(`/leases/${lease.id}$`));
  await field(other, 'Monthly rent').first().fill('2250');
  await button(other, 'Save lease').click();
  await expect(other.getByText('Someone else changed this record. Reload to see the latest version.')).toBeVisible();
  await expect(button(other, 'Reload')).toBeVisible();
  await ctx.close();
});

test('AC-LEASE-17 leaving the wizard with entered data asks to discard', async ({ page }) => {
  const api = await asAdmin();
  const p = await createProperty(api);
  const u = await createUnit(api, p.id);
  const a = await createTenant(api);
  await page.goto(`/units/${u.id}/leases/new`);
  await addExistingTenant(page, t(a).search, t(a).name);
  await page.getByRole('navigation').first().getByRole('link', { name: 'Dashboard', exact: true }).click();
  await expect(page.getByText('Discard this lease? Your changes will be lost.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Discard' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Keep editing' })).toBeVisible();
});

test('AC-LEASE-18 /leases hides Ended leases until Ended is checked', async ({ page }) => {
  const api = await asAdmin();
  await leasedUnit(api, { startDate: '2024-01-01', endDate: '2024-12-31', rent: 1000, property: { name: 'Ended Lease House' }, lease: { moveOutDate: '2024-12-31', endReason: 'Tenant moved out' } });
  await leasedUnit(api, { startDate: '2026-01-01', endDate: '2026-12-31', rent: 1000, property: { name: 'Active Lease House' } });
  await page.goto('/leases');
  await expect(mainOf(page).getByRole('row').filter({ hasText: 'Active Lease House' })).toHaveCount(1);
  await expect(mainOf(page).getByRole('row').filter({ hasText: 'Ended Lease House' })).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'Ended', exact: true }).check();
  await expect(mainOf(page).getByRole('row').filter({ hasText: 'Ended Lease House' })).toHaveCount(1);
});

test('AC-LEASE-19 Replace current lease ends the old lease the day before the new one starts', async ({ page }) => {
  const api = await asAdmin();
  const { unit, lease: old } = await leasedUnit(api, { startDate: '2026-11-01', endDate: '2027-10-31', rent: 2150 });
  const b = await createTenant(api);
  await setToday('2027-03-01', page);
  await wizardUntilClash(page, unit.id, t(b), '2027-04-01', '2028-03-31', '2300');
  await replaceControl(page).first().click();
  await expect(page.getByText('End the current lease on Mar 31, 2027 and start this one?')).toBeVisible();
  const d = dialog(page);
  const scope = (await d.count()) > 0 ? d : page;
  const reason = scope.getByLabel(/^Reason/).first();
  if ((await reason.evaluate((el) => el.tagName.toLowerCase())) === 'select') {
    await expect(reason.locator('option:checked')).toHaveText('Replaced by new lease');
  } else {
    await expect(reason).toContainText('Replaced by new lease');
  }
  await choose(scope, 'Reason', 'Tenant broke lease');
  if ((await d.count()) > 0) await d.getByRole('button', { name: /Replace|Confirm|Continue|Yes|End/ }).first().click();
  await finishWizard(page);
  const newId = leaseIdFromUrl(page);
  await expectStatus(page, old.id, 'Active · moving out Mar 31, 2027');
  await expectStatus(page, newId, 'Upcoming');
  await setToday('2027-04-01', page);
  await expectStatus(page, old.id, 'Ended');
  await expectStatus(page, newId, 'Active');
});

test('AC-LEASE-20 an older finished lease can be entered; an overlapping one cannot be replaced', async ({ page }) => {
  await freshApp();
  await setToday('2026-10-12', page);
  await signIn(page, ADMIN.email, ADMIN.password);
  const api = await asAdmin();
  const { unit, property } = await leasedUnit(api, { startDate: '2026-11-01', endDate: '2027-10-31', rent: 2150, property: { inNyc: false } });
  const old = await createTenant(api, { firstName: 'Olden', lastName: 'Times' });
  await page.goto(`/units/${unit.id}/leases/new`);
  await wizardTenants(page, { tenants: [t(old)] });
  await fillTerm(page, { start: '2024-11-01', end: '2025-10-31', rent: '1900' });
  await expect(page.getByLabel(/^Move-out date/)).toBeVisible();
  await expect(page.getByLabel(/^Reason/).or(page.getByRole('radiogroup', { name: /^Reason/ })).first()).toBeVisible();
  await button(page, 'Next').click();
  await finishWizard(page);
  const id = leaseIdFromUrl(page);
  await expect(mainOf(page).getByText('Ended', { exact: true }).first()).toBeVisible();
  expect((await getLease(api, id)).moveOutDate ?? null).toBeNull();
  await page.goto(`/units/${unit.id}`);
  await expect(page.getByRole('table', { name: 'Lease history' }).getByRole('row').filter({ hasText: 'Olden Times' })).toHaveCount(1);
  await page.goto('/');
  await expect(page.getByRole('table', { name: 'Leases needing a decision' }).getByRole('row').filter({ hasText: property.name })).toHaveCount(0);
  await runDailyDigest();
  expect(await countMailAfter({ body: /Olden Times/ })).toBe(0);

  const other = await createTenant(api, { firstName: 'Clash', lastName: 'Person' });
  await wizardUntilClash(page, unit.id, t(other), '2025-06-01', '2026-12-31', '2000');
  await expect(replaceControl(page)).toHaveCount(0);
});

test('AC-LEASE-21 changing the rent creates Version 2 and Version 1 is kept', async ({ page }) => {
  const api = await asAdmin();
  const { lease } = await leasedUnit(api, { startDate: '2026-11-01', endDate: '2027-10-31', rent: 2150 });
  await goLease(page, lease.id);
  await button(page, 'Edit lease').click();
  await field(page, 'Monthly rent').first().fill('2200');
  await button(page, 'Save lease').click();
  await expect(page).toHaveURL(new RegExp(`/leases/${lease.id}$`));
  const versions = page.getByRole('table', { name: 'Versions' });
  const v2 = versions.getByRole('row').filter({ hasText: 'Monthly rent: $2,150.00 → $2,200.00' });
  await expect(v2).toHaveCount(1);
  await expect(v2).toContainText('2');
  await page.goto(`/leases/${lease.id}/versions/1`);
  await expect(mainOf(page)).toContainText('$2,150.00');
  await expect(mainOf(page)).not.toContainText('$2,200.00');
});

test('AC-LEASE-22 an ended extension without a decision Needs decision at the extension rent', async ({ page }) => {
  const api = await asAdmin();
  const { lease, unit } = await leasedUnit(api, { startDate: '2026-11-01', endDate: '2027-10-31', rent: 2150 });
  await addExtension(api, lease.id, { startDate: '2027-11-01', endDate: '2028-10-31', baseRentCents: dollars(2250) });
  await setToday('2028-11-01', page);
  await expectStatus(page, lease.id, 'Needs decision');
  await expectCurrentRent(page, lease.id, '$2,250.00');
  await expectUnitStatus(page, unit.id, 'Occupied');
});

test('AC-LEASE-23 End lease accepts a move-out date before the lease start', async ({ page }) => {
  const api = await asAdmin();
  const { lease } = await leasedUnit(api, { startDate: '2026-11-01', endDate: '2027-10-31', rent: 2150 });
  // End lease isn't offered on Upcoming leases (§11.13), so the lease must have started.
  await setToday('2026-11-15', page);
  await goLease(page, lease.id);
  await button(page, 'End lease').click();
  const d = dialog(page);
  await field(d, 'Move-out date').fill('2026-10-20');
  await choose(d, 'Reason', 'Other');
  await button(d, 'End lease').click();
  await expect(d).toBeHidden();
  expect((await getLease(api, lease.id)).moveOutDate).toBe('2026-10-20');
});

test('AC-LEASE-24 a past lease shows optional move-out fields and saves as Needs decision without them', async ({ page }) => {
  const api = await asAdmin();
  const p = await createProperty(api);
  const u = await createUnit(api, p.id);
  const a = await createTenant(api);
  await page.goto(`/units/${u.id}/leases/new`);
  await wizardTenants(page, { tenants: [t(a)] });
  await fillTerm(page, { start: '2025-01-01', end: '2025-12-31', rent: '1800' });
  await expect(page.getByLabel(/^Move-out date/)).toBeVisible();
  await expect(page.getByLabel(/^Reason/).or(page.getByRole('radiogroup', { name: /^Reason/ })).first()).toBeVisible();
  await button(page, 'Next').click();
  await finishWizard(page);
  await expect(mainOf(page).getByText('Needs decision').first()).toBeVisible();
});

test('AC-LEASE-25 a later lease is the decision: no ending-soon email, Ended, and the unit is leased from the new start', async ({ page }) => {
  await freshApp();
  await signIn(page, ADMIN.email, ADMIN.password);
  await setToday('2026-10-12', page);
  const api = await asAdmin();
  const { lease: old, unit } = await leasedUnit(api, { startDate: '2026-11-01', endDate: '2027-10-31', rent: 2150, property: { inNyc: false } });
  await setToday('2027-09-01', page);
  const b = await createTenant(api);
  await createLease(api, unit.id, { startDate: '2027-12-01', endDate: '2028-11-30', baseRentCents: dollars(2300), tenantIds: [b.id] });
  for (const day of ['2027-09-01', '2027-10-01']) {
    await setToday(day);
    await runDailyDigest();
  }
  expect(await countMailAfter({ body: /lease ends/ })).toBe(0);
  await setToday('2027-11-15', page);
  await expectStatus(page, old.id, 'Ended');
  await expect(mainOf(page).getByText('Needs decision')).toHaveCount(0);
  expect((await getLease(api, old.id)).moveOutDate ?? null).toBeNull();
  await expectUnitStatus(page, unit.id, 'Vacant · leased from Dec 1, 2027');
});

// ---------------------------------------------------------------- EXT

async function openNewExtension(page: Page, leaseId: string) {
  await goLease(page, leaseId);
  await button(page, 'Add extension').click();
  await expect(page).toHaveURL(new RegExp(`/leases/${leaseId}/extensions/new`));
}

test('AC-EXT-01 the extension start date defaults to the day after the effective end', async ({ page }) => {
  const api = await asAdmin();
  const { lease } = await leasedUnit(api, { startDate: '2026-11-01', endDate: '2027-10-31', rent: 2150 });
  await openNewExtension(page, lease.id);
  await expect(field(page, 'Extension start date')).toHaveValue('2027-11-01');
});

test('AC-EXT-02 saving an extension updates the effective end, schedule and current rent', async ({ page }) => {
  const api = await asAdmin();
  const { lease } = await leasedUnit(api, { startDate: '2026-11-01', endDate: '2027-10-31', rent: 2150 });
  await openNewExtension(page, lease.id);
  await field(page, 'Extension end date').fill('2028-10-31');
  await field(page, 'Monthly rent').first().fill('2250');
  await button(page, 'Save extension').click();
  await expect(page).toHaveURL(new RegExp(`/leases/${lease.id}$`));
  expect(await valueOf(page, 'Effective end date')).toContain('Oct 31, 2028');
  await expect(page.getByRole('table', { name: 'Rent schedule' }).getByRole('row').filter({ hasText: '$2,250.00' }).first()).toBeVisible();
  await setToday('2027-11-15', page);
  await expectCurrentRent(page, lease.id, '$2,250.00');
});

test('AC-EXT-03 an extension may not start before the previous effective end + 1 day', async ({ page }) => {
  const api = await asAdmin();
  const { lease } = await leasedUnit(api, { startDate: '2026-11-01', endDate: '2027-10-31', rent: 2150 });
  await openNewExtension(page, lease.id);
  await field(page, 'Extension start date').fill('2027-10-15');
  await field(page, 'Extension end date').fill('2028-10-31');
  await field(page, 'Monthly rent').first().fill('2250');
  await button(page, 'Save extension').click();
  await expect(page.getByText('Extension must start on or after Nov 1, 2027.').first()).toBeVisible();
});

test('AC-EXT-04 extending a month-to-month lease makes it Active', async ({ page }) => {
  const api = await asAdmin();
  const { lease } = await leasedUnit(api, { startDate: '2026-01-01', endDate: '2026-12-31', rent: 2000 });
  await setToday('2027-01-05', page);
  await markMonthToMonth(api, lease.id);
  await expectStatus(page, lease.id, 'Month-to-month');
  await openNewExtension(page, lease.id);
  await field(page, 'Extension start date').fill('2027-01-01');
  await field(page, 'Extension end date').fill('2027-12-31');
  await field(page, 'Monthly rent').first().fill('2100');
  await button(page, 'Save extension').click();
  await expect(page).toHaveURL(new RegExp(`/leases/${lease.id}$`));
  await expectStatus(page, lease.id, 'Active');
});

test('AC-EXT-05 only the latest extension has Edit and Delete', async ({ page }) => {
  const api = await asAdmin();
  const { lease } = await leasedUnit(api, { startDate: '2026-11-01', endDate: '2027-10-31', rent: 2150 });
  await addExtension(api, lease.id, { startDate: '2027-11-01', endDate: '2028-10-31', baseRentCents: dollars(2250) });
  await addExtension(api, lease.id, { startDate: '2028-11-01', endDate: '2029-10-31', baseRentCents: dollars(2350) });
  await goLease(page, lease.id);
  const ext = page.getByRole('table', { name: 'Extensions' });
  const first = ext.getByRole('row').filter({ hasText: '$2,250.00' });
  const latest = ext.getByRole('row').filter({ hasText: '$2,350.00' });
  await expect(first.getByRole('button', { name: 'Edit' }).or(first.getByRole('link', { name: 'Edit' }))).toHaveCount(0);
  await expect(first.getByRole('button', { name: 'Delete' })).toHaveCount(0);
  await expect(latest.getByRole('button', { name: 'Edit' }).or(latest.getByRole('link', { name: 'Edit' }))).toHaveCount(1);
  await expect(latest.getByRole('button', { name: 'Delete' })).toHaveCount(1);
});

test('AC-EXT-06 Add extension is hidden on Ended leases and leases with a move-out date', async ({ page }) => {
  const api = await asAdmin();
  const ended = await leasedUnit(api, { startDate: '2025-01-01', endDate: '2025-12-31', rent: 1500, lease: { moveOutDate: '2025-12-31', endReason: 'Tenant moved out' } });
  const leaving = await leasedUnit(api, { startDate: '2026-01-01', endDate: '2026-12-31', rent: 1500 });
  await endLease(api, leaving.lease.id, '2026-11-30');
  for (const id of [ended.lease.id, leaving.lease.id]) {
    await goLease(page, id);
    await expect(page.getByRole('button', { name: 'Add extension' }).or(page.getByRole('link', { name: 'Add extension' }))).toHaveCount(0);
  }
});

test('AC-EXT-07 an extension may change tenants but must keep one from the master lease', async ({ page }) => {
  const api = await asAdmin();
  const { lease, tenants } = await leasedUnit(api, { startDate: '2026-01-01', endDate: '2026-12-31', rent: 2000, tenants: 2 });
  const [a, b] = tenants;
  const c = await createTenant(api, { firstName: 'Cy', lastName: 'Newcomer' });
  await openNewExtension(page, lease.id);
  await field(page, 'Extension end date').fill('2027-12-31');
  await field(page, 'Monthly rent').first().fill('2100');
  await page.getByRole('row').filter({ hasText: tenantName(b) }).getByRole('button', { name: 'Remove' }).click();
  await addExistingTenant(page, c.lastName, tenantName(c));
  await button(page, 'Save extension').click();
  await expect(page).toHaveURL(new RegExp(`/leases/${lease.id}$`));
  await setToday('2027-03-01', page);
  await goLease(page, lease.id);
  const section = await sectionOf(page, 'Tenants');
  await expect(section).toContainText(tenantName(a));
  await expect(section).toContainText(tenantName(c));
  await expect(section).not.toContainText(tenantName(b));

  await setToday('2026-10-12', page);
  const second = await leasedUnit(api, { startDate: '2026-01-01', endDate: '2026-12-31', rent: 2000 });
  const d = await createTenant(api, { firstName: 'Di', lastName: 'Replacement' });
  await openNewExtension(page, second.lease.id);
  await field(page, 'Extension end date').fill('2027-12-31');
  await field(page, 'Monthly rent').first().fill('2100');
  await addExistingTenant(page, d.lastName, tenantName(d));
  await page.getByRole('row').filter({ hasText: tenantName(second.tenants[0]) }).getByRole('button', { name: 'Remove' }).click();
  await setPrimaryIfNeeded(page, tenantName(d));
  await button(page, 'Save extension').click();
  await expect(page.getByText('At least one tenant from the original lease must stay. To change all tenants, end this lease and create a new lease.').first()).toBeVisible();
  expect((await getLease(api, second.lease.id)).extensions ?? []).toHaveLength(0);
});

async function setPrimaryIfNeeded(page: Page, name: string) {
  const radio = page.getByRole('row').filter({ hasText: name }).getByRole('radio');
  if ((await radio.count()) > 0) await radio.first().check();
}

async function openOtherTerms(page: Page) {
  const toggle = page.getByRole('button', { name: /Change other terms \(optional\)/ }).or(page.getByText('Change other terms (optional)'));
  await toggle.first().click();
}

test('AC-EXT-08 other income follows the current term', async ({ page }) => {
  const api = await asAdmin();
  const { lease } = await leasedUnit(api, { startDate: '2026-01-01', endDate: '2026-12-31', rent: 2000, lease: { parking: 'Space #4', parkingChargeCents: dollars(100) } });
  await openNewExtension(page, lease.id);
  await field(page, 'Extension end date').fill('2027-12-31');
  await field(page, 'Monthly rent').first().fill('2100');
  await openOtherTerms(page);
  // §11.14 lists this field as "Parking charge"; its §6.9 label is "Parking charge (monthly)". Accept both.
  await page.getByLabel(/^\s*Parking charge( \(monthly\))?(\s*\(required\))?\s*$/).fill('150');
  await button(page, 'Save extension').click();
  await expect(page).toHaveURL(new RegExp(`/leases/${lease.id}$`));
  await setToday('2026-10-12', page);
  await goLease(page, lease.id);
  expect(await valueOf(await sectionOf(page, 'Other income'), 'Parking charge (monthly)')).toContain('$100.00');
  await setToday('2027-03-01', page);
  await goLease(page, lease.id);
  expect(await valueOf(await sectionOf(page, 'Other income'), 'Parking charge (monthly)')).toContain('$150.00');
});

test('AC-EXT-09 unchanged terms are copied to the extension; a changed Pets prints in the extension PDF', async ({ page }) => {
  const api = await asAdmin();
  const terms = {
    securityDepositCents: dollars(2150), rentDueDay: 5, lateFeeCents: dollars(50), lateFeeGraceDays: 5, pets: 'One cat', parking: 'Space #4',
    parkingChargeCents: dollars(100), childrenReside: true, breakClause: 'None', otherTerms: 'Tenant pays electricity.',
  };
  const { lease, tenants } = await leasedUnit(api, { startDate: '2026-01-01', endDate: '2026-12-31', rent: 2000, tenants: 2, lease: terms });
  await openNewExtension(page, lease.id);
  await field(page, 'Extension end date').fill('2027-12-31');
  await field(page, 'Monthly rent').first().fill('2100');
  await button(page, 'Save extension').click();
  await expect(page).toHaveURL(new RegExp(`/leases/${lease.id}$`));
  const saved = await getLease(api, lease.id);
  const ext = saved.extensions[saved.extensions.length - 1];
  for (const [k, v] of Object.entries(terms)) expect(ext[k], k).toEqual(v);
  expect(ext.tenants.map((x: any) => x.tenantId).sort()).toEqual(tenants.map((x) => x.id).sort());

  await createTemplateUi(page, { name: 'Pets extension template', kind: 'Lease extension', body: 'Pets: {{pets}}' });
  const second = await leasedUnit(api, { startDate: '2026-01-01', endDate: '2026-12-31', rent: 2000, lease: { pets: 'One cat' } });
  await openNewExtension(page, second.lease.id);
  await field(page, 'Extension end date').fill('2027-12-31');
  await field(page, 'Monthly rent').first().fill('2100');
  await openOtherTerms(page);
  await field(page, 'Pets').fill('Two dogs');
  await button(page, 'Save extension').click();
  await expect(page).toHaveURL(new RegExp(`/leases/${second.lease.id}$`));
  const withExt = await getLease(api, second.lease.id);
  const doc = await generateDocument(api, second.lease.id, await templateIdByName(api, 'Pets extension template'), withExt.extensions[0].id);
  await waitForDocument(api, doc.id);
  expect(squash(await pdfText(await downloadDocument(api, doc.id)))).toContain('Pets: Two dogs');
});
