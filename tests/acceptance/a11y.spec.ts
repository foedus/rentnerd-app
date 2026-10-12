/** Accessibility (A11Y). Routes, forms and dialogs are listed from SPEC.md §11. */
import { expect, test, type Page } from '@playwright/test';
import { asAdmin } from './helpers/api';
import { createLandlord, freshApp, setToday, type User } from './helpers/app';
import { addExtension, addInvestment, addTax, createOwner, dollars, templateIdByName } from './helpers/builders';
import { ADMIN, APP_URL, PASSWORD } from './helpers/env';
import { dashboardFixture } from './helpers/fixtures';
import { createTemplateUi } from './helpers/flows';
import { Keyboard, expectNoAxeViolations, smallTargets } from './helpers/a11y';
import { button, dialog, field, signIn } from './helpers/ui';

type World = {
  a: string; a1: string; a3: string; ownerId: string; tenantId: string; leaseId: string; extensionId: string; templateId: string; landlord: User;
};
let W: World;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(600_000);
  await freshApp();
  await setToday('2026-10-12');
  const api = await asAdmin();
  const f = await dashboardFixture(api);
  await addTax(api, f.a.id, 2025, dollars(12000));
  await addInvestment(api, { entryDate: '2026-09-01', propertyId: f.a.id, category: 'Appliance', description: 'Fridge', costCents: dollars(1250) });
  const ext = await addExtension(api, f.leases.l1.id, { startDate: '2027-06-01', endDate: '2028-05-31', baseRentCents: dollars(2100) });
  const lease = await api.ok('GET', `/api/leases/${f.leases.l1.id}`);
  const landlord = await createLandlord('Lane Landlord');
  const page = await (await browser.newContext()).newPage();
  await signIn(page, ADMIN.email, ADMIN.password);
  await createTemplateUi(page, { name: 'A11y template', body: 'Lease for {{tenant_names}}' });
  await page.context().close();
  W = {
    a: f.a.id, a1: f.units.a1.id, a3: f.units.a3.id, ownerId: f.a.ownerId ?? (await createOwner(api)).id, tenantId: f.tenants[0].id,
    leaseId: f.leases.l1.id, extensionId: ext?.id ?? lease.extensions[0].id, templateId: await templateIdByName(api, 'A11y template'), landlord,
  };
});

test.beforeEach(async ({ page }) => {
  await setToday('2026-10-12', page);
});

const publicRoutes = () => ['/login', '/forgot-password', '/reset-password?token=invalid-token', '/accept-invite?token=invalid-token'];

const privateRoutes = () => [
  '/', '/properties', '/properties/new', `/properties/${W.a}`, `/properties/${W.a}/edit`, `/properties/${W.a}/units/new`,
  `/units/${W.a1}`, `/units/${W.a1}/edit`, `/units/${W.a3}/leases/new`, `/leases/${W.leaseId}`, `/leases/${W.leaseId}/versions/1`,
  `/leases/${W.leaseId}/extensions/new`, `/extensions/${W.extensionId}/edit`, '/tenants', '/tenants/new', `/tenants/${W.tenantId}`,
  `/tenants/${W.tenantId}/edit`, '/owners', '/owners/new', `/owners/${W.ownerId}`, `/owners/${W.ownerId}/edit`, '/leases', '/compliance',
  '/templates', '/templates/new', `/templates/${W.templateId}`, '/help/templates', '/investments', '/import', '/users', '/activity', '/account',
];

/** §11 route patterns, used by the crawl. */
const ROUTE_PATTERNS = [
  /^\/$/, /^\/login$/, /^\/forgot-password$/, /^\/reset-password$/, /^\/accept-invite$/, /^\/properties$/, /^\/properties\/new$/,
  /^\/properties\/[^/]+$/, /^\/properties\/[^/]+\/edit$/, /^\/properties\/[^/]+\/units\/new$/, /^\/units\/[^/]+$/, /^\/units\/[^/]+\/edit$/,
  /^\/units\/[^/]+\/leases\/new$/, /^\/leases$/, /^\/leases\/[^/]+$/, /^\/leases\/[^/]+\/versions\/\d+$/, /^\/leases\/[^/]+\/extensions\/new$/,
  /^\/extensions\/[^/]+\/edit$/, /^\/tenants$/, /^\/tenants\/new$/, /^\/tenants\/[^/]+$/, /^\/tenants\/[^/]+\/edit$/, /^\/owners$/,
  /^\/owners\/new$/, /^\/owners\/[^/]+$/, /^\/owners\/[^/]+\/edit$/, /^\/compliance$/, /^\/templates$/, /^\/templates\/new$/,
  /^\/templates\/[^/]+$/, /^\/help\/templates$/, /^\/investments$/, /^\/import$/, /^\/users$/, /^\/activity$/, /^\/account$/,
];

async function admin(page: Page) {
  await signIn(page, ADMIN.email, ADMIN.password);
}

async function load(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.waitForLoadState('networkidle');
}

/** Forms and their submit buttons, for empty-submit checks. */
const forms = () => [
  { path: '/login', submit: 'Sign in', auth: false },
  { path: '/forgot-password', submit: 'Send reset link', auth: false },
  { path: '/owners/new', submit: 'Save owner', auth: true },
  { path: '/properties/new', submit: 'Save property', auth: true },
  { path: `/properties/${W.a}/units/new`, submit: 'Save unit', auth: true },
  { path: '/tenants/new', submit: 'Save tenant', auth: true },
  { path: `/units/${W.a3}/leases/new`, submit: 'Next', auth: true },
  { path: '/templates/new', submit: 'Save template', auth: true },
  { path: '/account', submit: 'Change password', auth: true },
];

type DialogCase = { name: string; path: string; open: (page: Page) => Promise<void>; opener: (page: Page) => ReturnType<Page['getByRole']> };

const tabThen = (tab: string, opener: (p: Page) => ReturnType<Page['getByRole']>) => async (page: Page) => {
  await page.getByRole('tab', { name: tab, exact: true }).click();
  await opener(page).click();
};
const complianceRowButton = (name: string) => (p: Page) => p.getByRole('main').getByRole('row').filter({ hasText: 'Smoke and CO Detector Check' }).getByRole('button', { name });

const dialogs = (): DialogCase[] => {
  const simple = (name: string, path: string, b: string): DialogCase => ({ name, path, open: async (p) => button(p, b).click(), opener: (p) => button(p, b) });
  return [
    { name: 'Add owner', path: '/properties/new', open: async (p) => p.getByRole('link', { name: 'Add owner' }).or(button(p, 'Add owner')).first().click(), opener: (p) => p.getByRole('link', { name: 'Add owner' }).or(button(p, 'Add owner')).first() },
    simple('Archive property', `/properties/${W.a}`, 'Archive property'),
    { name: 'Add value', path: `/properties/${W.a}`, open: tabThen('Values', (p) => button(p, 'Add value')), opener: (p) => button(p, 'Add value') },
    { name: 'Add tax year', path: `/properties/${W.a}`, open: tabThen('Property taxes', (p) => button(p, 'Add tax year')), opener: (p) => button(p, 'Add tax year') },
    { name: 'Mark done', path: `/properties/${W.a}`, open: tabThen('Compliance', complianceRowButton('Mark done')), opener: complianceRowButton('Mark done') },
    { name: 'Set due date', path: `/properties/${W.a}`, open: tabThen('Compliance', complianceRowButton('Set due date')), opener: complianceRowButton('Set due date') },
    { name: 'History', path: `/properties/${W.a}`, open: tabThen('Compliance', complianceRowButton('History')), opener: complianceRowButton('History') },
    simple('Archive unit', `/units/${W.a1}`, 'Archive unit'),
    simple('Mark month-to-month', `/leases/${W.leaseId}`, 'Mark month-to-month'),
    simple('End lease', `/leases/${W.leaseId}`, 'End lease'),
    simple('Delete lease', `/leases/${W.leaseId}`, 'Delete lease'),
    simple('Generate PDF', `/leases/${W.leaseId}`, 'Generate PDF'),
    simple('Add entry', '/investments', 'Add entry'),
    simple('Invite landlord', '/users', 'Invite landlord'),
    { name: 'Deactivate', path: '/users', open: async (p) => p.getByRole('row').filter({ hasText: W.landlord.email }).getByRole('button', { name: 'Deactivate' }).click(), opener: (p) => p.getByRole('row').filter({ hasText: W.landlord.email }).getByRole('button', { name: 'Deactivate' }) },
  ];
};

// ---------------------------------------------------------------- A11Y-01

test('AC-A11Y-01 axe finds no violations on any §11 route', async ({ page }) => {
  test.setTimeout(900_000);
  for (const path of publicRoutes()) {
    await load(page, path);
    await expectNoAxeViolations(page, path);
  }
  await admin(page);
  for (const path of privateRoutes()) {
    await load(page, path);
    await expectNoAxeViolations(page, path);
  }
  await load(page, `/properties/${W.a}`);
  for (const t of ['Units', 'Values', 'Property taxes', 'Compliance', 'Investments']) {
    await page.getByRole('tab', { name: t, exact: true }).click();
    await expectNoAxeViolations(page, `/properties/:id tab ${t}`);
  }
  await load(page, '/compliance');
  await page.getByRole('tab', { name: 'Item types', exact: true }).click();
  await expectNoAxeViolations(page, '/compliance Item types');
});

test('AC-A11Y-01 axe finds no violations on forms after an empty submit', async ({ page }) => {
  test.setTimeout(600_000);
  for (const f of forms()) {
    if (f.auth) await admin(page);
    else await page.context().clearCookies();
    await load(page, f.path);
    await button(page, f.submit).click();
    await page.waitForTimeout(500);
    await expectNoAxeViolations(page, `${f.path} after empty submit`);
  }
});

test('AC-A11Y-01 axe finds no violations with each dialog open', async ({ page }) => {
  test.setTimeout(600_000);
  await admin(page);
  for (const d of dialogs()) {
    await load(page, d.path);
    await d.open(page);
    await expect(dialog(page)).toBeVisible();
    await expectNoAxeViolations(page, `dialog ${d.name}`);
  }
});

test('AC-A11Y-01 every in-app link reachable from the Dashboard goes to a §11 route', async ({ page }) => {
  test.setTimeout(900_000);
  await admin(page);
  const origin = new URL(APP_URL).origin;
  const seen = new Set<string>();
  const queue = ['/'];
  const bad: string[] = [];
  while (queue.length && seen.size < 400) {
    const path = queue.shift()!;
    if (seen.has(path)) continue;
    seen.add(path);
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const hrefs = await page.locator('a[href]').evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href));
    for (const href of hrefs) {
      const u = new URL(href, origin);
      if (u.origin !== origin || u.pathname.startsWith('/api/')) continue;
      if (!ROUTE_PATTERNS.some((r) => r.test(u.pathname))) bad.push(`${path} -> ${u.pathname}`);
      else if (!seen.has(u.pathname) && !u.pathname.endsWith('/delete')) queue.push(u.pathname);
    }
  }
  expect(bad).toEqual([]);
});

// ---------------------------------------------------------------- A11Y-02

test('AC-A11Y-02 main tasks can be completed with the keyboard alone, with visible focus indicators', async ({ page }) => {
  test.setTimeout(900_000);
  const kb = new Keyboard(page);

  // Sign in.
  await page.goto('/login');
  await kb.type(field(page, 'Email'), W.landlord.email);
  await kb.type(field(page, 'Password'), PASSWORD);
  await kb.press(button(page, 'Sign in'));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Dashboard');

  // Owner form.
  await page.goto('/owners/new');
  await kb.type(field(page, 'Owner name'), 'Keyboard Owner LLC');
  await kb.choose(page.getByRole('radiogroup', { name: /^Owner type/ }).or(field(page, 'Owner type')).first(), 'LLC');
  await kb.type(field(page, 'Mailing address line 1'), '1 Key St');
  await kb.type(field(page, 'City'), 'Brooklyn');
  await kb.type(field(page, 'State'), 'NY');
  await kb.type(field(page, 'ZIP code'), '11201');
  await kb.press(button(page, 'Save owner'));
  await expect(page.getByText('Owner saved.')).toBeVisible();

  // Tenant form.
  await page.goto('/tenants/new');
  await kb.choose(page.getByRole('radiogroup', { name: /^Tenant type/ }).or(field(page, 'Tenant type')).first(), 'Individual');
  await kb.type(field(page, 'First name'), 'Kay');
  await kb.type(field(page, 'Last name'), 'Board');
  await kb.press(button(page, 'Save tenant'));
  await expect(page.getByText('Tenant saved.')).toBeVisible();

  // Unit form.
  await page.goto(`/properties/${W.a}/units/new`);
  await kb.type(field(page, 'Unit label'), 'KB1');
  await kb.choose(page.getByRole('radiogroup', { name: /^Use/ }).or(field(page, 'Use')).first(), 'Residential');
  await kb.press(button(page, 'Save unit'));
  await expect(page).not.toHaveURL(/units\/new$/);

  // Property tab dialog: Add value (open, fill, confirm, closed).
  await page.goto(`/properties/${W.a}`);
  await kb.press(page.getByRole('tab', { name: 'Values', exact: true }));
  await kb.press(button(page, 'Add value'));
  const valueDialog = dialog(page);
  await expect(valueDialog).toBeVisible();
  await kb.date(field(valueDialog, 'Date'), '2026-09-01');
  await kb.choose(field(valueDialog, 'Value type'), 'Market estimate');
  await kb.type(field(valueDialog, 'Amount'), '1100000');
  await kb.press(button(valueDialog, 'Save value'));
  await expect(valueDialog).toBeHidden();

  // Lease dialogs: open and close with the keyboard.
  for (const opener of ['Generate PDF', 'Mark month-to-month', 'End lease', 'Delete lease']) {
    await page.goto(`/leases/${W.leaseId}`);
    await kb.press(button(page, opener));
    await expect(dialog(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toBeHidden();
  }

  // Investments dialog.
  await page.goto('/investments');
  await kb.press(button(page, 'Add entry'));
  const inv = dialog(page);
  await kb.date(field(inv, 'Date'), '2026-09-02');
  await kb.choose(field(inv, 'Property'), 'Property A');
  await kb.choose(field(inv, 'Category'), 'Repair');
  await kb.type(field(inv, 'Description'), 'Keyboard repair');
  await kb.type(field(inv, 'Cost'), '75');
  await kb.press(button(inv, 'Save entry'));
  await expect(page.getByText('Entry saved.')).toBeVisible();

  // Compliance Mark done dialog.
  await page.goto(`/properties/${W.a}`);
  await kb.press(page.getByRole('tab', { name: 'Compliance', exact: true }));
  await kb.press(complianceRowButton('Mark done')(page));
  await expect(dialog(page)).toBeVisible();
  await kb.press(button(dialog(page), 'Save'));
  await expect(dialog(page)).toBeHidden();

  // Template editor.
  await page.goto('/templates/new');
  await kb.type(field(page, 'Template name'), 'Keyboard template');
  await kb.choose(field(page, 'Template type'), 'Master lease');
  await kb.tabTo(page.getByLabel('Template content', { exact: true }));
  await page.keyboard.type('Typed with the keyboard.');
  await kb.press(button(page, 'Save template'));
  await expect(page.getByText('Template saved.')).toBeVisible();

  // Account settings.
  await page.goto('/account');
  await kb.type(field(page, 'Name'), 'Lane Keyboard');
  await kb.press(button(page, 'Save name'));
  await expect(page.getByText('Name saved.')).toBeVisible();

  // Admin: invite a landlord.
  await page.context().clearCookies();
  await admin(page);
  await page.goto('/users');
  await kb.press(button(page, 'Invite landlord'));
  const inviteDialog = dialog(page);
  await kb.type(field(inviteDialog, 'Name'), 'Kim Keys');
  await kb.type(field(inviteDialog, 'Email'), 'kim.keys@example.com');
  await kb.press(button(inviteDialog, 'Send invitation'));
  await expect(page.getByRole('row').filter({ hasText: 'kim.keys@example.com' })).toBeVisible();

  kb.expectIndicators();
});

// ---------------------------------------------------------------- A11Y-03..10

test('AC-A11Y-03 the first Tab focuses "Skip to main content", which moves focus to <main>', async ({ page }) => {
  test.setTimeout(600_000);
  for (const [auth, paths] of [[false, publicRoutes()], [true, privateRoutes()]] as const) {
    if (auth) await admin(page);
    for (const path of paths) {
      await load(page, path);
      await page.keyboard.press('Tab');
      const focused = await page.evaluate(() => (document.activeElement?.textContent ?? '').trim());
      expect(focused, path).toBe('Skip to main content');
      await page.keyboard.press('Enter');
      expect(await page.evaluate(() => document.activeElement?.tagName), path).toBe('MAIN');
    }
  }
});

test('AC-A11Y-04 dialogs take focus, close on Escape and return focus to their opener', async ({ page }) => {
  test.setTimeout(600_000);
  await admin(page);
  for (const d of dialogs()) {
    await load(page, d.path);
    await d.open(page);
    const dlg = dialog(page);
    await expect(dlg).toBeVisible();
    expect(await dlg.evaluate((el) => el.contains(document.activeElement)), `${d.name} focus inside`).toBe(true);
    await page.keyboard.press('Escape');
    await expect(dlg).toBeHidden();
    expect(await d.opener(page).evaluate((el) => el === document.activeElement || el.contains(document.activeElement)), `${d.name} focus returned`).toBe(true);
  }
});

test('AC-A11Y-05 after a failed submit focus moves to the error summary and errors are linked with aria-describedby', async ({ page }) => {
  await admin(page);
  const cases: [string, string, string[]][] = [
    ['/owners/new', 'Save owner', ['Owner name', 'Mailing address line 1', 'City', 'State', 'ZIP code']],
    ['/tenants/new', 'Save tenant', []],
    ['/properties/new', 'Save property', ['Property name', 'Street address', 'City', 'State', 'ZIP code']],
  ];
  for (const [path, submit, labels] of cases) {
    await load(page, path);
    await button(page, submit).click();
    await expect(page.getByText('There is a problem', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => (document.activeElement?.textContent ?? '').includes('There is a problem')), `${path} summary focused`).toBe(true);
    for (const label of labels) {
      const described = await field(page, label).first().evaluate((el) =>
        (el.getAttribute('aria-describedby') ?? '')
          .split(/\s+/)
          .filter(Boolean)
          .map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
          .join(' '),
      );
      expect(described.length, `${path} ${label} aria-describedby`).toBeGreaterThan(0);
    }
  }
});

test('AC-A11Y-06 status messages appear in a polite live region', async ({ page }) => {
  await admin(page);
  await load(page, '/owners/new');
  const politeRegions = page.locator('[aria-live="polite"], [role="status"]');
  expect(await politeRegions.count()).toBeGreaterThan(0);
  await field(page, 'Owner name').fill('Live Region Owner LLC');
  await page.getByRole('radiogroup', { name: /^Owner type/ }).getByRole('radio', { name: 'LLC' }).check().catch(async () => {
    await field(page, 'Owner type').selectOption({ label: 'LLC' });
  });
  await field(page, 'Mailing address line 1').fill('1 Live St');
  await field(page, 'City').fill('Brooklyn');
  await field(page, 'State').fill('NY');
  await field(page, 'ZIP code').fill('11201');
  await button(page, 'Save owner').click();
  await expect(politeRegions.filter({ hasText: 'Owner saved.' }).first()).toBeVisible();

  const api = await asAdmin();
  await api.ok('POST', `/api/leases/${W.leaseId}/documents`, { templateId: W.templateId });
  await load(page, `/leases/${W.leaseId}`);
  await expect(politeRegions.filter({ hasText: /Generating…|Ready/ }).first()).toBeAttached({ timeout: 60_000 });
});

test('AC-A11Y-07 at 320 px no page scrolls horizontally', async ({ page }) => {
  test.setTimeout(600_000);
  await page.setViewportSize({ width: 320, height: 800 });
  await admin(page);
  for (const path of [...privateRoutes()]) {
    await load(page, path);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${path} horizontal overflow`).toBeLessThanOrEqual(0);
  }
  await page.context().clearCookies();
  for (const path of publicRoutes()) {
    await load(page, path);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), path).toBeLessThanOrEqual(0);
  }
});

test('AC-A11Y-08 interactive targets are at least 24×24 px', async ({ page }) => {
  test.setTimeout(600_000);
  for (const path of publicRoutes()) {
    await load(page, path);
    expect(await smallTargets(page), path).toEqual([]);
  }
  await admin(page);
  for (const path of privateRoutes()) {
    await load(page, path);
    expect(await smallTargets(page), path).toEqual([]);
  }
});

test('AC-A11Y-09 statuses are conveyed by text', async ({ page }) => {
  await admin(page);
  await load(page, `/leases/${W.leaseId}`);
  await expect(page.getByRole('main').getByText('Active', { exact: true }).first()).toBeVisible();
  await load(page, `/units/${W.a3}`);
  await expect(page.getByRole('main').getByText('Vacant', { exact: true }).first()).toBeVisible();
  await load(page, '/compliance');
  await expect(page.getByRole('main').getByText(/^(Overdue|Due soon|Upcoming)$/).first()).toBeVisible();
  await load(page, '/users');
  await expect(page.getByRole('main').getByText('Active', { exact: true }).first()).toBeVisible();
});

test('AC-A11Y-10 every page has a unique "{Page} – RentNerd" title and one h1', async ({ page }) => {
  test.setTimeout(600_000);
  const titles = new Map<string, string>();
  const check = async (path: string) => {
    await load(page, path);
    const title = await page.title();
    expect(title, path).toMatch(/^.+ – RentNerd$/);
    expect(await page.locator('h1').count(), `${path} h1 count`).toBe(1);
    const previous = titles.get(title);
    expect(previous, `${path} shares its title with ${previous}`).toBeUndefined();
    titles.set(title, path);
  };
  for (const path of publicRoutes()) await check(path);
  await admin(page);
  for (const path of privateRoutes()) await check(path);
});
