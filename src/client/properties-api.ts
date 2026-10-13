import { TOO_MANY, TooManyRequestsError } from "./api";

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
