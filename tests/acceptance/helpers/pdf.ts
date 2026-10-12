/** PDF helpers: text extraction with pdf-parse, hashing, downloads. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import type { Download } from '@playwright/test';
import { PDFParse } from 'pdf-parse';

export async function pdfText(buf: Buffer): Promise<string> {
  const parser = new PDFParse({ data: new Uint8Array(buf) });
  try {
    const r = await parser.getText();
    return r.text;
  } finally {
    await parser.destroy();
  }
}

/** Collapses whitespace so assertions survive line wrapping. */
export const squash = (s: string) => s.replace(/\s+/g, ' ');

export const sha256 = (buf: Buffer) => crypto.createHash('sha256').update(buf).digest('hex');

export async function downloadBuffer(d: Download): Promise<Buffer> {
  const p = await d.path();
  return fs.readFileSync(p);
}

export async function fetchBuffer(url: string): Promise<{ status: number; buf: Buffer; headers: Headers }> {
  const res = await fetch(url);
  return { status: res.status, buf: Buffer.from(await res.arrayBuffer()), headers: res.headers };
}
