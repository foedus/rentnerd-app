import { expect, test } from '@playwright/test';
import { Api, asAdmin, asSmoke, trySignIn } from './helpers/api';
import { acceptInvitation, freshApp, runBackup, setNow, setToday, createLandlord } from './helpers/app';
import { createLease, createOwner, createProperty, createTenant, createUnit, dollars } from './helpers/builders';
import { psql, rowCounts } from './helpers/db';
import { ADMIN, SMOKE, TEST_ENV } from './helpers/env';
import { countMailAfter, linkContaining, textOf, tokenFrom, waitForMail } from './helpers/mailpit';
import { restartApp, runToExit, startApp, stopApp, startProcess, waitForHealthy, stopProcess } from './helpers/processes';
import { listKeys } from './helpers/storage';
import { heading1, noAccess, signIn, signInUi, signOutUi, table } from './helpers/ui';

test.describe.configure({ mode: 'serial' });

// Tests reset the app themselves when they need data or a fresh install;
// AC-PLAT-01, -05 and -07 only need the processes the global setup started.

test('AC-PLAT-01 GET /api/health returns 200 {"status":"ok"} when the database is up', async () => {
  const res = await fetch(`${TEST_ENV.APP_URL}/api/health`);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ status: 'ok' });
});

test('AC-PLAT-02 the smoke user created at startup can sign in and sees the Dashboard without a verification prompt', async ({ page }) => {
  await freshApp();
  await signInUi(page, SMOKE.email, SMOKE.password);
  await expect(page).toHaveURL(/\/$/);
  await expect(heading1(page)).toHaveText('Dashboard');
  await expect(page.getByText(/verify your email|verification/i)).toHaveCount(0);
});

test('AC-PLAT-03 the smoke user is read-only', async ({ page }) => {
  await freshApp();
  await signIn(page, SMOKE.email, SMOKE.password);
  await page.goto('/');
  const nav = page.getByRole('navigation').first();
  await expect(nav.getByRole('link', { name: 'Dashboard', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Users', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Activity log', exact: true })).toHaveCount(0);
  for (const path of ['/users', '/properties/new']) {
    await page.goto(path);
    await expect(page.getByText(noAccess, { exact: true })).toBeVisible();
  }
  await page.goto('/properties');
  await expect(heading1(page)).toHaveText('Properties');
  await expect(page.getByRole('button', { name: 'Add property' }).or(page.getByRole('link', { name: 'Add property' }))).toHaveCount(0);

  const admin = await asAdmin();
  const owner = await createOwner(admin);
  const smoke = await asSmoke();
  const r = await smoke.post('/api/properties', {
    name: 'Smoke Should Fail', street: '1 A St', city: 'Brooklyn', state: 'NY', zip: '11201', inNyc: true, ownerId: owner.id,
    responsibleUserIds: [(await admin.me()).id],
  });
  expect(r.status).toBe(403);
  expect(r.body.error.code).toBe('FORBIDDEN');
});

test('AC-PLAT-04 restarting does not duplicate the smoke user, and a changed SMOKE_USER_PASSWORD takes effect', async ({ page }) => {
  await freshApp();
  try {
    await restartApp();
    await signIn(page, ADMIN.email, ADMIN.password);
    await page.goto('/users');
    await expect(table(page, 'Users').or(page.getByRole('table')).first().getByRole('row').filter({ hasText: SMOKE.email })).toHaveCount(1);
    expect(await trySignIn(SMOKE.email, SMOKE.password)).toBe(200);

    const newPassword = 'smoke-password-changed-0002';
    await restartApp({ SMOKE_USER_PASSWORD: newPassword });
    expect(await trySignIn(SMOKE.email, newPassword)).toBe(200);
    expect(await trySignIn(SMOKE.email, SMOKE.password)).not.toBe(200);
  } finally {
    await restartApp();
  }
});

test('AC-PLAT-05 with ENABLE_TEST_ROUTES unset, POST /api/test/clock returns 404', async () => {
  try {
    await stopProcess('web');
    await startProcess('web', { ENABLE_TEST_ROUTES: undefined });
    await waitForHealthy();
    const api = await Api.anon();
    const r = await api.post('/api/test/clock', { now: '2026-10-12T16:00:00.000Z' });
    expect(r.status).toBe(404);
  } finally {
    await restartApp();
  }
});

test('AC-PLAT-06 deep link to /properties renders the Properties page (SPA fallback)', async ({ page }) => {
  await freshApp();
  await signIn(page, ADMIN.email, ADMIN.password);
  const res = await page.goto('/properties');
  expect(res?.status()).toBe(200);
  await expect(heading1(page)).toHaveText('Properties');
});

test('AC-PLAT-07 web and worker refuse to start with ENABLE_TEST_ROUTES=true in an unsafe environment', async () => {
  test.setTimeout(600_000);
  const nonTestDb = TEST_ENV.DATABASE_URL.replace(/rentnerd_test$/, 'rentnerd');
  const unsafe: Record<string, string>[] = [
    { NODE_ENV: 'production' },
    { FLY_APP_NAME: 'rentnerd-app' },
    { DATABASE_URL: nonTestDb },
  ];
  try {
    await stopApp();
    for (const script of ['server.js', 'worker.js']) {
      for (const env of unsafe) {
        const r = await runToExit(script, [], { ENABLE_TEST_ROUTES: 'true', ...env }, 30_000);
        expect(r.timedOut, `${script} ${JSON.stringify(env)} kept running`).toBe(false);
        expect(r.code, `${script} ${JSON.stringify(env)} exit code`).not.toBe(0);
        expect(r.output, `${script} ${JSON.stringify(env)} explains why`).toMatch(/ENABLE_TEST_ROUTES|test routes?/i);
      }
    }
  } finally {
    await startApp();
  }
});

test('AC-PLAT-08 the Admin is created from ADMIN_EMAIL with one invitation; restarts and the CLI behave', async ({ page }) => {
  // Fresh install without accepting the startup invitation.
  await freshApp({ bootstrap: false });
  const invites = await waitForMail({ to: ADMIN.email, subject: "You're invited to RentNerd" });
  expect(invites).toHaveLength(1);
  expect(textOf(invites[0])).toContain("You've been set up as the administrator of RentNerd, the shared tool for managing your properties.");
  const firstLink = linkContaining(invites[0], '/accept-invite');
  // Status "Invited" (D-07): the admin has no password yet, so sign-in fails.
  // (Only the Admin can open the Users list, so the "Invited" badge itself is
  // not observable by anyone before acceptance; see COVERAGE.md.)
  expect(await trySignIn(ADMIN.email, ADMIN.password)).not.toBe(200);

  // Restart: no second email. Restart with another ADMIN_EMAIL: no second admin, no email to it.
  await restartApp();
  expect(await countMailAfter({ to: ADMIN.email, subject: "You're invited to RentNerd" })).toBe(1);
  await restartApp({ ADMIN_EMAIL: 'other-admin@example.test' });
  expect(await countMailAfter({ to: 'other-admin@example.test' })).toBe(0);
  await restartApp();

  // After the invitation expires, the CLI sends a new working link.
  await setNow(new Date(Date.now() + 8 * 24 * 3600 * 1000).toISOString());
  await page.goto(new URL(firstLink).pathname + new URL(firstLink).search);
  await expect(page.getByText('This invitation is invalid or has expired. Ask the administrator to send a new one.')).toBeVisible();
  const cli = await runToExit('cli.js', ['resend-admin-invite']);
  expect(cli.code, cli.output).toBe(0);
  const after = await waitForMail({ to: ADMIN.email, subject: "You're invited to RentNerd" }, { count: 2 });
  const newLink = linkContaining(after[after.length - 1], '/accept-invite');
  expect(newLink).not.toBe(firstLink);
  await page.goto(new URL(newLink).pathname + new URL(newLink).search);
  await expect(page.getByText(`You're joining RentNerd as ${ADMIN.email}.`)).toBeVisible();
  await acceptInvitation(tokenFrom(newLink), ADMIN.name, ADMIN.password);

  // Exactly one admin, with the ADMIN_EMAIL address and role Admin; the other address has no account.
  await signIn(page, ADMIN.email, ADMIN.password);
  await page.goto('/users');
  const users = page.getByRole('table').first();
  await expect(users.getByRole('row').filter({ hasText: ADMIN.email })).toHaveCount(1);
  await expect(users.getByRole('row').filter({ hasText: ADMIN.email })).toContainText('Admin');
  await expect(users.getByRole('row').filter({ hasText: 'other-admin@example.test' })).toHaveCount(0);
  await expect(users.getByRole('row').filter({ hasText: /^(?!.*Smoke).*Admin/ })).toHaveCount(1);
});

test('AC-PLAT-09 smoke user sign-in and sign-out create no Activity log rows', async ({ page }) => {
  await freshApp();
  const admin = await asAdmin();
  const smokeId = (await admin.list('/api/users')).find((u: any) => u.email === SMOKE.email).id;
  await signInUi(page, SMOKE.email, SMOKE.password);
  await expect(heading1(page)).toHaveText('Dashboard');
  const me = await (await asSmoke()).me();
  await signOutUi(page, me.name);
  await expect(page).toHaveURL(/\/login/);
  const rows = await admin.list('/api/audit-log');
  const serialized = JSON.stringify(rows);
  expect(serialized).not.toContain(smokeId);
  expect(serialized).not.toContain(SMOKE.email);
  await signIn(page, ADMIN.email, ADMIN.password);
  await page.goto('/activity');
  await expect(page.getByRole('main').getByText(SMOKE.email)).toHaveCount(0);
});

test('AC-PLAT-10 backup job writes to backups/ and restore-backup reproduces every table', async () => {
  await freshApp();
  test.setTimeout(600_000);
  await setToday('2026-10-12');
  const admin = await asAdmin();
  const property = await createProperty(admin);
  const unit = await createUnit(admin, property.id, { label: '1A' });
  const tenant = await createTenant(admin);
  await createLease(admin, unit.id, { startDate: '2026-01-01', endDate: '2026-12-31', baseRentCents: dollars(1800), tenantIds: [tenant.id] });
  await createLandlord('Restore Drill');

  const before = new Set(await listKeys('backups/'));
  // Let queued emails finish so the source is quiet.
  await new Promise((r) => setTimeout(r, 5000));
  const source = rowCounts('rentnerd_test');
  await runBackup();
  await expect.poll(async () => (await listKeys('backups/')).filter((k) => !before.has(k)).length, { timeout: 120_000 }).toBeGreaterThan(0);

  psql('postgres', 'drop database if exists rentnerd_restore_test');
  psql('postgres', 'create database rentnerd_restore_test');
  const target = TEST_ENV.DATABASE_URL.replace(/rentnerd_test$/, 'rentnerd_restore_test');
  const r = await runToExit('cli.js', ['restore-backup', '--latest', '--target-url', target], {}, 300_000);
  expect(r.code, r.output).toBe(0);
  const restored = rowCounts('rentnerd_restore_test');
  expect(Object.keys(source).length).toBeGreaterThan(5);
  for (const [tableName, count] of Object.entries(source)) {
    expect(restored[tableName], `rows in ${tableName}`).toBe(count);
  }
});

test('AC-PLAT-11 @slow with the scale fixture loaded, dashboard < 1 s and list endpoints p95 < 500 ms', async () => {
  await freshApp();
  test.setTimeout(3_600_000);
  await setToday('2026-10-12');
  const admin = await asAdmin();
  // 25 users: the Admin plus 24 landlords.
  const landlordIds: string[] = [];
  let clock = Date.parse('2026-10-12T16:00:00.000Z');
  for (let i = 0; i < 24; i++) {
    // Invitation accept is limited to 20 per IP per 15 minutes (§16): move the clock on.
    if (i > 0 && i % 10 === 0) await setNow(new Date((clock += 16 * 60_000)).toISOString());
    landlordIds.push((await createLandlord(`Scale Landlord ${i + 1}`)).id);
  }
  const owner = await createOwner(admin);
  const units: string[] = [];
  for (let p = 0; p < 100; p++) {
    const prop = await createProperty(admin, { name: `Scale ${p + 1} Main St`, ownerId: owner.id, responsibleUserIds: [landlordIds[p % 24]] });
    for (let u = 0; u < 4; u++) units.push((await createUnit(admin, prop.id, { label: `${u + 1}F`, use: u === 3 ? 'Commercial' : 'Residential' })).id);
  }
  // 5,000 leases: yearly, non-overlapping, 12 or 13 per unit.
  const jobs: (() => Promise<unknown>)[] = [];
  let made = 0;
  for (let i = 0; i < units.length; i++) {
    const tenant = await createTenant(admin, { lastName: `Scale${i}` });
    const count = i < 200 ? 13 : 12;
    for (let y = 0; y < count; y++) {
      const year = 2026 - y;
      jobs.push(() =>
        createLease(admin, units[i], { startDate: `${year}-01-01`, endDate: `${year}-12-31`, baseRentCents: dollars(1500 + y), tenantIds: [tenant.id] }),
      );
      made++;
    }
  }
  expect(made).toBe(5000);
  for (let i = 0; i < jobs.length; i += 10) await Promise.all(jobs.slice(i, i + 10).map((j) => j()));

  const time = async (path: string) => {
    const t = performance.now();
    const r = await admin.get(path);
    expect(r.status, path).toBe(200);
    return performance.now() - t;
  };
  await time('/api/dashboard'); // warm-up
  expect(await time('/api/dashboard')).toBeLessThan(1000);
  for (const path of ['/api/owners', '/api/properties', '/api/tenants', '/api/leases', '/api/compliance/items', '/api/compliance/types', '/api/investments', '/api/templates', '/api/users', '/api/people', '/api/audit-log']) {
    const samples: number[] = [];
    for (let i = 0; i < 20; i++) samples.push(await time(path));
    samples.sort((a, b) => a - b);
    expect(samples[Math.ceil(0.95 * samples.length) - 1], `p95 of ${path}`).toBeLessThan(500);
  }
});
