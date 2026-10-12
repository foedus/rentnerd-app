/**
 * Fixture builders (SPEC.md §13): the Dashboard fixture, built through the API.
 * Assumes today = 2026-10-12 (test clock).
 */
import type { Api } from './api';
import { addValue, createLease, createProperty, createTenant, createUnit, dollars } from './builders';

export async function dashboardFixture(api: Api) {
  // Property A (NYC; market estimate $1,000,000): A1 occupied $2,000 + parking $100, A2 occupied $3,000, A3 vacant (last rent $1,500).
  const a = await createProperty(api, { name: 'Property A', street: '1 Alpha Street', inNyc: true });
  await addValue(api, a.id, '2026-01-01', 'market_estimate', dollars(1_000_000));
  const a1 = await createUnit(api, a.id, { label: 'A1', use: 'Residential' });
  const a2 = await createUnit(api, a.id, { label: 'A2', use: 'Residential' });
  const a3 = await createUnit(api, a.id, { label: 'A3', use: 'Residential' });
  // Property B (no value): B1 occupied $1,000.
  const b = await createProperty(api, { name: 'Property B', street: '2 Bravo Street', inNyc: true });
  const b1 = await createUnit(api, b.id, { label: 'B1', use: 'Residential' });

  const t = [];
  for (const [first, last] of [['Ann', 'Alpha'], ['Bo', 'Beta'], ['Cy', 'Gamma'], ['Di', 'Delta']]) t.push(await createTenant(api, { firstName: first, lastName: last }));
  const term = { startDate: '2026-06-01', endDate: '2027-05-31' };
  const l1 = await createLease(api, a1.id, { ...term, baseRentCents: dollars(2000), parking: 'Space #1', parkingChargeCents: dollars(100), tenantIds: [t[0].id] });
  const l2 = await createLease(api, a2.id, { ...term, baseRentCents: dollars(3000), tenantIds: [t[1].id] });
  const l3 = await createLease(api, a3.id, {
    startDate: '2025-01-01', endDate: '2025-12-31', baseRentCents: dollars(1500), tenantIds: [t[2].id], moveOutDate: '2025-12-31', endReason: 'Tenant moved out',
  });
  const l4 = await createLease(api, b1.id, { ...term, baseRentCents: dollars(1000), tenantIds: [t[3].id] });
  return { a, b, units: { a1, a2, a3, b1 }, leases: { l1, l2, l3, l4 }, tenants: t };
}
