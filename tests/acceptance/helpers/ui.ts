/**
 * Browser helpers. Elements are found only by role, label or visible text
 * (SPEC.md §15.5). Labels may carry the "(required)" suffix (§11 conventions).
 */
import { expect, type Locator, type Page } from '@playwright/test';
import { rememberBrowserLogin } from './api';
import { APP_URL } from './env';

export const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Matches a label exactly, allowing the "(required)" marker. */
export const lbl = (label: string) => new RegExp(`^\\s*${esc(label)}(\\s*\\(required\\))?\\s*$`);

export const field = (scope: Page | Locator, label: string) => scope.getByLabel(lbl(label));
export const button = (scope: Page | Locator, name: string) => scope.getByRole('button', { name, exact: true });
export const link = (scope: Page | Locator, name: string) => scope.getByRole('link', { name, exact: true });
export const main = (page: Page) => page.getByRole('main');
export const dialog = (page: Page) => page.getByRole('dialog');
export const heading1 = (page: Page) => page.getByRole('heading', { level: 1 });
export const text = (scope: Page | Locator, t: string | RegExp) =>
  typeof t === 'string' ? scope.getByText(t, { exact: true }) : scope.getByText(t);
export const noAccess = "You don't have access to this page.";

/** Signs the page's browser context in through the API (shares the cookie jar). */
export async function signIn(page: Page, email: string, password: string) {
  const r = await page.request.post(`${APP_URL}/api/auth/sign-in/email`, {
    data: { email, password },
    headers: { Origin: APP_URL },
  });
  expect(r.status(), `sign in ${email}`).toBe(200);
  rememberBrowserLogin(page.context(), email, password);
}

/** Signs in through the /login form. */
export async function signInUi(page: Page, email: string, password: string) {
  if (!page.url().includes('/login')) await page.goto('/login');
  await field(page, 'Email').fill(email);
  await field(page, 'Password').fill(password);
  await button(page, 'Sign in').click();
}

export async function signOutUi(page: Page, userName: string) {
  await page.getByRole('button', { name: userName }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).or(button(page, 'Sign out')).or(link(page, 'Sign out')).first().click();
}

/**
 * Chooses an option for a labelled control, whatever widget implements it:
 * native <select>, a radio group, or a combobox/button opening a listbox.
 */
export async function choose(scope: Page | Locator, label: string, option: string) {
  const page = 'page' in scope ? scope.page() : scope;
  const group = scope.getByRole('radiogroup', { name: lbl(label) });
  if ((await group.count()) > 0) {
    await group.getByRole('radio', { name: option, exact: true }).check();
    return;
  }
  const control = field(scope, label).first();
  const tag = await control.evaluate((el) => el.tagName.toLowerCase());
  if (tag === 'select') {
    await control.selectOption({ label: option });
    return;
  }
  await control.click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

/** Option labels offered by a labelled select/combobox. */
export async function optionsOf(scope: Page | Locator, label: string): Promise<string[]> {
  const page = 'page' in scope ? scope.page() : scope;
  const control = field(scope, label).first();
  const tag = await control.evaluate((el) => el.tagName.toLowerCase());
  if (tag === 'select') {
    return (await control.locator('option').allTextContents()).map((s) => s.trim());
  }
  await control.click();
  const listbox = page.getByRole('listbox');
  await expect(listbox.first()).toBeVisible();
  const names = (await listbox.first().getByRole('option').allTextContents()).map((s) => s.trim());
  await page.keyboard.press('Escape');
  return names;
}

/** Sets a checkbox or switch with the given label. */
export async function setChecked(scope: Page | Locator, label: string, value: boolean) {
  const box = scope.getByRole('checkbox', { name: lbl(label) }).or(scope.getByRole('switch', { name: lbl(label) })).first();
  await box.setChecked(value);
}

/** The Playwright clipboard can't carry HTML in every browser, so paste is a synthetic ClipboardEvent on the focused editor. */
export async function paste(page: Page, editor: Locator, data: { text: string; html?: string }) {
  await editor.click();
  await page.evaluate((d) => {
    const target = (document.activeElement as HTMLElement) ?? document.body;
    const dt = new DataTransfer();
    if (d.html) dt.setData('text/html', d.html);
    dt.setData('text/plain', d.text);
    target.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, data);
}

export const table = (scope: Page | Locator, name: string) => scope.getByRole('table', { name });

export function rowOf(t: Locator, contains: string | RegExp) {
  return t.getByRole('row').filter({ hasText: contains });
}

/** Text of the cell in `column` (by header text) of the first row containing `rowText`. */
export async function cell(t: Locator, rowText: string | RegExp, column: string): Promise<string> {
  const headers = (await t.getByRole('columnheader').allTextContents()).map((s) => s.trim());
  const idx = headers.findIndex((h) => h === column || h.startsWith(column));
  if (idx < 0) throw new Error(`No column "${column}" in [${headers.join(' | ')}]`);
  const r = rowOf(t, rowText).first();
  await expect(r).toBeVisible();
  const cells = r.locator(':scope > th, :scope > td, :scope > [role=cell], :scope > [role=gridcell], :scope > [role=rowheader]');
  return ((await cells.nth(idx).textContent()) ?? '').trim();
}

/** Value of a term in a definition list (e.g. Dashboard "Portfolio summary"). */
export function definition(scope: Page | Locator, term: string): Locator {
  return scope
    .getByRole('term')
    .filter({ hasText: new RegExp(`^\\s*${esc(term)}\\s*$`) })
    .first()
    .locator('xpath=following-sibling::*[1]');
}

/** Opens a confirmation dialog (if the app shows one) and clicks its confirm button. */
export async function confirmIfDialog(page: Page, confirmName: string | RegExp) {
  const d = dialog(page);
  try {
    await d.waitFor({ state: 'visible', timeout: 3_000 });
  } catch {
    return;
  }
  await d.getByRole('button', { name: confirmName }).click();
  await expect(d).toBeHidden();
}

/** Visits a URL with a fresh client-side navigation. */
export async function visit(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState('networkidle');
}

/**
 * Clicks every in-page link of the error summary and asserts that each listed
 * field received focus through one of them (SPEC.md §11 "error summary ... links to each field").
 */
export async function expectSummaryLinksTo(page: Page, labels: string[]) {
  await expect(page.getByText('There is a problem', { exact: true })).toBeVisible();
  const links = page.locator('a[href^="#"]');
  const n = await links.count();
  const reached = new Set<string>();
  for (let i = 0; i < n; i++) {
    const l = links.nth(i);
    if (!(await l.isVisible())) continue;
    await l.click();
    for (const label of labels) {
      const candidates = page.getByLabel(lbl(label)).or(page.getByRole('radiogroup', { name: lbl(label) }));
      const count = await candidates.count();
      for (let j = 0; j < count; j++) {
        const hit = await candidates.nth(j).evaluate((el) => el === document.activeElement || el.contains(document.activeElement));
        if (hit) reached.add(label);
      }
    }
  }
  expect([...reached].sort()).toEqual([...labels].sort());
}

export async function expectNoAccess(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByText(noAccess, { exact: true })).toBeVisible();
}

/**
 * Text shown next to a label such as "Current monthly rent": the following
 * <dd>/definition for a term, the row for a <th>, otherwise the parent element.
 */
export async function valueOf(scope: Page | Locator, label: string): Promise<string> {
  const el = scope.getByText(label, { exact: true }).first();
  await expect(el).toBeVisible();
  return await el.evaluate((node) => {
    const start = node as HTMLElement;
    const term = start.closest('dt,[role="term"]');
    if (term) return term.nextElementSibling?.textContent?.trim() ?? '';
    const th = start.closest('th');
    if (th) return th.closest('tr')?.textContent?.trim() ?? '';
    const holder = start.closest('label') ?? start;
    return holder.parentElement?.textContent?.trim() ?? '';
  });
}

/** The section headed by `heading` (closest section/region/article, else the heading's parent). */
export async function sectionOf(page: Page, heading: string): Promise<Locator> {
  const h = page.getByRole('main').getByRole('heading', { name: heading, exact: true }).first();
  await expect(h).toBeVisible();
  const s = h.locator('xpath=ancestor::*[self::section or @role="region" or self::article][1]');
  if ((await s.count()) > 0) return s;
  return h.locator('xpath=..');
}
