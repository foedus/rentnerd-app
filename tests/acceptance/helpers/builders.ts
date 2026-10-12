/**
 * Test data built through the normal API (SPEC.md §13 intro, §14).
 * Request bodies use the §6 field names; money fields carry the `Cents` suffix
 * (§14.1), e.g. baseRent -> baseRentCents. Enum values are the §6 codes where
 * §6 gives one in backticks (`market_estimate`, `percent`), otherwise the label
 * text ("LLC", "Residential", "Tenant moved out").
 */
import { expect } from '@playwright/test';
import type { Api } from './api';
import { fetchBuffer } from './pdf';

export const uid = () => Math.random().toString(36).slice(2, 7);
export const dollars = (n: number) => Math.round(n * 100);

export async function createOwner(api: Api, o: Record<string, unknown> = {}) {
  return await api.ok('POST', '/api/owners', {
    name: `Owner ${uid()} LLC`,
    ownerType: 'LLC',
    addressLine1: '1 Owner Plaza',
    city: 'Brooklyn',
    state: 'NY',
    zip: '11201',
    ...o,
  });
}

export async function createProperty(api: Api, o: Record<string, unknown> = {}) {
  const ownerId = o.ownerId ?? (await createOwner(api)).id;
  const responsibleUserIds = o.responsibleUserIds ?? [(await api.me()).id];
  return await api.ok('POST', '/api/properties', {
    name: `${100 + Math.floor(Math.random() * 800)} Test St ${uid()}`,
    street: `${Math.floor(Math.random() * 900) + 1} Test Street`,
    city: 'Brooklyn',
    state: 'NY',
    zip: '11201',
    inNyc: true,
    ...o,
    ownerId,
    responsibleUserIds,
  });
}

export async function createUnit(api: Api, propertyId: string, o: Record<string, unknown> = {}) {
  return await api.ok('POST', `/api/properties/${propertyId}/units`, { label: `U${uid()}`, use: 'Residential', ...o });
}

export async function createTenant(api: Api, o: Record<string, unknown> = {}) {
  return await api.ok('POST', '/api/tenants', {
    tenantType: 'Individual',
    firstName: 'Tess',
    lastName: `Tenant${uid()}`,
    ...o,
  });
}

export const tenantName = (t: any) => (t.tenantType === 'Business' ? `${t.businessName} (${t.contactPerson})` : `${t.firstName} ${t.lastName}`);

export type LeaseInput = {
  startDate: string;
  endDate: string;
  baseRentCents: number;
  tenantIds: string[];
  /** Index into tenantIds of the primary tenant (default 0). */
  primary?: number;
  [k: string]: unknown;
};

export async function createLease(api: Api, unitId: string, input: LeaseInput) {
  const { tenantIds, primary = 0, ...rest } = input;
  const unit = await api.ok('GET', `/api/units/${unitId}`);
  return await api.ok('POST', `/api/units/${unitId}/leases`, {
    increaseType: 'none',
    rentDueDay: 1,
    ...(unit.use === 'Residential' ? { childrenReside: false } : {}),
    ...rest,
    tenants: tenantIds.map((tenantId, i) => ({ tenantId, isPrimary: i === primary })),
  });
}

export async function getLease(api: Api, leaseId: string) {
  return await api.ok('GET', `/api/leases/${leaseId}`);
}

export async function patchLease(api: Api, leaseId: string, changes: Record<string, unknown>) {
  const lease = await getLease(api, leaseId);
  return await api.ok('PATCH', `/api/leases/${leaseId}`, { ...changes, version: lease.version });
}

export async function endLease(api: Api, leaseId: string, moveOutDate: string, endReason = 'Tenant moved out') {
  const lease = await getLease(api, leaseId);
  return await api.ok('POST', `/api/leases/${leaseId}/end`, { moveOutDate, endReason, version: lease.version });
}

export async function markMonthToMonth(api: Api, leaseId: string, monthToMonthRentCents?: number) {
  const lease = await getLease(api, leaseId);
  return await api.ok('POST', `/api/leases/${leaseId}/month-to-month`, {
    version: lease.version,
    ...(monthToMonthRentCents === undefined ? {} : { monthToMonthRentCents }),
  });
}

/** Terms not given are copied from the previous term (§6.10 pre-fill). */
export async function addExtension(api: Api, leaseId: string, o: Record<string, unknown>) {
  const lease = await getLease(api, leaseId);
  return await api.ok('POST', `/api/leases/${leaseId}/extensions`, { increaseType: 'none', ...o, version: lease.version });
}

export async function addValue(api: Api, propertyId: string, valueDate: string, kind: 'market_estimate' | 'assessed', amountCents: number) {
  return await api.ok('POST', `/api/properties/${propertyId}/values`, { valueDate, kind, amountCents });
}

export async function addTax(api: Api, propertyId: string, taxYear: number, amountCents: number) {
  return await api.ok('POST', `/api/properties/${propertyId}/taxes`, { taxYear, amountCents });
}

export async function addInvestment(api: Api, o: Record<string, unknown>) {
  return await api.ok('POST', '/api/investments', { unitId: null, category: 'Appliance', description: `Item ${uid()}`, ...o });
}

export async function archive(api: Api, path: string) {
  const rec = await api.ok('GET', path);
  return await api.ok('POST', `${path}/archive`, { version: rec.version });
}

export async function restore(api: Api, path: string) {
  const rec = await api.ok('GET', path);
  return await api.ok('POST', `${path}/restore`, { version: rec.version });
}

/** One property with one unit and one lease, with fresh owner and tenants. */
export async function leasedUnit(
  api: Api,
  o: {
    startDate: string;
    endDate: string;
    rent: number;
    use?: 'Residential' | 'Commercial';
    tenants?: number;
    property?: Record<string, unknown>;
    unitLabel?: string;
    lease?: Record<string, unknown>;
  },
) {
  const property = await createProperty(api, o.property ?? {});
  const unit = await createUnit(api, property.id, { label: o.unitLabel ?? '2R', use: o.use ?? 'Residential' });
  const tenants = [];
  for (let i = 0; i < (o.tenants ?? 1); i++) tenants.push(await createTenant(api, { firstName: ['Ann', 'Bo', 'Cy', 'Di'][i] ?? 'Ed' }));
  const lease = await createLease(api, unit.id, {
    startDate: o.startDate,
    endDate: o.endDate,
    baseRentCents: dollars(o.rent),
    tenantIds: tenants.map((t) => t.id),
    ...(o.lease ?? {}),
  });
  return { property, unit, tenants, lease };
}

export async function templateIdByName(api: Api, name: string): Promise<string> {
  const rows = await api.list('/api/templates?archived=true');
  const t = rows.find((r: any) => r.name === name);
  if (!t) throw new Error(`No template named ${name}`);
  return t.id;
}

export async function generateDocument(api: Api, leaseId: string, templateId: string, extensionId?: string) {
  return await api.ok('POST', `/api/leases/${leaseId}/documents`, { templateId, ...(extensionId ? { extensionId } : {}) });
}

export async function waitForDocument(api: Api, id: string, status = 'ready', timeoutMs = 60_000) {
  let last: any;
  await expect
    .poll(
      async () => {
        last = await api.ok('GET', `/api/documents/${id}`);
        return last.status;
      },
      { timeout: timeoutMs, intervals: [1000] },
    )
    .toBe(status);
  return last;
}

/** Downloads a generated document through its signed URL. */
export async function downloadDocument(api: Api, id: string): Promise<Buffer> {
  const { url } = await api.ok('GET', `/api/documents/${id}/download`);
  const r = await fetchBuffer(url);
  expect(r.status).toBe(200);
  return r.buf;
}
