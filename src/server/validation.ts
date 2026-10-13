import type { Context } from "hono";
import type { z } from "zod";
import { apiError } from "./api-guard";

export type Parsed<T> = { ok: true; data: T } | { ok: false; response: Response };

/** Validates input with a shared Zod schema; failures use the §14.1 422 envelope with per-field messages. */
export function validate<S extends z.ZodType>(c: Context, schema: S, input: unknown): Parsed<z.infer<S>> {
  const result = schema.safeParse(input);
  if (result.success) return { ok: true, data: result.data };
  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join(".") || "body";
    fields[key] ??= issue.message;
  }
  return { ok: false, response: apiError(c, "VALIDATION_ERROR", "Please check the highlighted fields.", fields) };
}

export async function validateBody<S extends z.ZodType>(c: Context, schema: S): Promise<Parsed<z.infer<S>>> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return { ok: false, response: apiError(c, "BAD_REQUEST", "The request body must be valid JSON.") };
  }
  return validate(c, schema, body);
}
