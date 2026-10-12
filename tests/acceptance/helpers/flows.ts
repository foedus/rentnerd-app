/** Multi-step UI flows shared by several specs (wizard, template editor, documents). */
import { expect, type Page } from '@playwright/test';
import { button, choose, dialog, esc, field, lbl, paste, text } from './ui';

export const editor = (page: Page) => page.getByLabel('Template content', { exact: true });

const htmlEscape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Pastes plain text (one paragraph per line) into the template editor. */
export async function pasteText(page: Page, body: string) {
  const html = body
    .split('\n')
    .map((l) => `<p>${htmlEscape(l)}</p>`)
    .join('');
  await paste(page, editor(page), { text: body, html });
}

export async function createTemplateUi(page: Page, o: { name: string; kind?: 'Master lease' | 'Lease extension'; body: string }) {
  await page.goto('/templates/new');
  await field(page, 'Template name').fill(o.name);
  await choose(page, 'Template type', o.kind ?? 'Master lease');
  await pasteText(page, o.body);
  await button(page, 'Save template').click();
  await expect(text(page, 'Template saved.')).toBeVisible();
}

export type WizardInput = {
  /** Display names of existing tenants to add (searched by the given text). */
  tenants?: { search: string; name: string }[];
  primary?: string;
  start?: string;
  end?: string;
  rent?: string;
  increase?: 'None' | 'Fixed percentage each year' | 'Custom schedule';
  percent?: string;
  steps?: { date: string; rent: string }[];
  children?: 'Yes' | 'No';
  baseTaxYear?: string;
  taxShare?: string;
  template?: string;
};

export const stepIs = (page: Page, n: number) => expect(page.getByText(`Step ${n} of 4`, { exact: true })).toBeVisible();

export async function addExistingTenant(page: Page, search: string, name: string) {
  const box = page.getByRole('combobox', { name: lbl('Add existing tenant') });
  await box.fill(search);
  await page.getByRole('option', { name: new RegExp(esc(name)) }).first().click();
}

export async function setPrimary(page: Page, name: string) {
  await page.getByRole('row').filter({ hasText: name }).getByRole('radio').check();
}

/**
 * Step 1. The spec doesn't say whether a single tenant becomes the primary contact
 * automatically, so unless `primary` is given the first tenant is chosen explicitly
 * when no Primary contact radio is checked yet.
 */
export async function wizardTenants(page: Page, w: WizardInput) {
  await stepIs(page, 1);
  for (const t of w.tenants ?? []) await addExistingTenant(page, t.search, t.name);
  const first = w.primary ?? w.tenants?.[0]?.name;
  if (w.primary) await setPrimary(page, w.primary);
  else if (first) {
    const radios = page.getByRole('row').filter({ hasText: first }).getByRole('radio');
    if ((await radios.count()) > 0 && !(await page.getByRole('row').getByRole('radio', { checked: true }).count())) await radios.first().check();
  }
  await button(page, 'Next').click();
}

export async function fillTerm(page: Page, w: WizardInput) {
  if (w.start) await field(page, 'Lease start date').fill(w.start);
  if (w.end) await field(page, 'Lease end date').fill(w.end);
  if (w.rent) await field(page, 'Monthly rent').first().fill(w.rent);
  if (w.increase) await page.getByRole('radio', { name: w.increase, exact: true }).check();
  if (w.percent) await field(page, 'Annual increase (%)').fill(w.percent);
  for (const [i, s] of (w.steps ?? []).entries()) {
    await button(page, 'Add row').click();
    await page.getByLabel(/^Effective date/).nth(i).fill(s.date);
    await page.getByLabel(/^Monthly rent/).nth(i + 1).fill(s.rent);
  }
}

export async function wizardTerm(page: Page, w: WizardInput) {
  await stepIs(page, 2);
  await fillTerm(page, w);
  await button(page, 'Next').click();
}

export async function wizardSpecial(page: Page, w: WizardInput) {
  await stepIs(page, 3);
  if (w.children) await choose(page, 'Children reside in unit', w.children);
  if (w.baseTaxYear) await choose(page, 'Base tax year', w.baseTaxYear);
  if (w.taxShare) await field(page, "Tenant's share of tax increase (%)").fill(w.taxShare);
  await button(page, 'Next').click();
}

/** Runs the whole New lease wizard and saves (optionally with a template and PDF). */
export async function completeWizard(page: Page, unitId: string, w: WizardInput, opts: { generate?: boolean } = {}) {
  await page.goto(`/units/${unitId}/leases/new`);
  await wizardTenants(page, w);
  await wizardTerm(page, w);
  await wizardSpecial(page, w);
  await stepIs(page, 4);
  if (w.template) await choose(page, 'Lease template', w.template);
  await button(page, opts.generate ? 'Save and generate PDF' : 'Save lease').click();
  await expect(page).toHaveURL(/\/leases\/[0-9a-f-]{36}$/);
}

export const leaseIdFromUrl = (page: Page) => page.url().match(/\/leases\/([0-9a-f-]{36})/)![1];

/** Status badge text on the lease detail page. */
export async function expectLeaseStatus(page: Page, leaseId: string, status: string | RegExp) {
  await page.goto(`/leases/${leaseId}`);
  await expect(page.getByRole('main').getByText(status).first()).toBeVisible();
}

export async function openDialog(page: Page, opener: string) {
  await button(page, opener).click();
  await expect(dialog(page)).toBeVisible();
  return dialog(page);
}
