import { describe, expect, it } from "vitest";
import { createTemplateSchema, templateListQuerySchema, updateTemplateSchema } from "./template-schemas";

const content = { type: "doc", content: [] };
const message = (r: { success: boolean; error?: { issues: { message: string }[] } }) => r.error?.issues[0]?.message;

describe("template schemas", () => {
  it("trims the name and requires one", () => {
    expect(createTemplateSchema.parse({ name: "  Lease ", kind: "extension", content }).name).toBe("Lease");
    expect(message(createTemplateSchema.safeParse({ name: "  ", kind: "extension", content }))).toBe("Enter a template name.");
    expect(message(createTemplateSchema.safeParse({ kind: "extension", content }))).toBe("Enter a template name.");
  });
  it("requires a known type and content", () => {
    expect(message(createTemplateSchema.safeParse({ name: "A", kind: "other", content }))).toBe("Choose a template type.");
    expect(message(createTemplateSchema.safeParse({ name: "A", kind: "extension" }))).toBe("Enter the template text.");
  });
  it("needs a version to update", () => {
    expect(message(updateTemplateSchema.safeParse({ name: "A" }))).toBe("version is required");
  });
  it("filters the list", () => {
    expect(templateListQuerySchema.parse({}).archived).toBe("false");
    expect(templateListQuerySchema.parse({ kind: "" }).kind).toBeUndefined();
    expect(templateListQuerySchema.safeParse({ kind: "x" }).success).toBe(false);
  });
});
