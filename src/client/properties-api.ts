import { FieldErrorsError, TOO_MANY, TooManyRequestsError, UnauthenticatedError } from "./api";

export interface PropertyRecord {
  id: string;
  name: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  archivedAt: string | null;
  owner: { id: string; name: string } | null;
  responsible: { id: string; name: string; email: string }[];
  version?: number;
  inNyc?: boolean;
  bbl?: string | null;
  yearBuilt?: number | null;
  ownerId?: string;
  responsibleUserIds?: string[];
  purchasePriceCents?: number | null;
  purchaseDate?: string | null;
  notes?: string | null;
  propertyType: string;
  unitCount: number;
  occupiedCount: number;
  currentValue?: CurrentValue | null;
}

export interface PropertiesPage {
  data: PropertyRecord[];
  page: number;
  pageSize: number;
  total: number;
}

export async function fetchProperties(params: { q: string; archived: boolean; page: number }): Promise<PropertiesPage> {
  const qs = new URLSearchParams({ page: String(params.page), archived: String(params.archived) });
  if (params.q.trim()) qs.set("q", params.q.trim());
  const res = await fetch(`/api/properties?${qs}`, { headers: { accept: "application/json" } });
  if (res.status === 429) throw new TooManyRequestsError(TOO_MANY);
  if (!res.ok) throw new Error("Something went wrong. Please try again.");
  return (await res.json()) as PropertiesPage;
}

export interface Person {
  id: string;
  name: string;
  email: string;
}

const GENERIC = "Something went wrong. Please try again.";
const NO_ACCESS = "You don't have access to this page.";

export async function fetchPeople(): Promise<Person[]> {
  const res = await fetch("/api/people", { headers: { accept: "application/json" } });
  if (res.status === 429) throw new TooManyRequestsError(TOO_MANY);
  if (!res.ok) throw new Error(GENERIC);
  return (await res.json()) as Person[];
}

/** The property doesn't exist (or no longer does). */
export class PropertyNotFoundError extends Error {}

export async function fetchProperty(id: string): Promise<PropertyRecord> {
  const res = await fetch(`/api/properties/${encodeURIComponent(id)}`, { headers: { accept: "application/json" } });
  if (res.status === 401) throw new UnauthenticatedError("Not signed in");
  if (res.status === 403) throw new Error(NO_ACCESS);
  if (res.status === 404) throw new PropertyNotFoundError("not found");
  if (res.status === 429) throw new TooManyRequestsError(TOO_MANY);
  if (!res.ok) throw new Error(GENERIC);
  return (await res.json()) as PropertyRecord;
}

/** The record changed since it was loaded (409 without field messages, D-10). */
export class StalePropertyError extends Error {}

/** Creates (no target) or edits (id and version) a property; field problems come back as FieldErrorsError. */
export async function saveProperty(values: Record<string, unknown>, target?: { id: string; version: number }): Promise<PropertyRecord> {
  const res = await fetch(target ? `/api/properties/${encodeURIComponent(target.id)}` : "/api/properties", {
    method: target ? "PATCH" : "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(target ? { ...values, version: target.version } : values),
  });
  if (res.ok) return (await res.json()) as PropertyRecord;
  if (res.status === 429) throw new TooManyRequestsError(TOO_MANY);
  const body = (await res.json().catch(() => null)) as { error?: { fields?: Record<string, string> } } | null;
  const fields = body?.error?.fields;
  if ((res.status === 409 || res.status === 422) && fields && Object.keys(fields).length > 0) throw new FieldErrorsError(fields);
  if (res.status === 409) throw new StalePropertyError("conflict");
  throw new Error(GENERIC);
}

/** Every non-archived owner, for the Owner select. */
export async function fetchOwnerChoices(): Promise<{ id: string; name: string }[]> {
  const out: { id: string; name: string }[] = [];
  for (let page = 1; ; page++) {
    const res = await fetch(`/api/owners?archived=false&pageSize=200&page=${page}`, { headers: { accept: "application/json" } });
    if (res.status === 429) throw new TooManyRequestsError(TOO_MANY);
    if (!res.ok) throw new Error(GENERIC);
    const body = (await res.json()) as { data: { id: string; name: string }[]; total: number };
    out.push(...body.data.map((o) => ({ id: o.id, name: o.name })));
    if (out.length >= body.total || body.data.length === 0) return out;
  }
}

export interface UnitLeaseInfo {
  statusText: string;
  occupied: boolean;
  currentRentCents: number | null;
  potentialRentCents: number | null;
  tenants: string[];
  leaseEndDate: string | null;
  currentLease: { id: string; startDate: string; endDate: string; statusLabel: string; tenants: string[] } | null;
  history: { id: string; startDate: string; endDate: string; tenants: string[]; statusLabel: string; rentAtEndCents: number }[];
}

export interface UnitRecord {
  lease?: UnitLeaseInfo;
  id: string;
  label: string;
  use: string;
  archivedAt: string | null;
  version?: number;
  propertyId?: string;
  bedrooms?: number | null;
  bathrooms?: number | null;
  squareFeet?: number | null;
  notes?: string | null;
  ownerOverrideId?: string | null;
  owner?: { id: string; name: string } | null;
  property?: { id: string; name: string } | null;
}

/** A property's units (first page of up to 200), optionally with archived ones. */
export async function fetchPropertyUnits(propertyId: string, archived: boolean): Promise<UnitRecord[]> {
  const qs = new URLSearchParams({ archived: String(archived), pageSize: "200" });
  const res = await fetch(`/api/properties/${encodeURIComponent(propertyId)}/units?${qs}`, { headers: { accept: "application/json" } });
  if (res.status === 401) throw new UnauthenticatedError("Not signed in");
  if (res.status === 403) throw new Error(NO_ACCESS);
  if (res.status === 429) throw new TooManyRequestsError(TOO_MANY);
  if (!res.ok) throw new Error(GENERIC);
  return ((await res.json()) as { data: UnitRecord[] }).data;
}

/** The unit doesn't exist (or no longer does). */
export class UnitNotFoundError extends Error {}

export async function fetchUnit(id: string): Promise<UnitRecord> {
  const res = await fetch(`/api/units/${encodeURIComponent(id)}`, { headers: { accept: "application/json" } });
  if (res.status === 401) throw new UnauthenticatedError("Not signed in");
  if (res.status === 403) throw new Error(NO_ACCESS);
  if (res.status === 404) throw new UnitNotFoundError("not found");
  if (res.status === 429) throw new TooManyRequestsError(TOO_MANY);
  if (!res.ok) throw new Error(GENERIC);
  return (await res.json()) as UnitRecord;
}

/** The unit changed since it was loaded (409 without field messages, D-10). */
export class StaleUnitError extends Error {}

/** Adds a unit to a property (`target.propertyId`) or edits one (`target.id` and `version`); field problems come back as FieldErrorsError. */
export async function saveUnit(
  values: Record<string, unknown>,
  target: { propertyId: string } | { id: string; version: number },
): Promise<UnitRecord> {
  const edit = "id" in target;
  const res = await fetch(edit ? `/api/units/${encodeURIComponent(target.id)}` : `/api/properties/${encodeURIComponent(target.propertyId)}/units`, {
    method: edit ? "PATCH" : "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(edit ? { ...values, version: target.version } : values),
  });
  if (res.ok) return (await res.json()) as UnitRecord;
  if (res.status === 429) throw new TooManyRequestsError(TOO_MANY);
  const body = (await res.json().catch(() => null)) as { error?: { fields?: Record<string, string> } } | null;
  const fields = body?.error?.fields;
  if ((res.status === 409 || res.status === 422) && fields && Object.keys(fields).length > 0) throw new FieldErrorsError(fields);
  if (res.status === 409) throw new StaleUnitError("conflict");
  throw new Error(GENERIC);
}

export interface CurrentValue {
  amountCents: number;
  basis: { kind: "market_estimate"; date: string } | { kind: "purchase_price" };
}

export interface PropertyValueRecord {
  id: string;
  valueDate: string;
  kind: "market_estimate" | "assessed";
  amountCents: number;
  source: string | null;
  version: number;
}

/** A property's value history, newest first (first page of up to 200). */
export async function fetchPropertyValues(propertyId: string): Promise<PropertyValueRecord[]> {
  const res = await fetch(`/api/properties/${encodeURIComponent(propertyId)}/values?pageSize=200`, { headers: { accept: "application/json" } });
  if (res.status === 401) throw new UnauthenticatedError("Not signed in");
  if (res.status === 403) throw new Error(NO_ACCESS);
  if (res.status === 429) throw new TooManyRequestsError(TOO_MANY);
  if (!res.ok) throw new Error(GENERIC);
  return ((await res.json()) as { data: PropertyValueRecord[] }).data;
}

/** The value changed since it was loaded (409, D-10). */
export class StaleValueError extends Error {}

/** Adds a value to a property (`target.propertyId`) or edits one (`target.id` and `version`). */
export async function savePropertyValue(
  values: Record<string, unknown>,
  target: { propertyId: string } | { id: string; version: number },
): Promise<PropertyValueRecord> {
  const edit = "id" in target;
  const res = await fetch(edit ? `/api/property-values/${encodeURIComponent(target.id)}` : `/api/properties/${encodeURIComponent(target.propertyId)}/values`, {
    method: edit ? "PATCH" : "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(edit ? { ...values, version: target.version } : values),
  });
  if (res.ok) return (await res.json()) as PropertyValueRecord;
  if (res.status === 429) throw new TooManyRequestsError(TOO_MANY);
  const body = (await res.json().catch(() => null)) as { error?: { fields?: Record<string, string> } } | null;
  const fields = body?.error?.fields;
  if (res.status === 422 && fields && Object.keys(fields).length > 0) throw new FieldErrorsError(fields);
  if (res.status === 409) throw new StaleValueError("conflict");
  throw new Error(GENERIC);
}

export async function deletePropertyValue(id: string): Promise<void> {
  const res = await fetch(`/api/property-values/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (res.status === 429) throw new TooManyRequestsError(TOO_MANY);
  if (!res.ok && res.status !== 404) throw new Error(GENERIC);
}

export interface PropertyTaxRecord {
  id: string;
  taxYear: number;
  amountCents: number;
  version: number;
}

/** A property's tax years, newest first (first page of up to 200). */
export async function fetchPropertyTaxes(propertyId: string): Promise<PropertyTaxRecord[]> {
  const res = await fetch(`/api/properties/${encodeURIComponent(propertyId)}/taxes?pageSize=200`, { headers: { accept: "application/json" } });
  if (res.status === 401) throw new UnauthenticatedError("Not signed in");
  if (res.status === 403) throw new Error(NO_ACCESS);
  if (res.status === 429) throw new TooManyRequestsError(TOO_MANY);
  if (!res.ok) throw new Error(GENERIC);
  return ((await res.json()) as { data: PropertyTaxRecord[] }).data;
}

/** The tax year changed since it was loaded (409, D-10). */
export class StaleTaxError extends Error {}

/** The tax year was deleted by someone else (404). */
export class MissingTaxError extends Error {}

/** Adds a tax year to a property (`target.propertyId`) or edits one (`target.id` and `version`). A taken year arrives as a field error. */
export async function savePropertyTax(
  values: Record<string, unknown>,
  target: { propertyId: string } | { id: string; version: number },
): Promise<PropertyTaxRecord> {
  const edit = "id" in target;
  const res = await fetch(edit ? `/api/property-taxes/${encodeURIComponent(target.id)}` : `/api/properties/${encodeURIComponent(target.propertyId)}/taxes`, {
    method: edit ? "PATCH" : "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(edit ? { ...values, version: target.version } : values),
  });
  if (res.ok) return (await res.json()) as PropertyTaxRecord;
  if (res.status === 401) throw new UnauthenticatedError("Not signed in");
  if (res.status === 404 && edit) throw new MissingTaxError("gone");
  if (res.status === 429) throw new TooManyRequestsError(TOO_MANY);
  const body = (await res.json().catch(() => null)) as { error?: { code?: string; fields?: Record<string, string> } } | null;
  const fields = body?.error?.fields;
  if ((res.status === 422 || res.status === 409) && fields && Object.keys(fields).length > 0) throw new FieldErrorsError(fields);
  if (res.status === 409) throw new StaleTaxError("conflict");
  throw new Error(GENERIC);
}

export async function deletePropertyTax(id: string): Promise<void> {
  const res = await fetch(`/api/property-taxes/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (res.status === 401) throw new UnauthenticatedError("Not signed in");
  if (res.status === 429) throw new TooManyRequestsError(TOO_MANY);
  if (!res.ok && res.status !== 404) throw new Error(GENERIC);
}
