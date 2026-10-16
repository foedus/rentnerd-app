import { describe, expect, it } from "vitest";
import { footerTemplateHtml, printDocumentHtml, PRINT_CSS } from "./pdf-layout";

describe("printDocumentHtml", () => {
  const html = printDocumentHtml({ title: 'Lease - A & "B"', bodyHtml: "<p>Hi</p>", fontCss: "@font-face{font-family:Tinos}" });

  it("escapes the title and keeps the body and fonts", () => {
    expect(html).toContain("<title>Lease - A &amp; &quot;B&quot;</title>");
    expect(html).toContain("<body><p>Hi</p></body>");
    expect(html).toContain("@font-face{font-family:Tinos}");
  });

  it("forbids every fetch and script through a CSP, and links nothing external", () => {
    expect(html).toContain("default-src 'none'");
    expect(html).not.toMatch(/<script|<link|@import|https?:\/\//i);
  });

  it("follows the §8.2 typography", () => {
    expect(PRINT_CSS).toContain("font-size: 11pt");
    expect(PRINT_CSS).toContain("line-height: 1.35");
    expect(PRINT_CSS).toMatch(/h1 \{ font-size: 16pt; text-align: center/);
    expect(PRINT_CSS).toContain("0.5pt solid #000");
    expect(PRINT_CSS).toContain(".rn-page-break { break-after: page");
  });
});

describe("footerTemplateHtml", () => {
  it("shows the address left and Page X of Y right at 8 pt, escaped", () => {
    const html = footerTemplateHtml("1 <Main> St · Unit 2R");
    expect(html).toContain("font-size:8pt");
    expect(html).toContain("<span>1 &lt;Main&gt; St · Unit 2R</span>");
    expect(html).toContain('Page <span class="pageNumber"></span> of <span class="totalPages"></span>');
  });
});
