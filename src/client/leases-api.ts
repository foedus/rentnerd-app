import type { EditableLease } from "../shared/lease-edit";
import { FieldErrorsError, TOO_MANY, TooManyRequestsError } from "./api";
import { FormMessageError, VersionConflictError } from "./components/forms";

/** The server's refusal when the dates clash with another lease on the unit (§6.9). */
export const OVERLAP_MESSAGE = "This unit already has a lease for those dates.";
/** The dates clash with another lease; `canReplace` says whether "Replace current lease" would work. */
export class OverlapError extends Error {
  constructor(readonly canReplace: boolean) {
    super(OVERLAP_MESSAGE);
  }
}
const GENERIC = "Something went wrong. Please try again.";

/** Saves a new lease under a unit (§14.2); field problems come back as FieldErrorsError, other refusals as an Error with the server's message. */
export async function createLease(unitId: string, body: Record<string, unknown>): Promise<{ id: string }> {
  const res = await fetch(`/api/units/${encodeURIComponent(unitId)}/leases`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => {
    throw new Error(GENERIC);
  });
  if (res.ok) return (await res.json()) as { id: string };
  if (res.status === 429) throw new TooManyRequestsError(TOO_MANY);
  const parsed = (await res.json().catch(() => null)) as { error?: { message?: string; fields?: Record<string, string> } } | null;
  const fields = parsed?.error?.fields;
  if (res.status === 422 && fields && Object.keys(fields).length > 0) throw new FieldErrorsError(fields);
  if (res.status === 409 && parsed?.error?.message === OVERLAP_MESSAGE) throw new OverlapError(fields?.replaceCurrentLease === "available");
  if ((res.status === 409 || res.status === 404) && parsed?.error?.message) throw new Error(parsed.error.message);
  throw new Error(GENERIC);
}

export interface LeaseDetailRecord extends EditableLease {
  id: string;
  version: number;
  unitId: string;
  propertyId: string | null;
  statusLabel: string;
  status: "ended" | "upcoming" | "active" | "month_to_month" | "ended_superseded" | "needs_decision";
  monthToMonth: boolean;
  lastRentCents: number;
  propertyName: string | null;
  unitLabel: string | null;
  unitUse: "Residential" | "Commercial" | null;
  startDate: string;
  endDate: string;
  effectiveEndDate: string;
  currentRentCents: number;
  current: {
    tenants: { tenantId: string; isPrimary: boolean; displayName: string; email: string | null; phone: string | null }[];
    securityDepositCents: number | null;
    rentDueDay: number;
    lateFeeCents: number | null;
    lateFeeGraceDays: number | null;
    pets: string | null;
    parking: string | null;
    parkingChargeCents: number | null;
    childrenReside: boolean | null;
    breakClause: string | null;
    otherTerms: string | null;
    baseTaxYear: number | null;
    taxSharePercent: number | null;
    taxReimbursementCents: number | null;
    taxReimbursementExplanation: string | null;
  };
  rentSchedule: { periodStart: string; periodEnd: string; rentCents: number; term: string }[];
}

export async function fetchLease(id: string): Promise<LeaseDetailRecord> {
  const res = await fetch(`/api/leases/${encodeURIComponent(id)}`, { headers: { accept: "application/json" } }).catch(() => {
    throw new Error(GENERIC);
  });
  if (res.ok) return (await res.json()) as LeaseDetailRecord;
  if (res.status === 429) throw new TooManyRequestsError(TOO_MANY);
  throw new Error(res.status === 404 ? "Lease not found." : GENERIC);
}

/** The server's refusal when someone else saved the lease first (409 with this wording, §6.9). */
const STALE_PREFIX = "This lease was changed by someone else";

/** Saves the edited lease (§14.2); field problems come back as FieldErrorsError, a stale version as VersionConflictError. */
export async function updateLease(id: string, body: Record<string, unknown>): Promise<void> {
  const res = await fetch(`/api/leases/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => {
    throw new Error(GENERIC);
  });
  if (res.ok) return;
  if (res.status === 429) throw new TooManyRequestsError(TOO_MANY);
  const parsed = (await res.json().catch(() => null)) as { error?: { message?: string; fields?: Record<string, string> } } | null;
  const fields = parsed?.error?.fields;
  if (res.status === 422 && fields && Object.keys(fields).length > 0) throw new FieldErrorsError(fields);
  if (res.status === 409 && parsed?.error?.message?.startsWith(STALE_PREFIX)) throw new VersionConflictError();
  if ((res.status === 409 || res.status === 404) && parsed?.error?.message) throw new Error(parsed.error.message);
  throw new Error(GENERIC);
}

/** Posts a lease action (§14.2); field problems come back as FieldErrorsError, a stale version as VersionConflictError. */
async function postAction(id: string, action: "month-to-month" | "end", body: Record<string, unknown>): Promise<void> {
  const res = await fetch(`/api/leases/${encodeURIComponent(id)}/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => {
    throw new Error(GENERIC);
  });
  if (res.ok) return;
  if (res.status === 429) throw new TooManyRequestsError(TOO_MANY);
  const parsed = (await res.json().catch(() => null)) as { error?: { message?: string; fields?: Record<string, string> } } | null;
  const fields = parsed?.error?.fields;
  if (res.status === 422 && fields && Object.keys(fields).length > 0) throw new FieldErrorsError(fields);
  if (res.status === 409 && parsed?.error?.message?.startsWith(STALE_PREFIX)) throw new VersionConflictError();
  if ((res.status === 409 || res.status === 404) && parsed?.error?.message) throw new FormMessageError(parsed.error.message);
  throw new Error(GENERIC);
}

export const markMonthToMonth = (id: string, version: number, monthToMonthRentCents: number) => postAction(id, "month-to-month", { version, monthToMonthRentCents });
export const endLease = (id: string, version: number, moveOutDate: string, endReason: string) => postAction(id, "end", { version, moveOutDate, endReason });

/** Deletes the lease with its extensions, versions and PDFs (§11.13). */
export async function deleteLease(id: string): Promise<void> {
  const res = await fetch(`/api/leases/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => {
    throw new Error(GENERIC);
  });
  if (res.ok || res.status === 404) return;
  if (res.status === 429) throw new TooManyRequestsError(TOO_MANY);
  throw new Error(GENERIC);
}

export interface LeaseVersionRow {
  versionNumber: number;
  changedAt: string;
  changedByName: string | null;
  summary: string;
}

export async function fetchLeaseVersions(id: string): Promise<LeaseVersionRow[]> {
  const res = await fetch(`/api/leases/${encodeURIComponent(id)}/versions`, { headers: { accept: "application/json" } }).catch(() => {
    throw new Error(GENERIC);
  });
  if (!res.ok) throw new Error(GENERIC);
  return ((await res.json()) as { data: LeaseVersionRow[] }).data;
}

/** One saved version: the lease as it was then (D-31). */
export interface LeaseVersionRecord extends LeaseVersionRow {
  snapshot: Omit<EditableLease, "masterTenants"> & { tenants: { tenantId: string; isPrimary: boolean }[] };
  snapshotTenants: { tenantId: string; isPrimary: boolean; displayName: string }[];
}

export async function fetchLeaseVersion(id: string, n: string): Promise<LeaseVersionRecord> {
  const res = await fetch(`/api/leases/${encodeURIComponent(id)}/versions/${encodeURIComponent(n)}`, { headers: { accept: "application/json" } }).catch(() => {
    throw new Error(GENERIC);
  });
  if (res.ok) return (await res.json()) as LeaseVersionRecord;
  throw new Error(res.status === 404 ? "Version not found." : GENERIC);
}

export interface LeaseListRow {
  id: string;
  propertyName: string | null;
  unitId: string;
  unitLabel: string | null;
  currentTenants: { tenantId: string; displayName: string }[];
  startDate: string;
  effectiveEndDate: string;
  currentRentCents: number;
  statusLabel: string;
}

export interface LeaseListPage {
  data: LeaseListRow[];
  page: number;
  pageSize: number;
  total: number;
}

/** GET /leases (§14.2); `status` is sent once per lease status code. */
export async function fetchLeases(params: { status: readonly string[]; propertyId: string; archived: boolean; page: number }): Promise<LeaseListPage> {
  const qs = new URLSearchParams({ page: String(params.page), archived: String(params.archived) });
  for (const s of params.status) qs.append("status", s);
  if (params.propertyId) qs.set("propertyId", params.propertyId);
  const res = await fetch(`/api/leases?${qs}`, { headers: { accept: "application/json" } }).catch(() => {
    throw new Error(GENERIC);
  });
  if (res.status === 429) throw new TooManyRequestsError(TOO_MANY);
  if (!res.ok) throw new Error(GENERIC);
  return (await res.json()) as LeaseListPage;
}
