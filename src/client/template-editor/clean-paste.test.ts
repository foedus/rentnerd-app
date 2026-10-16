// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { cleanPastedHtml } from "./paste";

describe("cleanPastedHtml", () => {
  it("removes images, headers, links (keeping text) and reports it", () => {
    const r = cleanPastedHtml('<div style="mso-element:header"><p>SECRET HEADER</p></div><p><img src="x.png">Hello <a href="https://e.com">site</a><o:p></o:p></p><style>p{}</style>');
    expect(r.removed).toBe(true);
    expect(r.html).not.toContain("img");
    expect(r.html).not.toContain("SECRET");
    expect(r.html).not.toContain("<a");
    expect(r.html).toContain("site");
  });
  it("splits merged cells", () => {
    const r = cleanPastedHtml('<table><tr><td colspan="2">A</td></tr><tr><td>B</td><td>C</td></tr></table>');
    expect(r.removed).toBe(true);
    expect(r.html).not.toContain("colspan");
    expect(r.html.match(/<td/g)).toHaveLength(4);
  });
  it("drops tracked deletions but keeps insertions' text", () => {
    const r = cleanPastedHtml("<p>Keep <ins>added</ins><del>gone</del></p>");
    expect(r.html).toContain("added");
    expect(r.html).not.toContain("gone");
  });
  it("reports nothing removed for plain content", () => {
    expect(cleanPastedHtml("<p>Hello <b>world</b></p>").removed).toBe(false);
  });
});

it("cleans the Word clipboard fixture", async () => {
  const { readFileSync } = await import("node:fs");
  const r = cleanPastedHtml(readFileSync("tests/acceptance/fixtures/word-lease.html", "utf8"));
  expect(r.removed).toBe(true);
  expect(r.html).not.toMatch(/<img|ACME HOLDINGS|<a |vml|clip_image/i);
  expect(r.html).toContain("the building website");
  expect(r.html).toContain("<table");
});

it("drops Word list marker spans (mso-list:Ignore) without reporting a removal", () => {
  const r = cleanPastedHtml('<p><span style="mso-list:Ignore">·<span>&nbsp;&nbsp;</span></span>Item one</p>');
  expect(r.html).toBe("<p>Item one</p>");
  expect(r.removed).toBe(false);
});
