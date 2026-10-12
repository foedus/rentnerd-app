/** Audit (AUD). */
import { expect, test } from '@playwright/test';
import { asAdmin, asUser, trySignIn } from './helpers/api';
import { createLandlord, freshApp, setToday } from './helpers/app';
import { generateDocument, leasedUnit, patchLease, templateIdByName, waitForDocument, dollars } from './helpers/builders';
import { ADMIN } from './helpers/env';
import { createTemplateUi } from './helpers/flows';
import { linkContaining, tokenFrom, waitForMail } from './helpers/mailpit';
import { button, choose, field, signIn, signInUi } from './helpers/ui';
import { buildImport, downloadTemplate, validRows } from './helpers/xlsx';

test.beforeEach(async ({ page }) => {
  await freshApp();
  await setToday('2026-10-12', page);
});

async function auditRows(): Promise<any[]> {
  return await (await asAdmin()).list('/api/audit-log');
}

test('AC-AUD-01 a landlord\'s rent change appears in the Activity log with field changes', async ({ page }) => {
  const l = await createLandlord('Audit Landlord');
  const admin = await asAdmin();
  const { lease, property } = await leasedUnit(admin, { startDate: '2026-11-01', endDate: '2027-10-31', rent: 2150, unitLabel: '2R', property: { name: 'Audit House' } });
  await patchLease(await asUser(l.email), lease.id, { baseRentCents: dollars(2200) });

  await signIn(page, ADMIN.email, ADMIN.password);
  await page.goto('/activity');
  const row = page.getByRole('main').getByRole('row').filter({ hasText: l.name }).filter({ hasText: 'Updated' }).filter({ hasText: `Lease – ${property.name} Unit 2R` });
  await expect(row).toHaveCount(1);
  await row.getByRole('button', { name: 'Show changes' }).click();
  const area = page.getByRole('main');
  await expect(area.getByText(/Monthly rent/).first()).toBeVisible();
  await expect(area.getByText(/\$2,150\.00/).first()).toBeVisible();
  await expect(area.getByText(/\$2,200\.00/).first()).toBeVisible();
});

test('AC-AUD-02 sign-ins, invitations, deactivation, PDFs and imports are logged', async ({ page }) => {
  const l = await createLandlord('Logged Landlord');
  expect(await trySignIn(l.email, l.password)).toBe(200);
  expect(await trySignIn(l.email, 'Wrong-password-001')).not.toBe(200);
  await signIn(page, ADMIN.email, ADMIN.password);
  const admin = await asAdmin();
  await createTemplateUi(page, { name: 'Audit template', body: 'Hi {{tenant_names}}' });
  const { lease } = await leasedUnit(admin, { startDate: '2026-11-01', endDate: '2027-10-31', rent: 2150 });
  const doc = await generateDocument(admin, lease.id, await templateIdByName(admin, 'Audit template'));
  await waitForDocument(admin, doc.id);
  await admin.ok('GET', `/api/documents/${doc.id}/download`);
  await admin.ok('DELETE', `/api/documents/${doc.id}`);
  const { buffer } = await buildImport(await downloadTemplate(admin), validRows('audit'));
  await page.goto('/import');
  await page.getByLabel(/^Spreadsheet file/).setInputFiles({ name: 'audit.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer });
  await button(page, 'Check file').click();
  await button(page, 'Import').click();
  await expect(page.getByText('Import complete.')).toBeVisible();
  await admin.ok('POST', `/api/users/${l.id}/deactivate`, {});

  const actions = new Set((await auditRows()).map((r) => r.action));
  for (const a of ['sign_in', 'sign_in_failed', 'invite', 'deactivate', 'pdf_generate', 'pdf_download', 'pdf_delete', 'import']) {
    expect(actions, a).toContain(a);
  }
});

test('AC-AUD-03 the Activity log filters by user', async ({ page }) => {
  const l = await createLandlord('Filter Me');
  const api = await asUser(l.email);
  await leasedUnit(api, { startDate: '2026-11-01', endDate: '2027-10-31', rent: 1000 });
  await leasedUnit(await asAdmin(), { startDate: '2026-11-01', endDate: '2027-10-31', rent: 1000 });
  await signIn(page, ADMIN.email, ADMIN.password);
  await page.goto('/activity');
  await choose(page, 'User', l.name).catch(async () => choose(page, 'User', `${l.name} (${l.email})`));
  const rows = page.getByRole('main').getByRole('table').first().getByRole('row').filter({ has: page.getByRole('cell') });
  await expect(rows.first()).toBeVisible();
  for (const r of await rows.all()) await expect(r).toContainText(l.name);
  await expect(page.getByRole('main').getByRole('table').first().getByRole('row').filter({ hasText: ADMIN.name })).toHaveCount(0);
});

test('AC-AUD-04 audit rows cannot be edited or deleted', async ({ page }) => {
  await createLandlord('Someone');
  await signIn(page, ADMIN.email, ADMIN.password);
  await page.goto('/activity');
  const table = page.getByRole('main').getByRole('table').first();
  await expect(table.getByRole('row').nth(1)).toBeVisible();
  await expect(table.getByRole('button', { name: /^(Edit|Delete)/ })).toHaveCount(0);
  const [row] = await auditRows();
  const admin = await asAdmin();
  expect([404, 405]).toContain((await admin.del(`/api/audit-log/${row.id}`)).status);
});

test('AC-AUD-05 no audit row contains passwords, hashes, tokens or session IDs', async ({ page, browser }) => {
  const secrets: string[] = [];
  // Invitation (token captured from the email).
  const l = await createLandlord('Secret Keeper');
  const [invite] = await waitForMail({ to: l.email, subject: "You're invited to RentNerd" });
  secrets.push(tokenFrom(linkContaining(invite, '/accept-invite')), l.password);
  // Password change in Account settings.
  await signIn(page, l.email, l.password);
  const changed = 'Changed-password-0007';
  await page.goto('/account');
  await field(page, 'Current password').fill(l.password);
  await field(page, 'New password').fill(changed);
  await field(page, 'Confirm new password').fill(changed);
  await button(page, 'Change password').click();
  await expect(page.getByText('Password changed.')).toBeVisible();
  secrets.push(changed);
  // Password reset.
  const ctx = await browser.newContext();
  const anon = await ctx.newPage();
  await anon.goto('/forgot-password');
  await field(anon, 'Email').fill(l.email);
  await button(anon, 'Send reset link').click();
  const [reset] = await waitForMail({ to: l.email, subject: 'Reset your RentNerd password' });
  const resetLink = linkContaining(reset, '/reset-password');
  secrets.push(tokenFrom(resetLink));
  const viaReset = 'Reset-password-00008';
  await anon.goto(new URL(resetLink).pathname + new URL(resetLink).search);
  await field(anon, 'New password').fill(viaReset);
  await field(anon, 'Confirm new password').fill(viaReset);
  await button(anon, 'Reset password').click();
  await expect(anon).toHaveURL(/\/login/);
  secrets.push(viaReset);
  await signInUi(anon, l.email, viaReset);
  for (const c of [...(await ctx.cookies()), ...(await page.context().cookies())]) if (c.value.length >= 16) secrets.push(c.value, decodeURIComponent(c.value).split('.')[0]);
  await ctx.close();

  for (const row of await auditRows()) {
    const changes = JSON.stringify(row.changes ?? {});
    for (const s of secrets) expect(changes.includes(s), `audit row ${row.action} leaks a secret`).toBe(false);
    expect(changes).not.toMatch(/"(password|passwordHash|hash|token|tokenHash|sessionId|session_token)"\s*:/i);
    expect(changes).not.toMatch(/[0-9a-f]{32}:[0-9a-f]{64,}/i);
  }
});
