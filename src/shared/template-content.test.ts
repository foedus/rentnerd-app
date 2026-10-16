import { describe, expect, it } from "vitest";
import { checkTemplateContent, templateContentError } from "./template-content";

const doc = (...content: unknown[]) => ({ type: "doc", content });
const p = (...content: unknown[]) => ({ type: "paragraph", content });
const t = (text: string, marks?: string[]) => ({ type: "text", text, ...(marks ? { marks: marks.map((type) => ({ type })) } : {}) });
const chip = (key: string) => ({ type: "placeholder", attrs: { key } });
const err = (d: unknown, kind: "master_lease" | "extension" = "master_lease") => templateContentError(d, kind);

describe("template content (§8.4)", () => {
  it("accepts the allowed formatting", () => {
    const d = doc(
      { type: "heading", attrs: { level: 1, textAlign: "center" }, content: [t("Lease")] },
      p(t("Hello ", ["bold", "italic", "underline"]), chip("tenant_names")),
      { type: "orderedList", attrs: { start: 1 }, content: [{ type: "listItem", content: [p(t("One")), { type: "bulletList", content: [{ type: "listItem", content: [p(t("Nested"))] }] }] }] },
      { type: "table", content: [{ type: "tableRow", content: [{ type: "tableHeader", attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [p(t("A"))] }, { type: "tableCell", content: [p()] }] }] },
      { type: "pageBreak" },
    );
    expect(err(d)).toBeNull();
  });
  it("rejects empty content, but a lone chip counts as content", () => {
    expect(err(doc())).toBe("Enter the template text.");
    expect(err(doc(p(t("   "))))).toBe("Enter the template text.");
    expect(err(doc({ type: "pageBreak" }))).toBe("Enter the template text.");
    expect(err(doc(p(chip("today"))))).toBeNull();
  });
  it("lists unknown keys, typed or as chips, once each", () => {
    expect(err(doc(p(t("Hi {{not_a_key}} and {{not_a_key}} {{ monthly_rent }}"), chip("zzz"))))).toBe("Unrecognised placeholders: {{not_a_key}}, {{zzz}}");
  });
  it("flags extension-only keys in a master lease template only", () => {
    const d = doc(p(t("From {{extension_start_date}}"), chip("removed_tenant_names")));
    expect(err(d)).toBe("Unrecognised placeholders: {{extension_start_date}} (only available in Lease extension templates), {{removed_tenant_names}} (only available in Lease extension templates)");
    expect(err(d, "extension")).toBeNull();
  });
  it.each([
    ["an image", doc(p(t("x")), { type: "image", attrs: { src: "http://evil/x.png" } })],
    ["a link mark", doc(p({ type: "text", text: "x", marks: [{ type: "link", attrs: { href: "http://x" } }] }))],
    ["a colour mark", doc(p({ type: "text", text: "x", marks: [{ type: "textStyle", attrs: { color: "red" } }] }))],
    ["heading level 3", doc({ type: "heading", attrs: { level: 3 }, content: [t("x")] })],
    ["right alignment", doc({ type: "paragraph", attrs: { textAlign: "right" }, content: [t("x")] })],
    ["merged cells", doc(p(t("x")), { type: "table", content: [{ type: "tableRow", content: [{ type: "tableCell", attrs: { colspan: 2 }, content: [p(t("a"))] }] }] })],
    ["a list inside a cell", doc(p(t("x")), { type: "table", content: [{ type: "tableRow", content: [{ type: "tableCell", content: [{ type: "bulletList", content: [] }] }] }] })],
    ["a page break inside a list", doc(p(t("x")), { type: "bulletList", content: [{ type: "listItem", content: [{ type: "pageBreak" }] }] })],
    ["an unknown attribute", doc({ type: "paragraph", attrs: { style: "color:red" }, content: [t("x")] })],
    ["text outside a paragraph", doc(t("x"))],
    ["a non-document", { type: "paragraph" }],
    ["a string", "hello"],
  ])("rejects %s", (_n, d) => {
    expect(checkTemplateContent(d, "master_lease").structure.length).toBeGreaterThan(0);
  });
  it("rejects absurd nesting", () => {
    let inner: unknown = p(t("x"));
    for (let i = 0; i < 30; i++) inner = { type: "bulletList", content: [{ type: "listItem", content: [inner] }] };
    expect(err(doc(inner))).toBe("The content is too large or too deeply nested.");
  });
});
