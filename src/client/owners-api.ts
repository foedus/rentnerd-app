import { TOO_MANY, TooManyRequestsError } from "./api";

export interface PropertyLink {
  id: string;
  name: string;
}

export interface OwnerRecord {
  id: string;
  version: number;
  name: string;
  ownerType: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string;
  zip: string;
  email: string | null;
  phone: string | null;
  signatoryName: string | null;
  signatoryTitle: string | null;
  notes: string | null;
  archivedAt: string | null;
  properties: PropertyLink[];
  /** Any property or unit (archived or not) refers to this owner, so it can only be archived. */
  referenced?: boolean;
}

export interface OwnersPage {
  data: OwnerRecord[];
  page: number;
  pageSize: number;
  total: number;
}

export const OWNER_IN_USE = "Change the owner on these properties before archiving this owner:";
/** Archiving refused because non-archived properties still use the owner. */
export class OwnerInUseError extends Error {
  constructor(readonly properties: PropertyLink[]) {
    super(OWNER_IN_USE);
  }
}

const GENERIC = "Something went wrong. Please try again.";
const JSON_HEADERS = { "content-type": "application/json" };

async function failure(res: Response): Promise<Error> {
  if (res.status === 429) return new TooManyRequestsError(TOO_MANY);
  const body = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string; properties?: PropertyLink[] } } | null;
  if (res.status === 409 && body?.error?.properties) return new OwnerInUseError(body.error.properties);
  if ((res.status === 409 || res.status === 404) && body?.error?.message) return new Error(body.error.message);
  return new Error(GENERIC);
}

export async function fetchOwners(params: { q: string; archived: boolean; page: number }): Promise<OwnersPage> {
  const qs = new URLSearchParams({ page: String(params.page), archived: String(params.archived) });
  if (params.q.trim()) qs.set("q", params.q.trim());
  const res = await fetch(`/api/owners?${qs}`, { headers: { accept: "application/json" } });
  if (!res.ok) throw await failure(res);
  return (await res.json()) as OwnersPage;
}

export async function fetchOwner(id: string): Promise<OwnerRecord> {
  const res = await fetch(`/api/owners/${encodeURIComponent(id)}`, { headers: { accept: "application/json" } });
  if (!res.ok) throw await failure(res);
  return (await res.json()) as OwnerRecord;
}

export class StaleOwnerError extends Error {}

/** Creates (no id) or edits (id and version) an owner and returns the saved record. */
export async function saveOwner(values: Record<string, unknown>, target?: { id: string; version: number }): Promise<OwnerRecord> {
  const res = await fetch(target ? `/api/owners/${encodeURIComponent(target.id)}` : "/api/owners", {
    method: target ? "PATCH" : "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(target ? { ...values, version: target.version } : values),
  });
  if (res.ok) return (await res.json()) as OwnerRecord;
  if (res.status === 409) throw new StaleOwnerError("conflict");
  throw await failure(res);
}

export type OwnerAction = "archive" | "restore";

export async function ownerAction(action: OwnerAction, owner: Pick<OwnerRecord, "id" | "version">): Promise<void> {
  const res = await fetch(`/api/owners/${encodeURIComponent(owner.id)}/${action}`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ version: owner.version }),
  });
  if (!res.ok) throw await failure(res);
}

export async function deleteOwner(id: string): Promise<void> {
  const res = await fetch(`/api/owners/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok) throw await failure(res);
}
