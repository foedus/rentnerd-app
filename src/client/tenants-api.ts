import { TOO_MANY, TooManyRequestsError } from "./api";

export interface TenantRecord {
  id: string;
  version: number;
  tenantType: "Individual" | "Business";
  firstName: string | null;
  lastName: string | null;
  businessName: string | null;
  contactPerson: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  archivedAt: string | null;
  displayName: string;
  /** Detail only: the tenant is on a lease or extension, so it can only be archived. */
  onLease?: boolean;
}

export interface TenantsPage {
  data: TenantRecord[];
  page: number;
  pageSize: number;
  total: number;
}

export class StaleTenantError extends Error {}

const GENERIC = "Something went wrong. Please try again.";
const JSON_HEADERS = { "content-type": "application/json" };

async function failure(res: Response): Promise<Error> {
  if (res.status === 429) return new TooManyRequestsError(TOO_MANY);
  const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
  if ((res.status === 409 || res.status === 404) && body?.error?.message) return new Error(body.error.message);
  return new Error(GENERIC);
}

export async function fetchTenants(params: { q: string; archived: boolean; page: number }): Promise<TenantsPage> {
  const qs = new URLSearchParams({ page: String(params.page), archived: String(params.archived) });
  if (params.q.trim()) qs.set("q", params.q.trim());
  const res = await fetch(`/api/tenants?${qs}`, { headers: { accept: "application/json" } });
  if (!res.ok) throw await failure(res);
  return (await res.json()) as TenantsPage;
}

export async function fetchTenant(id: string): Promise<TenantRecord> {
  const res = await fetch(`/api/tenants/${encodeURIComponent(id)}`, { headers: { accept: "application/json" } });
  if (!res.ok) throw await failure(res);
  return (await res.json()) as TenantRecord;
}

/** Creates (no target) or edits (id and version) a tenant and returns the saved record. */
export async function saveTenant(values: Record<string, unknown>, target?: { id: string; version: number }): Promise<TenantRecord> {
  const res = await fetch(target ? `/api/tenants/${encodeURIComponent(target.id)}` : "/api/tenants", {
    method: target ? "PATCH" : "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(target ? { ...values, version: target.version } : values),
  });
  if (res.ok) return (await res.json()) as TenantRecord;
  if (res.status === 409) throw new StaleTenantError("conflict");
  throw await failure(res);
}

export type TenantAction = "archive" | "restore";

export async function tenantAction(action: TenantAction, tenant: Pick<TenantRecord, "id" | "version">): Promise<void> {
  const res = await fetch(`/api/tenants/${encodeURIComponent(tenant.id)}/${action}`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ version: tenant.version }),
  });
  if (!res.ok) throw await failure(res);
}

export async function deleteTenant(id: string): Promise<void> {
  const res = await fetch(`/api/tenants/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok) throw await failure(res);
}
