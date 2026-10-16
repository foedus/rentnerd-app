import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const FACES = [
  { file: "tinos-latin-400-normal.woff2", weight: 400, style: "normal" },
  { file: "tinos-latin-400-italic.woff2", weight: 400, style: "italic" },
  { file: "tinos-latin-700-normal.woff2", weight: 700, style: "normal" },
  { file: "tinos-latin-700-italic.woff2", weight: 700, style: "italic" },
] as const;

let cached: string | undefined;

/** `@font-face` rules for the bundled Tinos font with the files inlined as data: URLs (§8.2: no network in Chromium). */
export function tinosFontCss(): string {
  if (cached) return cached;
  const require = createRequire(import.meta.url);
  const dir = require.resolve("@fontsource/tinos/package.json").replace(/package\.json$/, "files/");
  cached = FACES.map(({ file, weight, style }) => {
    const data = readFileSync(dir + file).toString("base64");
    return `@font-face{font-family:"Tinos";font-weight:${weight};font-style:${style};src:url(data:font/woff2;base64,${data}) format("woff2")}`;
  }).join("");
  return cached;
}
