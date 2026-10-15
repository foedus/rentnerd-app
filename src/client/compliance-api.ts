import { FieldErrorsError, TOO_MANY, TooManyRequestsError, UnauthenticatedError } from "./api";
import type { ComplianceStatus } from "../shared/compliance";
import type { ComplianceScheduleType } from "../shared/compliance-rules";

const GENERIC = "Something went wrong. Please try again.";

export interface ComplianceItemRecord {
  id: string;
  propertyId: string;
  applicable: boolean;
  nextDueDate: string | null;
  notes: string | null;
  version: number;
  status: ComplianceStatus;
  lastCompletedOn: string | null;
  completionCount: number;
  type: { id: string; name: string; scheduleType: ComplianceScheduleType; dueMonth: number | null; dueDay: number | null; intervalMonths: number | null };
}

export interface CompletionRecord {
  id: string;
  completedOn: string;
  notes: string | null;
  completedByName: string | null;
}

/** The item was changed by someone else since it was loaded (409, D-10). */
export class StaleItemError extends Error {}
/** The item or completion no longer exists. */
export class MissingItemError extends Error {}

function refuse(res: Response): never {
  if (res.status === 401) throw new UnauthenticatedError("Not signed in");
  if (res.status === 429) throw new TooManyRequestsError(TOO_MANY);
  throw new Error(GENERIC);
}

/** Every item of a property (one per non-archived type), ordered by item name. */
export async function fetchPropertyCompliance(propertyId: string): Promise<ComplianceItemRecord[]> {
  const res = await fetch(`/api/properties/${encodeURIComponent(propertyId)}/compliance`, { headers: { accept: "application/json" } });
  if (!res.ok) refuse(res);
  const body = (await res.json()) as { data?: ComplianceItemRecord[] };
  if (!Array.isArray(body.data)) throw new Error(GENERIC);
  return body.data;
}

async function sendJson(url: string, method: string, body: unknown): Promise<Response> {
  const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (res.ok) return res;
  if (res.status === 404) throw new MissingItemError("not found");
  if (res.status === 409) throw new StaleItemError("conflict");
  if (res.status === 422) {
    const parsed = (await res.json().catch(() => null)) as { error?: { fields?: Record<string, string> } } | null;
    const fields = parsed?.error?.fields;
    if (fields && Object.keys(fields).length > 0) throw new FieldErrorsError(fields);
  }
  return refuse(res);
}

/** Switches an item on or off, or sets its next due date (null = Not scheduled). */
export async function updateComplianceItem(id: string, version: number, changes: { applicable?: boolean; nextDueDate?: string | null }): Promise<void> {
  await sendJson(`/api/compliance/items/${encodeURIComponent(id)}`, "PATCH", { ...changes, version });
}

/** Mark done: records the completion and sets the next due date in the same step. */
export async function markComplianceDone(id: string, body: { completedOn: string; notes?: string | null; nextDueDate: string | null; version: number }): Promise<void> {
  await sendJson(`/api/compliance/items/${encodeURIComponent(id)}/completions`, "POST", body);
}

export async function fetchCompletions(itemId: string): Promise<CompletionRecord[]> {
  const res = await fetch(`/api/compliance/items/${encodeURIComponent(itemId)}/completions?pageSize=200`, { headers: { accept: "application/json" } });
  if (res.status === 404) throw new MissingItemError("not found");
  if (!res.ok) refuse(res);
  return ((await res.json()) as { data: CompletionRecord[] }).data;
}

export async function deleteCompletion(id: string): Promise<void> {
  const res = await fetch(`/api/compliance/completions/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok && res.status !== 404) refuse(res);
}

export interface DueItemRecord extends ComplianceItemRecord {
  propertyName: string;
  responsible: { id: string; name: string; email: string }[];
}

export interface DueListPage {
  data: DueItemRecord[];
  page: number;
  pageSize: number;
  total: number;
}

/** The Due list (§11.18): items of live properties, filtered by property, status and responsible landlord. */
export async function fetchDueList(params: { propertyId: string; responsibleUserId: string; statuses: readonly string[]; page: number }): Promise<DueListPage> {
  const qs = new URLSearchParams({ page: String(params.page) });
  if (params.propertyId) qs.set("propertyId", params.propertyId);
  if (params.responsibleUserId) qs.set("responsibleUserId", params.responsibleUserId);
  if (params.statuses.length > 0) qs.set("status", params.statuses.join(","));
  const res = await fetch(`/api/compliance/items?${qs}`, { headers: { accept: "application/json" } });
  if (!res.ok) refuse(res);
  const body = (await res.json()) as Partial<DueListPage>;
  if (!Array.isArray(body.data)) throw new Error(GENERIC);
  return body as DueListPage;
}

/** Names of all properties for the Property filter (fetched page by page, 200 at a time). */
export async function fetchPropertyNames(): Promise<{ id: string; name: string }[]> {
  const names: { id: string; name: string }[] = [];
  for (let page = 1; ; page++) {
    const res = await fetch(`/api/properties?pageSize=200&page=${page}`, { headers: { accept: "application/json" } });
    if (!res.ok) refuse(res);
    const body = (await res.json()) as { data: { id: string; name: string }[]; total?: number };
    names.push(...body.data.map(({ id, name }) => ({ id, name })));
    if (body.data.length === 0 || names.length >= (body.total ?? 0)) return names;
  }
}
