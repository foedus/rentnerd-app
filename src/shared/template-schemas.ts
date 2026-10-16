import { z } from "zod";
import { TEMPLATE_KINDS } from "./placeholders";
import { listQuerySchema } from "./schemas";

const VERSION = z.number({ error: "version is required" }).int().min(1, "version is required");
export const TEMPLATE_NAME_REQUIRED = "Enter a template name.";
export const TEMPLATE_NAME_TAKEN = "A template with this name already exists.";

const name = z.string({ error: TEMPLATE_NAME_REQUIRED }).trim().min(1, TEMPLATE_NAME_REQUIRED).max(200, "Use 200 characters or fewer.");
const kind = z.enum(TEMPLATE_KINDS, { error: "Choose a template type." });
/** TipTap JSON; the node-level rules (§8.4) run in the route because they depend on the template type. */
const content = z.record(z.string(), z.unknown(), { error: "Enter the template text." });

export const createTemplateSchema = z.object({ name, kind, content });
export const updateTemplateSchema = z.object({ name: name.optional(), kind: kind.optional(), content: content.optional(), version: VERSION });
export const templateListQuerySchema = listQuerySchema.extend({
  archived: z.enum(["true", "false"]).default("false"),
  kind: z.preprocess((v) => (v === "" ? undefined : v), kind.optional()),
});
export const placeholderQuerySchema = z.object({ kind: z.preprocess((v) => (v === "" ? undefined : v), kind.optional()) });
