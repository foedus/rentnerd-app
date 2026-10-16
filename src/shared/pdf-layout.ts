import { escapeHtml } from "./template-render";

export interface PrintDocument {
  /** Metadata title: the file name without ".pdf" (§8.2). */
  title: string;
  /** Sanitised body HTML from renderTemplate. */
  bodyHtml: string;
  /** `@font-face` rules with the fonts inlined as data: URLs (rendering is offline). */
  fontCss: string;
}

/** §8.2 print stylesheet: Tinos 11 pt / 1.35, H1 16 pt centred bold, 0.5 pt table borders, explicit page breaks. */
export const PRINT_CSS = `
html { margin: 0; padding: 0; }
body { margin: 0; font-family: "Tinos", "Times New Roman", serif; font-size: 11pt; line-height: 1.35; color: #000; }
p { margin: 0 0 0.6em; }
h1, h2 { font-weight: bold; margin: 0 0 0.6em; }
h1 { font-size: 16pt; text-align: center; }
h2 { font-size: 13pt; }
ul, ol { margin: 0 0 0.6em; padding-left: 1.6em; }
.rn-center { text-align: center; }
.rn-table { border-collapse: collapse; width: 100%; margin: 0 0 0.6em; }
.rn-table th, .rn-table td { border: 0.5pt solid #000; padding: 2pt 4pt; text-align: left; vertical-align: top; }
.rn-table tr { break-inside: avoid; }
.rn-signature { margin-top: 2em; break-inside: avoid; }
.rn-page-break { break-after: page; height: 0; }
`;

/** A complete HTML document for Chromium. No script, no external resources, no remote fonts. */
export function printDocumentHtml(doc: PrintDocument): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">`
    + `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:">`
    + `<title>${escapeHtml(doc.title)}</title><style>${doc.fontCss}${PRINT_CSS}</style></head><body>${doc.bodyHtml}</body></html>`;
}

/** Chromium footer template, 8 pt: address left, "Page X of Y" right (§8.2). The margins come from the PDF options. */
export function footerTemplateHtml(leftText: string): string {
  return `<div style="box-sizing:border-box;width:100%;padding:0 1in;font-family:'Tinos','Times New Roman',serif;font-size:8pt;display:flex;justify-content:space-between">`
    + `<span>${escapeHtml(leftText)}</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`;
}
