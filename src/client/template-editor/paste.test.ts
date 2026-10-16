import { Editor } from "@tiptap/core";
import { expect, it } from "vitest";
import { chipifyPaste } from "./paste";
import { templateExtensions } from "./extensions";

const para = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
const run = (text: string, kind: "master_lease" | "extension") => {
  const editor = new Editor({ extensions: templateExtensions, content: { type: "doc", content: [para(text)] } });
  const slice = chipifyPaste(editor.state.doc.slice(0, editor.state.doc.content.size), editor.schema, kind);
  const json = JSON.stringify(slice.content.toJSON());
  editor.destroy();
  return json;
};

it("turns a recognised {{key}} into a chip and keeps the surrounding text", () => {
  const json = run("Rent is {{monthly_rent}} per month.", "master_lease");
  expect(json).toContain('"type":"placeholder"');
  expect(json).toContain('"key":"monthly_rent"');
  expect(json).toContain('"label":"Monthly rent"');
  expect(json).toContain("Rent is ");
  expect(json).toContain(" per month.");
  expect(json).not.toContain("{{");
});

it("accepts spaces inside the braces", () => {
  expect(run("{{ tenant_names }}", "master_lease")).toContain('"key":"tenant_names"');
});

it("leaves unknown keys as text", () => {
  const json = run("Bad {{not_a_key}} here.", "master_lease");
  expect(json).not.toContain("placeholder");
  expect(json).toContain("{{not_a_key}}");
});

it("leaves extension-only keys as text in a master lease but chips them in an extension", () => {
  expect(run("{{extension_start_date}}", "master_lease")).toContain("{{extension_start_date}}");
  expect(run("{{extension_start_date}}", "extension")).toContain('"key":"extension_start_date"');
});

it("converts several tokens in one paragraph", () => {
  const json = run("{{monthly_rent}} and {{security_deposit}} but {{nope}}", "master_lease");
  expect(json.match(/"type":"placeholder"/g)).toHaveLength(2);
  expect(json).toContain("{{nope}}");
});

const runInline = (children: unknown[], kind: "master_lease" | "extension" = "master_lease") => {
  const editor = new Editor({ extensions: templateExtensions, content: { type: "doc", content: [{ type: "paragraph", content: children as never }] } });
  const slice = chipifyPaste(editor.state.doc.slice(0, editor.state.doc.content.size), editor.schema, kind);
  const json = JSON.stringify(slice.content.toJSON());
  editor.destroy();
  return json;
};

it("joins a key split across formatting runs into one chip", () => {
  const json = runInline([
    { type: "text", text: "Between the Owner and {{tenant_" },
    { type: "text", text: "names", marks: [{ type: "bold" }] },
    { type: "text", text: "}} (the Tenant)." },
  ]);
  expect(json).toContain('"key":"tenant_names"');
  expect(json).not.toContain("{{");
  expect(json).toContain("Between the Owner and ");
  expect(json).toContain(" (the Tenant).");
});
