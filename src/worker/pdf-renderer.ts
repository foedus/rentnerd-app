import { chromium, type Browser } from "playwright-core";
import { footerTemplateHtml, printDocumentHtml } from "../shared/pdf-layout";
import { tinosFontCss } from "./pdf-fonts";

export const PDF_CONCURRENCY = 2;
export const PDF_JOBS_PER_BROWSER = 100;

export interface PdfInput {
  /** File name without ".pdf"; becomes the document title. */
  title: string;
  bodyHtml: string;
  /** Footer, left side: "{property_address} · Unit {unit_label}". */
  footerLeft: string;
}

interface Generation {
  browser: Browser;
  uses: number;
  active: number;
  retired: boolean;
}

export interface PdfRendererOptions {
  concurrency?: number;
  jobsPerBrowser?: number;
  launch?: () => Promise<Browser>;
}

/**
 * Renders HTML to PDF with one shared Chromium (§15.1): a page per job, at most `concurrency` at a time,
 * and a fresh browser after `jobsPerBrowser` jobs or when the old one crashed. JavaScript is off and every
 * request is blocked (§8.2); the document carries its fonts inline.
 */
export class PdfRenderer {
  private current: Generation | undefined;
  private starting: Promise<Generation> | undefined;
  private waiting: Array<() => void> = [];
  private running = 0;
  private closed = false;
  private readonly concurrency: number;
  private readonly jobsPerBrowser: number;
  private readonly launch: () => Promise<Browser>;
  /** Number of Chromium processes started so far (for tests and logs). */
  launches = 0;

  constructor(options: PdfRendererOptions = {}) {
    this.concurrency = options.concurrency ?? PDF_CONCURRENCY;
    this.jobsPerBrowser = options.jobsPerBrowser ?? PDF_JOBS_PER_BROWSER;
    // Content is sanitised, script-free and offline, and the container runs as an unprivileged user without the sandbox's kernel features.
    this.launch = options.launch ?? (() => chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] }));
  }

  async render(input: PdfInput): Promise<Buffer> {
    await this.acquire();
    try {
      return await this.renderOnce(input);
    } finally {
      this.release();
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    const generation = this.current ?? (await this.starting?.catch(() => undefined));
    this.current = undefined;
    await generation?.browser.close().catch(() => undefined);
  }

  private async renderOnce(input: PdfInput): Promise<Buffer> {
    const generation = await this.lease();
    try {
      const context = await generation.browser.newContext({ javaScriptEnabled: false, offline: true, serviceWorkers: "block" });
      try {
        await context.route("**/*", (route) => route.abort("blockedbyclient"));
        const page = await context.newPage();
        await page.setContent(printDocumentHtml({ title: input.title, bodyHtml: input.bodyHtml, fontCss: tinosFontCss() }), { waitUntil: "load" });
        await page.evaluate(() => document.fonts.ready).catch(() => undefined);
        return await page.pdf({
          format: "Letter",
          margin: { top: "1in", right: "1in", bottom: "1in", left: "1in" },
          printBackground: true,
          displayHeaderFooter: true,
          headerTemplate: "<span></span>",
          footerTemplate: footerTemplateHtml(input.footerLeft),
        });
      } finally {
        await context.close().catch(() => undefined);
      }
    } finally {
      generation.active -= 1;
      if (generation.retired && generation.active === 0) await generation.browser.close().catch(() => undefined);
    }
  }

  /** Hands out the current browser (starting or replacing it as needed) and counts the job against it. */
  private async lease(): Promise<Generation> {
    for (;;) {
      if (this.closed) throw new Error("PDF renderer is closed");
      const current = this.current;
      if (current && !current.retired && current.browser.isConnected()) {
        current.uses += 1;
        current.active += 1;
        if (current.uses >= this.jobsPerBrowser) this.retire(current);
        return current;
      }
      if (current) this.retire(current);
      this.starting ??= this.start().finally(() => (this.starting = undefined));
      await this.starting;
    }
  }

  private async start(): Promise<Generation> {
    const browser = await this.launch();
    this.launches += 1;
    const generation: Generation = { browser, uses: 0, active: 0, retired: false };
    browser.on("disconnected", () => {
      generation.retired = true;
      if (this.current === generation) this.current = undefined;
    });
    if (this.closed) {
      await browser.close().catch(() => undefined);
      return generation;
    }
    this.current = generation;
    return generation;
  }

  private retire(generation: Generation): void {
    generation.retired = true;
    if (this.current === generation) this.current = undefined;
    if (generation.active === 0) void generation.browser.close().catch(() => undefined);
  }

  private async acquire(): Promise<void> {
    if (this.running < this.concurrency) {
      this.running += 1;
      return;
    }
    await new Promise<void>((resolve) => this.waiting.push(resolve));
  }

  private release(): void {
    const next = this.waiting.shift();
    if (next) next();
    else this.running -= 1;
  }
}
