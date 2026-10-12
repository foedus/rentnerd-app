/** Templates (TPL) and Generated documents (DOC). */
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Download, type Page } from '@playwright/test';
import { Api, asAdmin, asUser } from './helpers/api';
import { clearClock, createLandlord, failNextPdf, freshApp, setToday } from './helpers/app';
import {
  addExtension, createProperty, createTenant, createUnit, dollars, generateDocument, getLease, leasedUnit, patchLease,
  templateIdByName, tenantName, waitForDocument, downloadDocument,
} from './helpers/builders';
import { ACCEPTANCE_DIR, ADMIN } from './helpers/env';
import { completeWizard, createTemplateUi, editor, pasteText } from './helpers/flows';
import { downloadBuffer, fetchBuffer, pdfText, sha256, squash } from './helpers/pdf';
import { button, choose, confirmIfDialog, dialog, field, optionsOf, paste, signIn, text } from './helpers/ui';

test.beforeAll(async () => {
  await freshApp();
});

test.beforeEach(async ({ page }) => {
  await setToday('2026-10-12', page);
  await signIn(page, ADMIN.email, ADMIN.password);
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let n = 0;
const uniq = (s: string) => `${s} ${++n}${Math.random().toString(36).slice(2, 5)}`;

async function newTemplate(page: Page, name: string, kind: 'Master lease' | 'Lease extension' = 'Master lease') {
  await page.goto('/templates/new');
  await field(page, 'Template name').fill(name);
  await choose(page, 'Template type', kind);
}

const placeholderChoice = (page: Page, label: string) =>
  page
    .getByRole('option', { name: label, exact: true })
    .or(page.getByRole('menuitem', { name: label, exact: true }))
    .or(page.getByRole('dialog').getByRole('button', { name: label, exact: true }));

/** Opens Preview PDF and returns the PDF that the new tab ends up showing (or downloading). */
async function readPreviewPdf(page: Page): Promise<Buffer> {
  const popupPromise = page.waitForEvent('popup');
  await button(page, 'Preview PDF').click();
  const popup = await popupPromise;
  let download: Download | undefined;
  popup.on('download', (d) => (download = d));
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (download) return await downloadBuffer(download);
    const url = popup.url();
    if (/^https?:/.test(url)) {
      const r = await page.request.get(url).catch(() => undefined);
      if (r && r.ok()) {
        const body = await r.body();
        if (body.subarray(0, 5).toString() === '%PDF-') return body;
      }
    }
    await sleep(1000);
  }
  throw new Error(`Preview tab never showed a PDF (last URL ${popup.url()})`);
}

async function openGenerateDialog(page: Page, leaseId: string) {
  await page.goto(`/leases/${leaseId}`);
  await button(page, 'Generate PDF').click();
  const d = dialog(page);
  await expect(d).toBeVisible();
  return d;
}

const documentsTable = (page: Page) => page.getByRole('table', { name: 'Documents' });

async function downloadFromRow(page: Page, rowText: string | RegExp) {
  const row = documentsTable(page).getByRole('row').filter({ hasText: rowText }).first();
  await expect(row).toContainText('Ready', { timeout: 60_000 });
  const [dl] = await Promise.all([page.waitForEvent('download'), row.getByRole('button', { name: 'Download' }).or(row.getByRole('link', { name: 'Download' })).click()]);
  return dl;
}

// ---------------------------------------------------------------- TPL

test('AC-TPL-01 a template with an inserted [Tenant names] chip saves and is visible to every landlord', async ({ page, browser }) => {
  await newTemplate(page, 'Standard residential lease');
  await editor(page).click();
  await page.keyboard.type('This lease is between the owner and ');
  await button(page, 'Insert placeholder').click();
  await placeholderChoice(page, 'Tenant names').first().click();
  await expect(editor(page)).toContainText('[Tenant names]');
  await button(page, 'Save template').click();
  await expect(text(page, 'Template saved.')).toBeVisible();

  const l = await createLandlord('Template Viewer');
  const ctx = await browser.newContext();
  const other = await ctx.newPage();
  await signIn(other, l.email, l.password);
  await other.goto('/templates');
  await expect(other.getByRole('main').getByText('Standard residential lease')).toBeVisible();
  await ctx.close();
});

test('AC-TPL-02 a pasted {{monthly_rent}} becomes a [Monthly rent] chip', async ({ page }) => {
  await newTemplate(page, uniq('Paste chip'));
  await pasteText(page, 'Rent is {{monthly_rent}} per month.');
  await expect(editor(page)).toContainText('[Monthly rent]');
  await expect(editor(page)).not.toContainText('{{monthly_rent}}');
});

test('AC-TPL-03 unrecognised and extension-only placeholders are listed and block saving', async ({ page }) => {
  const name = uniq('Unrecognised');
  await newTemplate(page, name);
  await pasteText(page, 'Bad key {{not_a_key}} here.');
  await expect(editor(page)).toContainText('{{not_a_key}}');
  await expect(page.getByText(/Unrecognised placeholders: .*\{\{not_a_key\}\}/)).toBeVisible();
  await button(page, 'Save template').click();
  await expect(page.getByText('Fix the unrecognised placeholders before saving.').first()).toBeVisible();
  const api = await asAdmin();
  expect((await api.list('/api/templates?archived=true')).map((t: any) => t.name)).not.toContain(name);

  await newTemplate(page, uniq('Extension key in master'));
  await pasteText(page, 'Starts {{extension_start_date}}.');
  await expect(page.getByText(/Unrecognised placeholders: .*\{\{extension_start_date\}\}/)).toBeVisible();
  await expect(page.getByText(/\(only available in Lease extension templates\)/)).toBeVisible();
});

test('AC-TPL-04 Insert placeholder offers extension keys only in extension templates', async ({ page }) => {
  await newTemplate(page, uniq('Master keys'), 'Master lease');
  await button(page, 'Insert placeholder').click();
  await expect(placeholderChoice(page, 'Tenant names').first()).toBeVisible();
  await expect(placeholderChoice(page, 'Extension start date')).toHaveCount(0);
  await page.keyboard.press('Escape');

  await newTemplate(page, uniq('Extension keys'), 'Lease extension');
  await button(page, 'Insert placeholder').click();
  await expect(placeholderChoice(page, 'Extension start date').first()).toBeVisible();
});

test('AC-TPL-05 Preview PDF opens a new tab with a PDF of the sample data', async ({ page }) => {
  await newTemplate(page, uniq('Preview'));
  await pasteText(page, 'Tenants: {{tenant_names}}');
  const pdf = squash(await pdfText(await readPreviewPdf(page)));
  expect(pdf).toContain('Jordan Sample');
  expect(pdf).toContain('Casey Sample');
});

test('AC-TPL-06 template names are required and unique', async ({ page }) => {
  await page.goto('/templates/new');
  await choose(page, 'Template type', 'Master lease');
  await pasteText(page, 'Some text.');
  await button(page, 'Save template').click();
  await expect(page.getByText('Enter a template name.').first()).toBeVisible();

  const name = uniq('Duplicate template');
  await createTemplateUi(page, { name, body: 'First.' });
  await newTemplate(page, name);
  await pasteText(page, 'Second.');
  await button(page, 'Save template').click();
  await expect(page.getByText('A template with this name already exists.').first()).toBeVisible();
});

test('AC-TPL-07 an archived template is not offered for new documents', async ({ page }) => {
  const api = await asAdmin();
  const name = uniq('Archived never used');
  await createTemplateUi(page, { name, body: 'Hello {{tenant_names}}' });
  const id = await templateIdByName(api, name);
  const t = await api.ok('GET', `/api/templates/${id}`);
  await api.ok('POST', `/api/templates/${id}/archive`, { version: t.version });
  const { lease, property } = await leasedUnit(api, { startDate: '2026-11-01', endDate: '2027-10-31', rent: 2150 });

  const d = await openGenerateDialog(page, lease.id);
  expect((await optionsOf(d, 'Template')).join('|')).not.toContain(name);
  await page.keyboard.press('Escape');

  const p2 = await createUnit(api, property.id, { label: 'New1' });
  const tn = await createTenant(api);
  await page.goto(`/units/${p2.id}/leases/new`);
  await page.getByRole('combobox', { name: /^Add existing tenant/ }).fill(tn.lastName);
  await page.getByRole('option', { name: new RegExp(tn.lastName) }).first().click();
  await button(page, 'Next').click();
  await field(page, 'Lease start date').fill('2026-11-01');
  await field(page, 'Lease end date').fill('2027-10-31');
  await field(page, 'Monthly rent').first().fill('2000');
  await button(page, 'Next').click();
  await choose(page, 'Children reside in unit', 'No');
  await button(page, 'Next').click();
  expect((await optionsOf(page, 'Lease template')).join('|')).not.toContain(name);
});

test('AC-TPL-08 every toolbar control is reachable by Tab and operable from the keyboard', async ({ page }) => {
  test.setTimeout(300_000);
  const names = ['Heading 1', 'Heading 2', 'Bold', 'Italic', 'Underline', 'Numbered list', 'Bulleted list', 'Align center', 'Page break', 'Insert table', 'Insert placeholder'];
  await newTemplate(page, uniq('Toolbar'));
  await pasteText(page, 'Keyboard text');
  for (const name of names) {
    const control = button(page, name);
    await expect(control).toHaveCount(1);
    await field(page, 'Template name').focus();
    let reached = false;
    for (let i = 0; i < 60 && !reached; i++) {
      await page.keyboard.press('Tab');
      reached = await control.evaluate((el) => el === document.activeElement);
    }
    expect(reached, `${name} reachable by Tab`).toBe(true);
    const before = await editor(page).innerHTML();
    const pressedBefore = await control.getAttribute('aria-pressed');
    await page.keyboard.press(name === 'Bold' || name === 'Italic' ? 'Space' : 'Enter');
    if (name === 'Insert placeholder') {
      await expect(placeholderChoice(page, 'Tenant names').first()).toBeVisible();
      await page.keyboard.press('Escape');
      continue;
    }
    await expect
      .poll(async () => (await editor(page).innerHTML()) !== before || (await control.getAttribute('aria-pressed')) !== pressedBefore, { message: `${name} operable` })
      .toBe(true);
    await page.keyboard.press('Escape');
  }
});

test('AC-TPL-09 pasting Word HTML strips unsupported content, keeps the table and joins a split key', async ({ page }) => {
  const html = fs.readFileSync(path.join(ACCEPTANCE_DIR, 'fixtures', 'word-lease.html'), 'utf8');
  await newTemplate(page, uniq('Word paste'));
  await paste(page, editor(page), { html, text: 'RESIDENTIAL LEASE AGREEMENT\nThis lease is made between the Owner and {{tenant_names}} (the "Tenant").' });
  const ed = editor(page);
  await expect(ed).toContainText('RESIDENTIAL LEASE AGREEMENT');
  await expect(ed.getByRole('img')).toHaveCount(0);
  await expect(ed.getByRole('link')).toHaveCount(0);
  await expect(ed).not.toContainText('ACME HOLDINGS CONFIDENTIAL HEADER');
  await expect(ed).toContainText('the building website');
  await expect(ed.getByRole('table')).toHaveCount(1);
  await expect(ed).toContainText('[Tenant names]');
  await expect(ed).not.toContainText('{{tenant_');
  await expect(page.getByText(/^Some content was removed: /).first()).toBeVisible();
});

test('AC-TPL-10 a used template can only be archived and stays available for its lease as "(archived)"', async ({ page }) => {
  const api = await asAdmin();
  const name = uniq('Used template');
  await createTemplateUi(page, { name, body: 'Tenants {{tenant_names}}' });
  const id = await templateIdByName(api, name);
  const used = await leasedUnit(api, { startDate: '2026-11-01', endDate: '2027-10-31', rent: 2150 });
  const other = await leasedUnit(api, { startDate: '2026-11-01', endDate: '2027-10-31', rent: 2150 });
  const doc = await generateDocument(api, used.lease.id, id);
  await waitForDocument(api, doc.id);

  await page.goto(`/templates/${id}`);
  const del = button(page, 'Delete template');
  await expect(del).toHaveAttribute('aria-disabled', 'true');
  await expect(del).toHaveAccessibleDescription('Templates used for generated PDFs can only be archived');
  await button(page, 'Archive template').click();
  await confirmIfDialog(page, /Archive/);
  await expect(button(page, 'Restore template')).toBeVisible();

  const g1 = await openGenerateDialog(page, used.lease.id);
  expect(await optionsOf(g1, 'Template')).toContain(`${name} (archived)`);
  await page.keyboard.press('Escape');
  const g2 = await openGenerateDialog(page, other.lease.id);
  expect((await optionsOf(g2, 'Template')).join('|')).not.toContain(name);
});

test('AC-TPL-11 a preview is visible only to the landlord who requested it', async ({ page }) => {
  const a = await createLandlord('Preview Owner');
  const b = await createLandlord('Preview Snooper');
  const name = uniq('Private preview');
  await createTemplateUi(page, { name, body: 'Hi {{tenant_names}}' });
  const admin = await asAdmin();
  const id = await templateIdByName(admin, name);
  const apiA = await asUser(a.email);
  const preview = await apiA.ok('POST', `/api/templates/${id}/preview`, {});
  expect((await apiA.get(`/api/previews/${preview.id}`)).status).toBe(200);
  const apiB = await asUser(b.email);
  expect((await apiB.get(`/api/previews/${preview.id}`)).status).toBe(404);
});

// ---------------------------------------------------------------- DOC

async function masterTemplate(page: Page, api: Api, body: string) {
  const name = uniq('Doc template');
  await createTemplateUi(page, { name, body });
  return { name, id: await templateIdByName(api, name) };
}

test('AC-DOC-01 Save and generate PDF shows Generating… then Ready without reloading', async ({ page }) => {
  const api = await asAdmin();
  const tpl = await masterTemplate(page, api, 'Tenants: {{tenant_names}}');
  const p = await createProperty(api);
  const u = await createUnit(api, p.id, { label: '2R' });
  const tn = await createTenant(api);
  await completeWizard(page, u.id, { tenants: [{ search: tn.lastName, name: tenantName(tn) }], start: '2026-11-01', end: '2027-10-31', rent: '2150', children: 'No', template: tpl.name }, { generate: true });
  const row = documentsTable(page).getByRole('row').filter({ hasText: tpl.name });
  await expect(row).toContainText('Generating…', { timeout: 5_000 });
  await expect(row).toContainText('Ready', { timeout: 60_000 });
});

test('AC-DOC-02 the downloaded PDF has the standard name and the lease data', async ({ page }) => {
  const api = await asAdmin();
  const tpl = await masterTemplate(page, api, 'Tenants: {{tenant_names}}\nRent: {{monthly_rent}}\nPremises: {{property_address}}');
  const { lease, property, tenants } = await leasedUnit(api, {
    startDate: '2026-11-01', endDate: '2027-10-31', rent: 2150, tenants: 2,
    property: { name: '412 Court St', street: '412 Court Street', city: 'Brooklyn', state: 'NY', zip: '11231' },
  });
  await generateDocument(api, lease.id, tpl.id);
  await page.goto(`/leases/${lease.id}`);
  const dl = await downloadFromRow(page, tpl.name);
  expect(dl.suggestedFilename()).toBe(`Lease - ${property.name} 2R - 2026-11-01.pdf`);
  const pdf = squash(await pdfText(await downloadBuffer(dl)));
  for (const t of tenants) expect(pdf).toContain(tenantName(t));
  expect(pdf).toContain('$2,150.00');
  expect(pdf).toContain('412 Court Street, Brooklyn, NY 11231');
  expect(pdf).toContain('Page 1 of');
});

test('AC-DOC-03 @slow download URLs expire after 5 minutes', async ({ page }) => {
  test.setTimeout(600_000);
  await clearClock();
  const api = await asAdmin();
  const tpl = await masterTemplate(page, api, 'Tenants: {{tenant_names}}');
  const { lease } = await leasedUnit(api, { startDate: '2026-11-01', endDate: '2027-10-31', rent: 2150 });
  const doc = await generateDocument(api, lease.id, tpl.id);
  await waitForDocument(api, doc.id);
  const requestedAt = Date.now();
  const { url, expiresAt } = await api.ok('GET', `/api/documents/${doc.id}/download`);
  expect(Math.abs(Date.parse(expiresAt) - (requestedAt + 300_000))).toBeLessThan(10_000);
  expect(new URL(url).searchParams.get('X-Amz-Expires')).toBe('300');
  expect((await fetchBuffer(url)).status).toBe(200);
  await sleep(310_000);
  expect((await fetchBuffer(url)).status).toBe(403);
});

test('AC-DOC-04 an earlier PDF is unchanged after template and lease edits', async ({ page }) => {
  const api = await asAdmin();
  const tpl = await masterTemplate(page, api, 'Original wording. Rent {{monthly_rent}}');
  const { lease } = await leasedUnit(api, { startDate: '2026-11-01', endDate: '2027-10-31', rent: 2150 });
  const doc = await generateDocument(api, lease.id, tpl.id);
  await waitForDocument(api, doc.id);
  const first = await downloadDocument(api, doc.id);

  await page.goto(`/templates/${tpl.id}`);
  await editor(page).click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(' Edited wording.');
  await button(page, 'Save template').click();
  await expect(text(page, 'Template saved.')).toBeVisible();
  await patchLease(api, lease.id, { baseRentCents: dollars(2200) });

  const again = await downloadDocument(api, doc.id);
  expect(sha256(again)).toBe(sha256(first));
  expect(await pdfText(again)).toBe(await pdfText(first));
});

test('AC-DOC-05 empty placeholders are warned about and print as blank lines', async ({ page }) => {
  const api = await asAdmin();
  const tpl = await masterTemplate(page, api, 'Pets: {{pets}}');
  const { lease } = await leasedUnit(api, { startDate: '2026-11-01', endDate: '2027-10-31', rent: 2150 });
  const d = await openGenerateDialog(page, lease.id);
  await choose(d, 'Template', tpl.name);
  await expect(d).toContainText('These items are empty and will print as blank lines:');
  await expect(d).toContainText('Pets');
  await button(d, 'Generate').click();
  const dl = await downloadFromRow(page, tpl.name);
  expect(await pdfText(await downloadBuffer(dl))).toContain('__________');
});

test('AC-DOC-06 an extension PDF has the extension name and dates and rent', async ({ page }) => {
  const api = await asAdmin();
  const name = uniq('Extension doc');
  await createTemplateUi(page, { name, kind: 'Lease extension', body: 'From {{extension_start_date}} to {{extension_end_date}} at {{extension_monthly_rent}}' });
  const tplId = await templateIdByName(api, name);
  const { lease, property } = await leasedUnit(api, { startDate: '2026-11-01', endDate: '2027-10-31', rent: 2150 });
  await addExtension(api, lease.id, { startDate: '2027-11-01', endDate: '2028-10-31', baseRentCents: dollars(2250) });
  const ext = (await getLease(api, lease.id)).extensions[0];
  await generateDocument(api, lease.id, tplId, ext.id);
  await page.goto(`/leases/${lease.id}`);
  const dl = await downloadFromRow(page, name);
  expect(dl.suggestedFilename()).toBe(`Lease extension - ${property.name} 2R - 2027-11-01.pdf`);
  const pdf = squash(await pdfText(await downloadBuffer(dl)));
  expect(pdf).toMatch(/November 1, 2027|Nov 1, 2027|11\/01\/2027|2027-11-01/);
  expect(pdf).toMatch(/October 31, 2028|Oct 31, 2028|10\/31\/2028|2028-10-31/);
  expect(pdf).toContain('$2,250.00');
});

test('AC-DOC-07 deleting a PDF removes the row and its download', async ({ page }) => {
  const api = await asAdmin();
  const tpl = await masterTemplate(page, api, 'Delete me {{tenant_names}}');
  const { lease } = await leasedUnit(api, { startDate: '2026-11-01', endDate: '2027-10-31', rent: 2150 });
  const doc = await generateDocument(api, lease.id, tpl.id);
  await waitForDocument(api, doc.id);
  await page.goto(`/leases/${lease.id}`);
  const row = documentsTable(page).getByRole('row').filter({ hasText: tpl.name });
  await row.getByRole('button', { name: 'Delete' }).click();
  const d = dialog(page);
  await expect(d).toContainText('Delete this PDF permanently? This cannot be undone.');
  await button(d, 'Delete PDF').click();
  await expect(row).toHaveCount(0);
  expect((await api.get(`/api/documents/${doc.id}/download`)).status).toBe(404);
});

test('AC-DOC-08 a signed-out download request returns 401', async ({ page }) => {
  const api = await asAdmin();
  const tpl = await masterTemplate(page, api, 'Auth {{tenant_names}}');
  const { lease } = await leasedUnit(api, { startDate: '2026-11-01', endDate: '2027-10-31', rent: 2150 });
  const doc = await generateDocument(api, lease.id, tpl.id);
  const anon = await Api.anon();
  expect((await anon.get(`/api/documents/${doc.id}/download`)).status).toBe(401);
});

test('AC-DOC-09 a failed render can be retried and uses the original snapshot', async ({ page }) => {
  test.setTimeout(400_000);
  const api = await asAdmin();
  const tpl = await masterTemplate(page, api, 'Rent {{monthly_rent}}');
  const { lease } = await leasedUnit(api, { startDate: '2026-11-01', endDate: '2027-10-31', rent: 2150 });
  await failNextPdf();
  const d = await openGenerateDialog(page, lease.id);
  await choose(d, 'Template', tpl.name);
  await button(d, 'Generate').click();
  const row = documentsTable(page).getByRole('row').filter({ hasText: tpl.name });
  await expect(row).toContainText('Failed', { timeout: 300_000 });
  await patchLease(api, lease.id, { baseRentCents: dollars(2999) });
  await row.getByRole('button', { name: 'Try again' }).click();
  await expect(row).toContainText('Generating…', { timeout: 5_000 });
  await expect(row).toContainText('Ready', { timeout: 60_000 });
  const dl = await downloadFromRow(page, tpl.name);
  const pdf = squash(await pdfText(await downloadBuffer(dl)));
  expect(pdf).toContain('$2,150.00');
  expect(pdf).not.toContain('$2,999.00');
});

test('AC-DOC-10 unsafe characters in the property name are replaced in the file name', async ({ page }) => {
  const api = await asAdmin();
  const tpl = await masterTemplate(page, api, 'Name test {{unit_label}}');
  const { lease } = await leasedUnit(api, { startDate: '2026-11-01', endDate: '2027-10-31', rent: 2150, property: { name: '12/14 Main St' } });
  await generateDocument(api, lease.id, tpl.id);
  await page.goto(`/leases/${lease.id}`);
  const dl = await downloadFromRow(page, tpl.name);
  expect(dl.suggestedFilename()).toBe('Lease - 12-14 Main St 2R - 2026-11-01.pdf');
});

test('AC-DOC-11 extension tenant keys print current, removed and added tenants', async ({ page }) => {
  const api = await asAdmin();
  const name = uniq('Tenant change doc');
  await createTemplateUi(page, { name, kind: 'Lease extension', body: 'NOW: {{tenant_names}}\nREMOVED: {{removed_tenant_names}}\nADDED: {{added_tenant_names}}' });
  const tplId = await templateIdByName(api, name);
  const { lease, tenants } = await leasedUnit(api, { startDate: '2026-01-01', endDate: '2026-12-31', rent: 2000, tenants: 2 });
  const [a, b] = tenants;
  const c = await createTenant(api, { firstName: 'Cy', lastName: 'Added' });
  await addExtension(api, lease.id, {
    startDate: '2027-01-01', endDate: '2027-12-31', baseRentCents: dollars(2100),
    tenants: [{ tenantId: a.id, isPrimary: true }, { tenantId: c.id, isPrimary: false }],
  });
  const ext = (await getLease(api, lease.id)).extensions[0];
  const doc = await generateDocument(api, lease.id, tplId, ext.id);
  await waitForDocument(api, doc.id);
  const pdf = squash(await pdfText(await downloadDocument(api, doc.id)));
  expect(pdf).toMatch(new RegExp(`NOW: ${tenantName(a)} and ${tenantName(c)}`));
  expect(pdf).toContain(`REMOVED: ${tenantName(b)}`);
  expect(pdf).toContain(`ADDED: ${tenantName(c)}`);
});
