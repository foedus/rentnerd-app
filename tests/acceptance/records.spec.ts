/** Owners (OWN), Properties (PROP), Units (UNIT) and Tenants (TEN). */
import { expect, test, type Page } from '@playwright/test';
import { asAdmin } from './helpers/api';
import { createLandlord, freshApp, runDailyDigest, setToday } from './helpers/app';
import {
  addValue, archive, createLease, createOwner, createProperty, createTenant, createUnit, dollars, leasedUnit,
  templateIdByName, generateDocument, waitForDocument, downloadDocument,
} from './helpers/builders';
import { ADMIN } from './helpers/env';
import { createTemplateUi } from './helpers/flows';
import { countMailAfter } from './helpers/mailpit';
import { pdfText, squash } from './helpers/pdf';
import {
  button, choose, confirmIfDialog, definition, dialog, expectSummaryLinksTo, field, heading1, optionsOf, setChecked, signIn, text,
} from './helpers/ui';

test.beforeAll(async () => {
  await freshApp();
});

test.beforeEach(async ({ page }) => {
  await setToday('2026-10-12', page);
  await signIn(page, ADMIN.email, ADMIN.password);
});

const mainOf = (page: Page) => page.getByRole('main');
const tab = (page: Page, name: string) => page.getByRole('tab', { name, exact: true });

async function fillOwnerForm(page: Page, name: string) {
  await field(page, 'Owner name').fill(name);
  await choose(page, 'Owner type', 'LLC');
  await field(page, 'Mailing address line 1').fill('10 Owner Way');
  await field(page, 'City').fill('Brooklyn');
  await field(page, 'State').fill('NY');
  await field(page, 'ZIP code').fill('11201');
}

async function dashboardValue(page: Page, term: string) {
  await page.goto('/');
  return ((await definition(page, term).textContent()) ?? '').trim();
}

// ---------------------------------------------------------------- Owners

test('AC-OWN-01 creating an owner shows "Owner saved." and lists it', async ({ page }) => {
  await page.goto('/owners/new');
  await fillOwnerForm(page, 'Court Street Holdings LLC');
  await button(page, 'Save owner').click();
  await expect(text(page, 'Owner saved.')).toBeVisible();
  await page.goto('/owners');
  await expect(mainOf(page).getByText('Court Street Holdings LLC')).toBeVisible();
});

test('AC-OWN-02 an empty owner form lists every required field in the error summary', async ({ page }) => {
  await page.goto('/owners/new');
  await button(page, 'Save owner').click();
  await expectSummaryLinksTo(page, ['Owner name', 'Owner type', 'Mailing address line 1', 'City', 'State', 'ZIP code']);
});

test('AC-OWN-03 an owner in use cannot be deleted or archived until it is no longer used', async ({ page }) => {
  const api = await asAdmin();
  const owner = await createOwner(api, { name: 'Busy Owner LLC' });
  const property = await createProperty(api, { name: 'Busy Owner House', ownerId: owner.id });
  await page.goto(`/owners/${owner.id}`);
  const del = button(page, 'Delete owner');
  await expect(del).toHaveAttribute('aria-disabled', 'true');
  await expect(del).toHaveAccessibleDescription('Owners used by properties or units can only be archived');

  await button(page, 'Archive owner').click();
  await expect(page.getByText('Change the owner on these properties before archiving this owner:')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Busy Owner House' })).toBeVisible();
  await page.goto('/owners');
  await expect(mainOf(page).getByText('Busy Owner LLC')).toBeVisible();

  await archive(api, `/api/properties/${property.id}`);
  await page.goto(`/owners/${owner.id}`);
  await button(page, 'Archive owner').click();
  await confirmIfDialog(page, /Archive/);
  await expect(button(page, 'Restore owner')).toBeVisible();
  await page.goto('/owners');
  await expect(mainOf(page).getByText('Busy Owner LLC')).toHaveCount(0);
  await setChecked(page, 'Show archived', true);
  await expect(mainOf(page).getByText('Busy Owner LLC')).toBeVisible();
});

test('AC-OWN-04 an archived owner is not offered in the property Owner select', async ({ page }) => {
  const api = await asAdmin();
  const owner = await createOwner(api, { name: 'Retired Owner LLC' });
  await archive(api, `/api/owners/${owner.id}`);
  await createOwner(api, { name: 'Current Owner LLC' });
  await page.goto('/properties/new');
  const options = await optionsOf(page, 'Owner');
  expect(options).toContain('Current Owner LLC');
  expect(options.join('|')).not.toContain('Retired Owner LLC');
});

// ---------------------------------------------------------------- Properties

async function fillPropertyForm(page: Page, o: { name: string; owner: string; street?: string }) {
  await field(page, 'Property name').fill(o.name);
  await field(page, 'Street address').fill(o.street ?? '412 Court St');
  await field(page, 'City').fill('Brooklyn');
  await field(page, 'State').fill('NY');
  await field(page, 'ZIP code').fill('11231');
  await choose(page, 'Owner', o.owner);
}

test('AC-PROP-01 a single-unit Commercial property gets an "Entire property" unit and Type Commercial', async ({ page }) => {
  const api = await asAdmin();
  await createOwner(api, { name: 'Store Owner LLC' });
  await page.goto('/properties/new');
  await fillPropertyForm(page, { name: 'Corner Store', owner: 'Store Owner LLC' });
  await setChecked(page, 'Single-unit property', true);
  await choose(page, 'Use', 'Commercial');
  await button(page, 'Save property').click();
  await expect(heading1(page)).toHaveText('Corner Store');
  await expect(mainOf(page)).toContainText('Commercial');
  await tab(page, 'Units').click();
  await expect(mainOf(page).getByRole('row').filter({ hasText: 'Entire property' })).toBeVisible();
});

test('AC-PROP-02 a property with a Residential and a Commercial unit is Mixed', async ({ page }) => {
  const api = await asAdmin();
  const p = await createProperty(api, { name: 'Mixed Use Building' });
  await createUnit(api, p.id, { label: '2R', use: 'Residential' });
  await createUnit(api, p.id, { label: 'Store', use: 'Commercial' });
  await page.goto('/properties');
  await expect(mainOf(page).getByRole('row').filter({ hasText: 'Mixed Use Building' })).toContainText('Mixed');
  await page.goto(`/properties/${p.id}`);
  await expect(mainOf(page)).toContainText('Mixed');
});

test('AC-PROP-03 a duplicate property name is rejected', async ({ page }) => {
  const api = await asAdmin();
  const owner = await createOwner(api, { name: 'Dup Owner LLC' });
  await createProperty(api, { name: 'Duplicate Name House', ownerId: owner.id });
  await page.goto('/properties/new');
  await fillPropertyForm(page, { name: 'Duplicate Name House', owner: 'Dup Owner LLC' });
  await button(page, 'Save property').click();
  await expect(page.getByText('A property with this name already exists.').first()).toBeVisible();
});

test('AC-PROP-04 responsible landlords default to the creator and can be several', async ({ page }) => {
  const l = await createLandlord('Second Landlord');
  const api = await asAdmin();
  await createOwner(api, { name: 'Resp Owner LLC' });
  await page.goto('/properties/new');
  await fillPropertyForm(page, { name: 'Default Resp House', owner: 'Resp Owner LLC' });
  await button(page, 'Save property').click();
  await expect(heading1(page)).toHaveText('Default Resp House');
  await expect(mainOf(page)).toContainText(ADMIN.name);
  await expect(mainOf(page)).toContainText(ADMIN.email);

  await page.goto('/properties/new');
  await fillPropertyForm(page, { name: 'Two Resp House', owner: 'Resp Owner LLC' });
  const picker = page.getByRole('group', { name: /Responsible landlords/ }).or(page.getByLabel(/Responsible landlords/)).first();
  const option = picker.getByRole('checkbox', { name: new RegExp(l.name) }).or(picker.getByRole('option', { name: new RegExp(l.name) }));
  if ((await option.count()) > 0) {
    await option.first().click();
  } else {
    await picker.click();
    await page.getByRole('option', { name: new RegExp(l.name) }).click();
    await page.keyboard.press('Escape');
  }
  await button(page, 'Save property').click();
  await expect(heading1(page)).toHaveText('Two Resp House');
  for (const s of [ADMIN.name, l.name, l.email]) await expect(mainOf(page)).toContainText(s);
});

test('AC-PROP-05 the latest market estimate is the current value; history is kept', async ({ page }) => {
  const api = await asAdmin();
  const p = await createProperty(api, { name: 'Valued House' });
  await page.goto(`/properties/${p.id}`);
  await tab(page, 'Values').click();
  for (const [date, amount] of [['2026-01-01', '900000'], ['2026-06-01', '950000']]) {
    await button(page, 'Add value').click();
    const d = dialog(page);
    await field(d, 'Date').fill(date);
    await choose(d, 'Value type', 'Market estimate');
    await field(d, 'Amount').fill(amount);
    await button(d, 'Save value').click();
    await expect(d).toBeHidden();
  }
  await expect(mainOf(page).getByText('$950,000.00').first()).toBeVisible();
  await expect(mainOf(page).getByText('Market estimate Jun 1, 2026').first()).toBeVisible();
  const values = mainOf(page).getByRole('table').filter({ hasText: 'Value type' });
  await expect(values.getByRole('row').filter({ hasText: '$900,000.00' })).toHaveCount(1);
  await expect(values.getByRole('row').filter({ hasText: '$950,000.00' })).toHaveCount(1);
});

test('AC-PROP-06 purchase price is the fallback value; assessed values do not count', async ({ page }) => {
  const api = await asAdmin();
  const p = await createProperty(api, { name: 'Purchased House', purchasePriceCents: dollars(700000), purchaseDate: '2020-05-01' });
  await page.goto(`/properties/${p.id}`);
  await expect(mainOf(page).getByText('$700,000.00').first()).toBeVisible();
  await expect(mainOf(page).getByText('Purchase price').first()).toBeVisible();
  await addValue(api, p.id, '2026-02-01', 'assessed', dollars(300000));
  await page.reload();
  await expect(mainOf(page).getByText('$700,000.00').first()).toBeVisible();
  await expect(mainOf(page).getByText(/Market estimate [A-Z][a-z]{2} \d/)).toHaveCount(0);
});

test('AC-PROP-07 a duplicate tax year is rejected', async ({ page }) => {
  const api = await asAdmin();
  const p = await createProperty(api, { name: 'Taxed House' });
  await page.goto(`/properties/${p.id}`);
  await tab(page, 'Property taxes').click();
  for (let i = 0; i < 2; i++) {
    await button(page, 'Add tax year').click();
    const d = dialog(page);
    await field(d, 'Tax year').fill('2025');
    await field(d, 'Annual property tax').fill('12000');
    await button(d, 'Save tax year').click();
    if (i === 0) await expect(d).toBeHidden();
  }
  await expect(page.getByText('This tax year already exists for this property.').first()).toBeVisible();
});

test('AC-PROP-08 archiving a property archives its units and lease and stops reminders; restore brings them back', async ({ page }) => {
  await freshApp();
  await setToday('2026-10-12', page);
  await signIn(page, ADMIN.email, ADMIN.password);
  const api = await asAdmin();
  // Lease ends in exactly 90 days, so the daily job would otherwise report it.
  const { property, lease } = await leasedUnit(api, { startDate: '2026-01-11', endDate: '2027-01-10', rent: 2150, property: { name: 'Archive Me House', inNyc: false } });
  expect(await dashboardValue(page, 'Units')).toBe('1');

  await page.goto(`/properties/${property.id}`);
  await button(page, 'Archive property').click();
  const d = dialog(page);
  await expect(d).toContainText('This property has 1 current lease(s). Archiving it also archives all its units and leases, removes them from the dashboard and stops their reminders.');
  await expect(d).toContainText('Archive Archive Me House? All its units and leases will also be archived, removed from the dashboard and their reminders stopped.');
  await button(d, 'Archive property').click();
  await expect(d).toBeHidden();

  await page.goto('/properties');
  await expect(mainOf(page).getByText('Archive Me House')).toHaveCount(0);
  expect(await dashboardValue(page, 'Units')).toBe('0');
  await page.goto(`/leases/${lease.id}`);
  await expect(mainOf(page).getByText(/· Archived/).first()).toBeVisible();
  await page.goto('/leases');
  await expect(mainOf(page).getByText('Archive Me House')).toHaveCount(0);
  await runDailyDigest();
  expect(await countMailAfter({ body: /Archive Me House/ })).toBe(0);

  await page.goto(`/properties/${property.id}`);
  await button(page, 'Restore property').click();
  await confirmIfDialog(page, /Restore/);
  await page.goto(`/leases/${lease.id}`);
  await expect(mainOf(page).getByText('Active', { exact: true }).first()).toBeVisible();
  await expect(mainOf(page).getByText(/· Archived/)).toHaveCount(0);
  await page.goto('/properties');
  await expect(mainOf(page).getByText('Archive Me House')).toBeVisible();
});

test('AC-PROP-09 delete is unavailable with lease history and works for never-leased properties', async ({ page }) => {
  const api = await asAdmin();
  const leased = await leasedUnit(api, { startDate: '2026-01-01', endDate: '2026-12-31', rent: 1000 });
  await page.goto(`/properties/${leased.property.id}`);
  const del = button(page, 'Delete property');
  await expect(del).toHaveAttribute('aria-disabled', 'true');
  await expect(del).toHaveAccessibleDescription('Properties with lease or investment history can only be archived');

  const p = await createProperty(api, { name: 'Deletable House' });
  await createUnit(api, p.id, { label: '1' });
  await page.goto(`/properties/${p.id}`);
  await button(page, 'Delete property').click();
  const d = dialog(page);
  await expect(d.getByRole('button', { name: 'Cancel' })).toBeVisible();
  await d.getByRole('button', { name: /Delete/ }).click();
  await page.goto(`/properties/${p.id}`);
  await expect(page.getByText('Page not found', { exact: true })).toBeVisible();
});

test('AC-PROP-10 property search matches name or address', async ({ page }) => {
  const api = await asAdmin();
  await createProperty(api, { name: 'Court Plaza', street: '1 Elm Street' });
  await createProperty(api, { name: 'Elm House', street: '7 Court Street' });
  await createProperty(api, { name: 'Oak House', street: '9 Oak Street' });
  await page.goto('/properties');
  await field(page, 'Search properties').fill('Court');
  const rows = mainOf(page).getByRole('row');
  await expect(rows.filter({ hasText: 'Oak House' })).toHaveCount(0);
  await expect(rows.filter({ hasText: 'Court Plaza' })).toHaveCount(1);
  await expect(rows.filter({ hasText: 'Elm House' })).toHaveCount(1);
  const dataRows = rows.filter({ has: page.getByRole('cell') });
  for (const r of await dataRows.all()) await expect(r).toContainText(/Court/);
});

test('AC-PROP-11 deleting a property removes its compliance items but not the item types', async ({ page }) => {
  const api = await asAdmin();
  const p = await createProperty(api, { name: 'Compliance Delete House', inNyc: true });
  await createUnit(api, p.id, { label: '1R', use: 'Residential' });
  await page.goto('/compliance');
  await expect(mainOf(page).getByRole('row').filter({ hasText: 'Compliance Delete House' }).first()).toBeVisible();
  await tab(page, 'Item types').click();
  const typesBefore = (await mainOf(page).getByRole('row').allTextContents()).map((s) => s.replace(/\s+/g, ' ').trim()).sort();

  await page.goto(`/properties/${p.id}`);
  await button(page, 'Delete property').click();
  await dialog(page).getByRole('button', { name: /Delete/ }).click();
  await page.goto('/compliance');
  await expect(mainOf(page).getByRole('row').filter({ hasText: 'Compliance Delete House' })).toHaveCount(0);
  await tab(page, 'Item types').click();
  const typesAfter = (await mainOf(page).getByRole('row').allTextContents()).map((s) => s.replace(/\s+/g, ' ').trim()).sort();
  expect(typesAfter).toEqual(typesBefore);
});

// ---------------------------------------------------------------- Units

test('AC-UNIT-01 a new unit shows as Vacant', async ({ page }) => {
  const api = await asAdmin();
  const p = await createProperty(api, { name: 'Unit Add House' });
  await page.goto(`/properties/${p.id}/units/new`);
  await field(page, 'Unit label').fill('2R');
  await choose(page, 'Use', 'Residential');
  await button(page, 'Save unit').click();
  await page.goto(`/properties/${p.id}`);
  await tab(page, 'Units').click();
  await expect(mainOf(page).getByRole('row').filter({ hasText: '2R' })).toContainText('Vacant');
});

test('AC-UNIT-02 a duplicate unit label in a property is rejected', async ({ page }) => {
  const api = await asAdmin();
  const p = await createProperty(api, { name: 'Unit Dup House' });
  await createUnit(api, p.id, { label: '2R' });
  await page.goto(`/properties/${p.id}/units/new`);
  await field(page, 'Unit label').fill('2R');
  await choose(page, 'Use', 'Residential');
  await button(page, 'Save unit').click();
  await expect(page.getByText('A unit with this label already exists in this property.').first()).toBeVisible();
});

test('AC-UNIT-03 archiving a unit with an Active lease removes its rent from the dashboard; restore brings it back', async ({ page }) => {
  await freshApp();
  await setToday('2026-10-12', page);
  await signIn(page, ADMIN.email, ADMIN.password);
  const api = await asAdmin();
  const { unit, lease } = await leasedUnit(api, { startDate: '2026-01-01', endDate: '2027-06-30', rent: 2150 });
  expect(await dashboardValue(page, 'Monthly rent roll')).toBe('$2,150.00');
  await page.goto(`/units/${unit.id}`);
  await button(page, 'Archive unit').click();
  const d = dialog(page);
  await expect(d).toContainText('This unit has a current lease. Archiving the unit also archives the lease, removes it from the dashboard and stops its reminders.');
  await d.getByRole('button', { name: /Archive/ }).click();
  await expect(d).toBeHidden();
  expect(await dashboardValue(page, 'Monthly rent roll')).toBe('$0.00');
  await page.goto(`/units/${unit.id}`);
  await button(page, 'Restore unit').click();
  await confirmIfDialog(page, /Restore/);
  await page.goto(`/leases/${lease.id}`);
  await expect(mainOf(page).getByText('Active', { exact: true }).first()).toBeVisible();
  expect(await dashboardValue(page, 'Monthly rent roll')).toBe('$2,150.00');
});

test('AC-UNIT-04 an owner override shows on the unit and prints as owner_name', async ({ page }) => {
  const api = await asAdmin();
  await createOwner(api, { name: 'Override Owner Trust', ownerType: 'Trust' });
  const { unit, lease } = await leasedUnit(api, { startDate: '2026-11-01', endDate: '2027-10-31', rent: 2150, property: { name: 'Override House' } });
  await page.goto(`/units/${unit.id}/edit`);
  await choose(page, 'Owner (if different from property)', 'Override Owner Trust');
  await button(page, 'Save unit').click();
  await page.goto(`/units/${unit.id}`);
  await expect(mainOf(page)).toContainText('Override Owner Trust');

  await createTemplateUi(page, { name: 'Owner name template', body: 'Landlord: {{owner_name}}' });
  const doc = await generateDocument(api, lease.id, await templateIdByName(api, 'Owner name template'));
  await waitForDocument(api, doc.id);
  expect(squash(await pdfText(await downloadDocument(api, doc.id)))).toContain('Landlord: Override Owner Trust');
});

test('AC-UNIT-05 Use is read-only on edit and the API refuses to change it', async ({ page }) => {
  const api = await asAdmin();
  const p = await createProperty(api);
  const unit = await createUnit(api, p.id, { label: '3F', use: 'Residential' });
  await page.goto(`/units/${unit.id}/edit`);
  await expect(page.getByText("Use can't be changed. To change it, archive this unit and add a new one.")).toBeVisible();
  // Read-only: no editable Use control (a disabled or read-only control also counts as read-only).
  for (const control of await page.getByRole('combobox', { name: /^Use/ }).or(page.getByRole('radio', { name: 'Commercial' })).all()) {
    const readOnly = await control.evaluate((el) => (el as HTMLInputElement).disabled || el.getAttribute('aria-disabled') === 'true' || el.getAttribute('aria-readonly') === 'true' || el.hasAttribute('readonly'));
    expect(readOnly, 'Use control must be read-only').toBe(true);
  }
  const r = await api.patch(`/api/units/${unit.id}`, { use: 'Commercial', version: unit.version });
  expect(r.status).toBe(422);
});

// ---------------------------------------------------------------- Tenants

test('AC-TEN-01 an Individual tenant needs only first and last name', async ({ page }) => {
  await page.goto('/tenants/new');
  await choose(page, 'Tenant type', 'Individual');
  await field(page, 'First name').fill('Ann');
  await field(page, 'Last name').fill('Lee');
  await button(page, 'Save tenant').click();
  await expect(text(page, 'Tenant saved.')).toBeVisible();
});

test('AC-TEN-02 a Business tenant requires a contact person', async ({ page }) => {
  await page.goto('/tenants/new');
  await choose(page, 'Tenant type', 'Business');
  await field(page, 'Business name').fill('Bagel Shop Inc');
  await button(page, 'Save tenant').click();
  await expect(page.getByText('Enter a contact person.').first()).toBeVisible();
});

test('AC-TEN-03 an invalid email is rejected', async ({ page }) => {
  await page.goto('/tenants/new');
  await choose(page, 'Tenant type', 'Individual');
  await field(page, 'First name').fill('Bad');
  await field(page, 'Last name').fill('Email');
  await field(page, 'Email').fill('not-an-email');
  await button(page, 'Save tenant').click();
  await expect(page.getByText('Enter a valid email address.').first()).toBeVisible();
});

test('AC-TEN-04 tenant detail lists every lease with a Primary contact indicator', async ({ page }) => {
  const api = await asAdmin();
  const t = await createTenant(api, { firstName: 'Multi', lastName: 'Leaser' });
  const other = await createTenant(api, { firstName: 'Other', lastName: 'Person' });
  const p = await createProperty(api, { name: 'Two Lease House' });
  const u1 = await createUnit(api, p.id, { label: 'A1' });
  const u2 = await createUnit(api, p.id, { label: 'B2' });
  await createLease(api, u1.id, { startDate: '2026-01-01', endDate: '2026-12-31', baseRentCents: dollars(1000), tenantIds: [t.id, other.id], primary: 0 });
  await createLease(api, u2.id, { startDate: '2026-01-01', endDate: '2026-12-31', baseRentCents: dollars(1000), tenantIds: [other.id, t.id], primary: 0 });
  await page.goto(`/tenants/${t.id}`);
  const leases = mainOf(page).getByRole('table').filter({ hasText: 'Primary contact' });
  const primaryRow = leases.getByRole('row').filter({ hasText: 'A1' });
  const otherRow = leases.getByRole('row').filter({ hasText: 'B2' });
  await expect(primaryRow).toHaveCount(1);
  await expect(otherRow).toHaveCount(1);
  const a = (await primaryRow.textContent()) ?? '';
  const b = (await otherRow.textContent()) ?? '';
  expect(a.replace('A1', '')).not.toEqual(b.replace('B2', ''));
  await expect(primaryRow).toContainText(/Yes|Primary|✓/);
});

test('AC-TEN-05 a tenant on a lease can be archived but not deleted, and is then not offered in the wizard', async ({ page }) => {
  const api = await asAdmin();
  const { tenants } = await leasedUnit(api, { startDate: '2026-01-01', endDate: '2026-12-31', rent: 1000 });
  const t = tenants[0];
  await page.goto(`/tenants/${t.id}`);
  await expect(button(page, 'Delete tenant')).toHaveAttribute('aria-disabled', 'true');
  await button(page, 'Archive tenant').click();
  await confirmIfDialog(page, /Archive/);
  await expect(button(page, 'Restore tenant')).toBeVisible();

  // A non-archived tenant with the same last name is offered, so the search has finished
  // when it shows; the archived one (first name Ann) is not.
  await createTenant(api, { firstName: 'Zed', lastName: t.lastName });
  const p = await createProperty(api);
  const u = await createUnit(api, p.id, { label: '9Z' });
  await page.goto(`/units/${u.id}/leases/new`);
  await page.getByRole('combobox', { name: /^Add existing tenant/ }).fill(t.lastName);
  await expect(page.getByRole('option', { name: new RegExp(`Zed ${t.lastName}`) }).first()).toBeVisible();
  await expect(page.getByRole('option', { name: new RegExp(`${t.firstName} ${t.lastName}`) })).toHaveCount(0);
});
