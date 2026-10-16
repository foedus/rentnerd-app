import { findPlaceholder } from "./placeholders";
import type { PlaceholderValue, PlaceholderValues } from "./template-values";

/** §8.1: a missing value prints as 10 underscores. */
export const BLANK = "__________";
const SIGNATURE_LINE = "______________________________";
const TOKEN = /\{\{\s*([^{}]*?)\s*\}\}/g;

export interface RenderedTemplate {
  /** Sanitised HTML for the PDF body: only the tags this renderer writes, every text escaped. */
  html: string;
  /** Chip labels of placeholders that have no value, in order of first use (AC-DOC-05). */
  blanks: string[];
}

type Json = { type?: unknown; attrs?: unknown; content?: unknown; marks?: unknown; text?: unknown };
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const MARK_TAGS: Record<string, string> = { bold: "strong", italic: "em", underline: "u" };

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const lines = (s: string): string => escapeHtml(s).replace(/\r\n|\r|\n/g, "<br>");
const isBlock = (v: PlaceholderValue): v is Exclude<PlaceholderValue, string> => typeof v !== "string";

function blockHtml(v: Exclude<PlaceholderValue, string>): string {
  if ("signatures" in v) return v.signatures.map((n) => `<p class="rn-signature">${SIGNATURE_LINE} Date: ${BLANK}<br>${escapeHtml(n)}</p>`).join("");
  const { head, rows } = v.table;
  const cells = (tag: string, row: string[]) => `<tr>${row.map((c) => `<${tag}>${escapeHtml(c)}</${tag}>`).join("")}</tr>`;
  return `<table class="rn-table"><thead>${cells("th", head)}</thead><tbody>${rows.map((r) => cells("td", r)).join("")}</tbody></table>`;
}

const isEmptyValue = (v: PlaceholderValue | null | undefined): boolean => {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") return v.trim() === "";
  return "signatures" in v ? v.signatures.length === 0 : v.table.rows.length === 0;
};

/** Renders a stored template (TipTap JSON, §8.4) with placeholder values to sanitised HTML. Unknown node types are dropped. */
export function renderTemplate(doc: unknown, values: PlaceholderValues): RenderedTemplate {
  const blanks: string[] = [];

  /** Inline HTML for a key, or a block value; unknown keys stay as typed. */
  const resolve = (key: string, literal: string): { inline: string } | { block: Exclude<PlaceholderValue, string> } => {
    const known = findPlaceholder(key);
    if (!known) return { inline: escapeHtml(literal) };
    const value = values[key];
    if (isEmptyValue(value)) {
      if (!blanks.includes(known.label)) blanks.push(known.label);
      return { inline: BLANK };
    }
    return isBlock(value!) ? { block: value } : { inline: lines(value as string) };
  };

  const wrap = (html: string, marks: unknown): string => {
    if (!Array.isArray(marks)) return html;
    return marks.reduce<string>((acc, m) => {
      const tag = isObject(m) && typeof m.type === "string" ? MARK_TAGS[m.type] : undefined;
      return tag ? `<${tag}>${acc}</${tag}>` : acc;
    }, html);
  };

  /** Inline children of a paragraph or heading; a block value ends the current element and stands alone. */
  const textBlock = (open: string, close: string, children: unknown[]): string => {
    let out = "";
    let pending = "";
    const flush = () => {
      if (pending !== "") out += `${open}${pending}${close}`;
      pending = "";
    };
    for (const child of children) {
      if (!isObject(child)) continue;
      const { type, text, marks, attrs } = child as Json;
      if (type === "hardBreak") pending += "<br>";
      else if (type === "text" && typeof text === "string") {
        let last = 0;
        const emit = (html: string) => (pending += wrap(html, marks));
        for (const m of text.matchAll(TOKEN)) {
          if (m.index > last) emit(escapeHtml(text.slice(last, m.index)));
          const r = resolve(m[1] ?? "", m[0]);
          if ("block" in r) {
            flush();
            out += blockHtml(r.block);
          }
          else emit(r.inline);
          last = m.index + m[0].length;
        }
        if (last < text.length) emit(escapeHtml(text.slice(last)));
      } else if (type === "placeholder" && isObject(attrs) && typeof attrs.key === "string") {
        const r = resolve(attrs.key, `{{${attrs.key}}}`);
        if ("block" in r) {
            flush();
            out += blockHtml(r.block);
          }
        else pending += wrap(r.inline, marks);
      }
    }
    if (out === "" && pending === "") pending = "<br>";
    flush();
    return out;
  };

  const alignClass = (attrs: unknown): string => (isObject(attrs) && attrs.textAlign === "center" ? ' class="rn-center"' : "");
  const kids = (n: Json): unknown[] => (Array.isArray(n.content) ? n.content : []);

  const block = (node: unknown): string => {
    if (!isObject(node)) return "";
    const n = node as Json;
    const children = kids(n);
    switch (n.type) {
      case "paragraph":
        return textBlock(`<p${alignClass(n.attrs)}>`, "</p>", children);
      case "heading": {
        const level = isObject(n.attrs) && n.attrs.level === 2 ? 2 : 1;
        return textBlock(`<h${level}${alignClass(n.attrs)}>`, `</h${level}>`, children);
      }
      case "bulletList":
      case "orderedList": {
        const tag = n.type === "bulletList" ? "ul" : "ol";
        const start = tag === "ol" && isObject(n.attrs) && Number.isInteger(n.attrs.start) && (n.attrs.start as number) > 1 ? ` start="${n.attrs.start}"` : "";
        return `<${tag}${start}>${children.map((li) => (isObject(li) && li.type === "listItem" ? `<li>${kids(li as Json).map(block).join("")}</li>` : "")).join("")}</${tag}>`;
      }
      case "table":
        return `<table class="rn-table"><tbody>${children.map(row).join("")}</tbody></table>`;
      case "pageBreak":
        return '<div class="rn-page-break"></div>';
      default:
        return "";
    }
  };

  const row = (r: unknown): string => {
    if (!isObject(r) || r.type !== "tableRow") return "";
    const cells = kids(r as Json).map((c) => {
      if (!isObject(c) || (c.type !== "tableCell" && c.type !== "tableHeader")) return "";
      const tag = c.type === "tableHeader" ? "th" : "td";
      return `<${tag}>${kids(c as Json).map(block).join("")}</${tag}>`;
    });
    return `<tr>${cells.join("")}</tr>`;
  };

  const html = isObject(doc) && doc.type === "doc" ? kids(doc as Json).map(block).join("") : "";
  return { html, blanks };
}
