import { FieldErrorsError, TOO_MANY, TooManyRequestsError, UnauthenticatedError } from "./api";
import type { TemplateKind } from "../shared/placeholders";

export interface TemplateRecord {
  id: string;
  name: string;
  kind: TemplateKind;
  version: number;
  archivedAt: string | null;
  updatedAt: string;
  updatedByName: string | null;
  /** A generated PDF has used the template, so it can only be archived. */
  hasDocuments: boolean;
  /** Only the single-template read carries the TipTap JSON. */
  content?: Record<string, unknown>;
}

export interface TemplatesPage {
  data: TemplateRecord[];
  page: number;
  pageSize: number;
  total: number;
}

/** The template was changed by someone else since it was loaded (409, D-10). */
export class StaleTemplateError extends Error {}
/** The template no longer exists. */
export class MissingTemplateError extends Error {}
/** The server refused an action and said why (e.g. deleting a template that PDFs used). */
export class TemplateRefusedError extends Error {}

const GENERIC = "Something went wrong. Please try again.";
const JSON_HEADERS = { "content-type": "application/json" };

type ErrorBody = { error?: { message?: string; fields?: Record<string, string> } };

async function failure(res: Response): Promise<Error> {
  if (res.status === 401) return new UnauthenticatedError("Not signed in");
  if (res.status === 429) return new TooManyRequestsError(TOO_MANY);
  const body = (await res.json().catch(() => null)) as ErrorBody | null;
  const fields = body?.error?.fields;
  if ((res.status === 409 || res.status === 422) && fields && Object.keys(fields).length > 0) return new FieldErrorsError(fields);
  if (res.status === 404) return new MissingTemplateError("not found");
  if (res.status === 409 && body?.error?.message?.includes("changed by someone else")) return new StaleTemplateError("conflict");
  if (res.status === 409 && body?.error?.message) return new TemplateRefusedError(body.error.message);
  return new Error(GENERIC);
}

export async function fetchTemplates(params: { archived: boolean; page: number }): Promise<TemplatesPage> {
  const qs = new URLSearchParams({ page: String(params.page), archived: String(params.archived) });
  const res = await fetch(`/api/templates?${qs}`, { headers: { accept: "application/json" } });
  if (!res.ok) throw await failure(res);
  return (await res.json()) as TemplatesPage;
}

export async function fetchTemplate(id: string): Promise<TemplateRecord> {
  const res = await fetch(`/api/templates/${encodeURIComponent(id)}`, { headers: { accept: "application/json" } });
  if (!res.ok) throw await failure(res);
  return (await res.json()) as TemplateRecord;
}

/** Creates (no target) or edits (target id and version) a template and returns the saved record. */
export async function saveTemplate(values: { name: string; kind?: string; content: Record<string, unknown> }, target?: { id: string; version: number }): Promise<TemplateRecord> {
  const body = target ? { name: values.name, content: values.content, version: target.version } : values;
  const res = await fetch(target ? `/api/templates/${encodeURIComponent(target.id)}` : "/api/templates", {
    method: target ? "PATCH" : "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
  if (res.ok) return (await res.json()) as TemplateRecord;
  throw await failure(res);
}

export type TemplateAction = "archive" | "restore" | "delete";

export async function templateAction(action: TemplateAction, template: Pick<TemplateRecord, "id" | "version">): Promise<void> {
  const url = `/api/templates/${encodeURIComponent(template.id)}`;
  const res =
    action === "delete"
      ? await fetch(url, { method: "DELETE" })
      : await fetch(`${url}/${action}`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ version: template.version }) });
  if (!res.ok) throw await failure(res);
}
