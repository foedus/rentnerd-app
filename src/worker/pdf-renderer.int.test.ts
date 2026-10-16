import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { PDFParse } from "pdf-parse";
import { afterAll, describe, expect, it } from "vitest";
import { PdfRenderer } from "./pdf-renderer";

const renderer = new PdfRenderer();
afterAll(() => renderer.close());

async function parse(pdf: Buffer) {
  const parser = new PDFParse({ data: new Uint8Array(pdf) });
  try {
    const text = await parser.getText();
    const info = await parser.getInfo();
    return { text: text.text, info };
  } finally {
    await parser.destroy();
  }
}

describe("PdfRenderer with real Chromium", () => {
  it("makes a US Letter PDF with the title, body text and a Page X of Y footer", async () => {
    const pdf = await renderer.render({
      title: "Lease - 1 Main St 2R - 2026-11-01",
      bodyHtml: '<h1>Lease</h1><p>Tenant “Ann Lee” pays $2,150.00 – monthly.</p><table class="rn-table"><tbody><tr><td>A</td></tr></tbody></table>',
      footerLeft: "1 Main St · Unit 2R",
    });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    const { text, info } = await parse(pdf);
    expect(text).toContain("Tenant “Ann Lee” pays $2,150.00 – monthly.");
    expect(text).toContain("1 Main St · Unit 2R");
    expect(text).toContain("Page 1 of 1");
    expect(info.info?.Title).toBe("Lease - 1 Main St 2R - 2026-11-01");
    expect(pdf.toString("latin1")).toMatch(/\/MediaBox \[0 0 612 792\]/);
  });

  it("numbers pages and breaks where the template says so", async () => {
    const pdf = await renderer.render({
      title: "Two pages",
      bodyHtml: '<p>First</p><div class="rn-page-break"></div><p>Second</p>',
      footerLeft: "x",
    });
    const { text } = await parse(pdf);
    expect(text).toContain("Page 1 of 2");
    expect(text).toContain("Page 2 of 2");
  });

  it("embeds the Tinos font", async () => {
    const pdf = await renderer.render({ title: "Font", bodyHtml: "<p>Hello</p>", footerLeft: "x" });
    expect(pdf.toString("latin1")).toMatch(/\/FontName \/[A-Z]+\+Tinos/);
  });

  it("runs no script and makes no network request", async () => {
    const hits: string[] = [];
    const server = createServer((req, res) => {
      hits.push(req.url ?? "");
      res.end("x");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const pdf = await renderer.render({
        title: "Offline",
        bodyHtml: `<p>Static</p><script>document.body.append("SCRIPT-RAN")</script><img src="${base}/img.png"><link rel="stylesheet" href="${base}/a.css"><iframe src="${base}/f"></iframe><style>@import url(${base}/b.css); p { background: url(${base}/bg.png) }</style>`,
        footerLeft: "x",
      });
      const { text } = await parse(pdf);
      expect(text).toContain("Static");
      expect(text).not.toContain("SCRIPT-RAN");
      expect(hits).toEqual([]);
    } finally {
      server.close();
    }
  });
});
