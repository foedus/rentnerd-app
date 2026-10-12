/** API (API). */
import { expect, test } from '@playwright/test';
import { Api, asAdmin } from './helpers/api';
import { freshApp, setToday } from './helpers/app';
import { createOwner, createTenant } from './helpers/builders';
import { APP_URL } from './helpers/env';

test.beforeAll(async () => {
  await freshApp();
  await setToday('2026-10-12');
});

test('AC-API-01 requests without a session get 401 UNAUTHENTICATED', async () => {
  const anon = await Api.anon();
  const paths = [
    '/api/me', '/api/users', '/api/people', '/api/invitations', '/api/owners', '/api/properties', '/api/tenants', '/api/leases', '/api/templates',
    '/api/placeholders?kind=master_lease', '/api/compliance/types', '/api/compliance/items', '/api/investments', '/api/dashboard', '/api/import/template', '/api/audit-log',
    `/api/properties/${crypto.randomUUID()}`, `/api/documents/${crypto.randomUUID()}/download`,
  ];
  for (const path of paths) {
    const r = await anon.get(path);
    expect(r.status, path).toBe(401);
    expect(r.body.error.code, path).toBe('UNAUTHENTICATED');
    expect(typeof r.body.error.message, path).toBe('string');
  }
  const post = await anon.post('/api/owners', { name: 'X' });
  expect(post.status).toBe(401);
  expect(post.body.error.code).toBe('UNAUTHENTICATED');
  expect((await anon.get('/api/health')).status).toBe(200);
});

test('AC-API-02 a missing property name is a 422 VALIDATION_ERROR with fields.name', async () => {
  const admin = await asAdmin();
  const owner = await createOwner(admin);
  const r = await admin.post('/api/properties', { street: '1 A St', city: 'Brooklyn', state: 'NY', zip: '11201', inNyc: true, ownerId: owner.id, responsibleUserIds: [(await admin.me()).id] });
  expect(r.status).toBe(422);
  expect(r.body.error.code).toBe('VALIDATION_ERROR');
  expect(r.body.error.fields.name).toBeTruthy();
});

test('AC-API-03 list pagination and the pageSize limit', async () => {
  const admin = await asAdmin();
  for (let i = 0; i < 15; i++) await createTenant(admin, { lastName: `Page${i}` });
  const r = await admin.get('/api/tenants?page=2&pageSize=10');
  expect(r.status).toBe(200);
  expect(Array.isArray(r.body.data)).toBe(true);
  expect(r.body.data.length).toBeLessThanOrEqual(10);
  expect(r.body.data.length).toBeGreaterThan(0);
  expect(r.body.page).toBe(2);
  expect(r.body.pageSize).toBe(10);
  expect(r.body.total).toBeGreaterThanOrEqual(15);
  expect((await admin.get('/api/tenants?pageSize=201')).status).toBe(422);
});

test('AC-API-04 a stale version is a 409 CONFLICT', async () => {
  const admin = await asAdmin();
  const owner = await createOwner(admin);
  await admin.ok('PATCH', `/api/owners/${owner.id}`, { city: 'Queens', version: owner.version });
  const r = await admin.patch(`/api/owners/${owner.id}`, { city: 'Bronx', version: owner.version });
  expect(r.status).toBe(409);
  expect(r.body.error.code).toBe('CONFLICT');
});

test('AC-API-05 an unknown id is a 404 NOT_FOUND', async () => {
  const admin = await asAdmin();
  const r = await admin.get(`/api/properties/${crypto.randomUUID()}`);
  expect(r.status).toBe(404);
  expect(r.body.error.code).toBe('NOT_FOUND');
});

test('AC-API-06 state-changing requests need the app Origin', async () => {
  const admin = await asAdmin();
  const cookie = await admin.cookieHeader();
  const body = JSON.stringify({ name: 'Origin Test LLC', ownerType: 'LLC', addressLine1: '1 A St', city: 'Brooklyn', state: 'NY', zip: '11201' });
  const owner = await createOwner(admin);
  const attempts: [string, string, string | undefined][] = [
    ['POST', '/api/owners', body],
    ['PATCH', `/api/owners/${owner.id}`, JSON.stringify({ city: 'Queens', version: owner.version })],
    ['DELETE', `/api/owners/${owner.id}`, undefined],
  ];
  for (const origin of ['https://evil.example', undefined]) {
    for (const [method, path, payload] of attempts) {
      const headers: Record<string, string> = { cookie, 'content-type': 'application/json' };
      if (origin) headers.origin = origin;
      const res = await fetch(`${APP_URL}${path}`, { method, headers, body: payload });
      expect(res.status, `${method} ${path} origin=${origin}`).toBe(403);
    }
  }
  expect((await admin.ok('GET', `/api/owners/${owner.id}`)).city).toBe(owner.city);
});
