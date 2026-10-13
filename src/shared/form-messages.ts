/** Wording shared by every form (SPEC §11 shared conventions). */
export const PROBLEM_TITLE = "There is a problem";
export const CONFLICT_MESSAGE = "Someone else changed this record. Reload to see the latest version.";
export const UNEXPECTED_MESSAGE = "Something went wrong. Please try again.";

export const savedMessage = (thing: string): string => `${thing} saved.`;

export const fieldLabel = (label: string, required: boolean): string => (required ? `${label} (required)` : label);

/** Element ids for a field's input and its error text; `path` may be dotted (e.g. "tenants.0.name"). */
export const fieldId = (path: string): string => `field-${path.replace(/[^A-Za-z0-9_-]/g, "-")}`;
export const fieldErrorId = (path: string): string => `${fieldId(path)}-error`;
