import { FieldErrorsError, TOO_MANY, TooManyRequestsError } from "./api";

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
  if ((res.status === 409 || res.status === 404) && parsed?.error?.message) throw new Error(parsed.error.message);
  throw new Error(GENERIC);
}
