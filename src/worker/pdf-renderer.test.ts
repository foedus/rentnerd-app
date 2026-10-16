import { EventEmitter } from "node:events";
import type { Browser } from "playwright-core";
import { describe, expect, it } from "vitest";
import { PdfRenderer } from "./pdf-renderer";

class FakeBrowser extends EventEmitter {
  connected = true;
  closed = false;
  pages = 0;
  peak = 0;
  constructor(private readonly delayMs = 0, private readonly failures: { n: number } = { n: 0 }) {
    super();
  }
  isConnected() {
    return this.connected;
  }
  async close() {
    this.closed = true;
    this.connected = false;
  }
  crash() {
    this.connected = false;
    this.emit("disconnected");
  }
  async newContext() {
    return {
      route: async () => undefined,
      close: async () => undefined,
      newPage: async () => ({
        setContent: async () => {
          this.pages += 1;
          this.peak = Math.max(this.peak, this.pages);
          await new Promise((r) => setTimeout(r, this.delayMs));
        },
        evaluate: async () => undefined,
        pdf: async () => {
          this.pages -= 1;
          if (this.failures.n > 0) {
            this.failures.n -= 1;
            throw new Error("render failed");
          }
          return Buffer.from("%PDF-fake");
        },
      }),
    };
  }
}

const input = { title: "t", bodyHtml: "<p>x</p>", footerLeft: "f" };

function setup(options: { jobsPerBrowser?: number; delayMs?: number } = {}) {
  const browsers: FakeBrowser[] = [];
  const renderer = new PdfRenderer({
    jobsPerBrowser: options.jobsPerBrowser,
    launch: async () => {
      const b = new FakeBrowser(options.delayMs);
      browsers.push(b);
      return b as unknown as Browser;
    },
  });
  return { renderer, browsers };
}

describe("PdfRenderer", () => {
  it("starts Chromium once and reuses it", async () => {
    const { renderer, browsers } = setup();
    await Promise.all([renderer.render(input), renderer.render(input), renderer.render(input)]);
    await renderer.render(input);
    expect(browsers).toHaveLength(1);
    await renderer.close();
    expect(browsers[0]?.closed).toBe(true);
  });

  it("runs at most two renders at the same time", async () => {
    const { renderer, browsers } = setup({ delayMs: 20 });
    await Promise.all(Array.from({ length: 6 }, () => renderer.render(input)));
    expect(browsers[0]?.peak).toBe(2);
    await renderer.close();
  });

  it("restarts Chromium after 100 jobs and closes the old one", async () => {
    const { renderer, browsers } = setup({ jobsPerBrowser: 3 });
    for (let i = 0; i < 7; i++) await renderer.render(input);
    expect(browsers).toHaveLength(3);
    expect(browsers[0]?.closed).toBe(true);
    expect(browsers[1]?.closed).toBe(true);
    expect(browsers[2]?.closed).toBe(false);
    await renderer.close();
  });

  it("defaults to 100 jobs per browser", async () => {
    const { renderer, browsers } = setup();
    for (let i = 0; i < 100; i++) await renderer.render(input);
    expect(browsers).toHaveLength(1);
    await renderer.render(input);
    expect(browsers).toHaveLength(2);
    await renderer.close();
  });

  it("does not close a retired browser while a job is still using it", async () => {
    const { renderer, browsers } = setup({ jobsPerBrowser: 2, delayMs: 30 });
    const results = await Promise.all([renderer.render(input), renderer.render(input), renderer.render(input)]);
    expect(results.map(String)).toEqual(["%PDF-fake", "%PDF-fake", "%PDF-fake"]);
    expect(browsers[0]?.closed).toBe(true);
    await renderer.close();
  });

  it("starts a new Chromium after a crash", async () => {
    const { renderer, browsers } = setup();
    await renderer.render(input);
    browsers[0]?.crash();
    await expect(renderer.render(input)).resolves.toBeInstanceOf(Buffer);
    expect(browsers).toHaveLength(2);
    await renderer.close();
  });

  it("frees its slot when a render fails", async () => {
    const failures = { n: 3 };
    const renderer = new PdfRenderer({ launch: async () => new FakeBrowser(0, failures) as unknown as Browser });
    for (let i = 0; i < 3; i++) await expect(renderer.render(input)).rejects.toThrow("render failed");
    await expect(renderer.render(input)).resolves.toBeInstanceOf(Buffer);
    await renderer.close();
  });

  it("refuses work after close", async () => {
    const { renderer } = setup();
    await renderer.close();
    await expect(renderer.render(input)).rejects.toThrow("closed");
  });
});
