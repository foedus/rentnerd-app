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

export interface UnitRecord {
  id: string;
  label: string;
  use: string;
  archivedAt: string | null;
}

/** A property's units (first page of up to 200), optionally with archived ones. */
export async function fetchPropertyUnits(propertyId: string, archived: boolean): Promise<UnitRecord[]> {
  const qs = new URLSearchParams({ archived: String(archived), pageSize: "200" });
  const res = await fetch(`/api/properties/${encodeURIComponent(propertyId)}/units?${qs}`, { headers: { accept: "application/json" } });
  if (res.status === 401) throw new UnauthenticatedError("Not signed in");
  if (res.status === 429) throw new TooManyRequestsError(TOO_MANY);
  if (!res.ok) throw new Error(GENERIC);
  return ((await res.json()) as { data: UnitRecord[] }).data;
}
