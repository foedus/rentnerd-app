import { FieldErrorsError, TOO_MANY, TooManyRequestsError, UnauthenticatedError } from "./api";

export interface InvestmentRecord {
  id: string;
  version: number;
  entryDate: string;
  propertyId: string;
  propertyName: string;
  unitId: string | null;
  unitLabel: string | null;
  category: string;
  description: string;
  vendor: string | null;
  costCents: number;
}

export interface InvestmentFilters {
  propertyId: string;
  category: string;
  from: string;
  to: string;
  page: number;
}

export interface InvestmentsPage {
  data: InvestmentRecord[];
  page: number;
  pageSize: number;
  total: number;
  totalCents: number;
}

const GENERIC = "Something went wrong. Please try again.";

/** The entry changed (or went away) since it was loaded (D-10). */
export class StaleInvestmentError extends Error {}

/** The server refused the change with a plain-language reason (e.g. the property is archived). */
export class InvestmentRefusedError extends Error {}

export async function fetchInvestments(f: InvestmentFilters): Promise<InvestmentsPage> {
  const qs = new URLSearchParams({ page: String(f.page) });
  for (const key of ["propertyId", "category", "from", "to"] as const) if (f[key]) qs.set(key, f[key]);
  const res = await fetch(`/api/investments?${qs}`, { headers: { accept: "application/json" } });
  if (res.status === 401) throw new UnauthenticatedError("Not signed in");
  if (res.status === 429) throw new TooManyRequestsError(TOO_MANY);
  if (!res.ok) throw new Error(GENERIC);
  return (await res.json()) as InvestmentsPage;
}

/** Creates (no target) or edits (id and version) an entry; field problems come back as FieldErrorsError. */
export async function saveInvestment(values: Record<string, unknown>, target?: { id: string; version: number }): Promise<InvestmentRecord> {
  const res = await fetch(target ? `/api/investments/${encodeURIComponent(target.id)}` : "/api/investments", {
    method: target ? "PATCH" : "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(target ? { ...values, version: target.version } : values),
  });
  if (res.ok) return (await res.json()) as InvestmentRecord;
  if (res.status === 429) throw new TooManyRequestsError(TOO_MANY);
  const body = (await res.json().catch(() => null)) as { error?: { message?: string; fields?: Record<string, string> } } | null;
  const fields = body?.error?.fields;
  if (res.status === 422 && fields && Object.keys(fields).length > 0) throw new FieldErrorsError(fields);
  if (res.status === 404) throw new InvestmentRefusedError("This entry no longer exists. Reload the page.");
  if (res.status === 409 && target) throw new StaleInvestmentError("conflict");
  if (res.status === 409 && body?.error?.message) throw new InvestmentRefusedError(body.error.message);
  throw new Error(GENERIC);
}

export async function deleteInvestment(id: string): Promise<void> {
  const res = await fetch(`/api/investments/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (res.status === 429) throw new TooManyRequestsError(TOO_MANY);
  if (!res.ok && res.status !== 404) throw new Error(GENERIC);
}
