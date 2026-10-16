import { findPlaceholder, type TemplateKind } from "./placeholders";

/** §8.4 allowed template content, checked on the server in the TipTap JSON shape the editor stores. */
export type TemplateContentProblem = { unrecognised: string[]; structure: string[]; empty: boolean };

const MAX_NODES = 50_000;
const MAX_DEPTH = 12;
const TOKEN = /\{\{\s*([^{}]*?)\s*\}\}/g;
const MARKS = new Set(["bold", "italic", "underline"]);
const LISTS = new Set(["bulletList", "orderedList"]);
const BLOCKS = new Set(["paragraph", "heading", "bulletList", "orderedList", "table", "pageBreak"]);

type Node = { type?: unknown; attrs?: unknown; content?: unknown; marks?: unknown; text?: unknown };
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Attribute names each node may carry; null and default values are ignored (TipTap writes them). */
const ATTRS: Record<string, string[]> = {
  paragraph: ["textAlign"],
  heading: ["level", "textAlign"],
  orderedList: ["start", "type"],
  tableCell: ["colspan", "rowspan", "colwidth"],
  tableHeader: ["colspan", "rowspan", "colwidth"],
  placeholder: ["key", "label"],
};

/** Checks content against §8.4 for a template kind; collects every problem instead of stopping at the first. */
export function checkTemplateContent(doc: unknown, kind: TemplateKind): TemplateContentProblem {
  const result: TemplateContentProblem = { unrecognised: [], structure: [], empty: true };
  const seen = new Set<string>();
  let nodes = 0;
  const bad = (message: string) => {
    if (!result.structure.includes(message)) result.structure.push(message);
  };
  /** Records a key that is unknown, or extension-only inside a master lease template. */
  const unknownKey = (token: string, key: string) => {
    const found = findPlaceholder(key);
    if (found && !(found.extensionOnly && kind === "master_lease")) return;
    const text = found ? `${token} (only available in Lease extension templates)` : token;
    if (!seen.has(text)) {
      seen.add(text);
      result.unrecognised.push(text);
    }
  };

  const walk = (node: unknown, parent: string, depth: number) => {
    if (!isObject(node)) return bad("Content must be made of nodes.");
    if (++nodes > MAX_NODES || depth > MAX_DEPTH) return bad("The content is too large or too deeply nested.");
    const { type, attrs, content, marks, text } = node as Node;
    if (typeof type !== "string") return bad("Every node needs a type.");
    const children = content === undefined ? [] : Array.isArray(content) ? content : (bad("Node content must be a list."), []);

    if (isObject(attrs)) {
      const allowed = ATTRS[type] ?? [];
      for (const [name, value] of Object.entries(attrs)) {
        if (value === null || value === undefined || allowed.includes(name)) continue;
        bad(`Unsupported setting “${name}”.`);
      }
      if (attrs.textAlign !== undefined && attrs.textAlign !== null && attrs.textAlign !== "left" && attrs.textAlign !== "center") bad("Only centre alignment is allowed.");
      for (const span of ["colspan", "rowspan"]) if (attrs[span] !== undefined && attrs[span] !== null && attrs[span] !== 1) bad("Merged table cells aren't allowed.");
    } else if (attrs !== undefined && attrs !== null) bad("Node settings must be an object.");

    if (Array.isArray(marks)) {
      for (const m of marks) if (!isObject(m) || typeof m.type !== "string" || !MARKS.has(m.type)) bad("Only bold, italic and underline formatting is allowed.");
      if (type !== "text" && marks.length > 0) bad("Formatting can only be applied to text.");
    } else if (marks !== undefined) bad("Formatting must be a list.");

    switch (type) {
      case "text": {
        if (typeof text !== "string") return bad("Text nodes need text.");
        if (parent !== "paragraph" && parent !== "heading") bad("Text must be in a paragraph or heading.");
        if (text.trim() !== "") result.empty = false;
        for (const m of text.matchAll(TOKEN)) unknownKey(`{{${m[1] ?? ""}}}`, m[1] ?? "");
        if (children.length > 0) bad("Text can't have content.");
        return;
      }
      case "placeholder": {
        const key = isObject(attrs) && typeof attrs.key === "string" ? attrs.key : "";
        if (!["paragraph", "heading"].includes(parent)) bad("Placeholders must be in a paragraph or heading.");
        result.empty = false;
        unknownKey(`{{${key}}}`, key);
        return;
      }
      case "hardBreak":
      case "pageBreak":
        if (children.length > 0) bad("This item can't have content.");
        if (type === "pageBreak" && parent !== "doc") bad("A page break must sit between paragraphs.");
        return;
      case "doc":
        if (parent !== "") bad("Unexpected document inside content.");
        if (children.length === 0) return;
        for (const child of children) if (!isObject(child) || !BLOCKS.has(String(child.type))) bad("Unsupported content: only text, lists, tables and page breaks are allowed.");
        break;
      case "paragraph":
        if (!["doc", "listItem", "tableCell", "tableHeader"].includes(parent)) bad("Paragraphs are misplaced.");
        break;
      case "heading": {
        const level = isObject(attrs) ? attrs.level : undefined;
        if (parent !== "doc") bad("Headings must be at the top level.");
        if (level !== 1 && level !== 2) bad("Only Heading 1 and Heading 2 are allowed.");
        break;
      }
      case "bulletList":
      case "orderedList":
        if (!["doc", "listItem"].includes(parent)) bad("Lists are misplaced.");
        if (children.length === 0 || children.some((c) => !isObject(c) || c.type !== "listItem")) bad("Lists contain list items only.");
        break;
      case "listItem":
        if (!LISTS.has(parent)) bad("List items must be in a list.");
        if (children.some((c) => !isObject(c) || !["paragraph", "bulletList", "orderedList"].includes(String(c.type)))) bad("List items contain paragraphs and nested lists only.");
        break;
      case "table":
        if (parent !== "doc") bad("Tables must be at the top level.");
        if (children.length === 0 || children.some((c) => !isObject(c) || c.type !== "tableRow")) bad("Tables contain rows only.");
        break;
      case "tableRow":
        if (parent !== "table") bad("Rows must be in a table.");
        if (children.some((c) => !isObject(c) || (c.type !== "tableCell" && c.type !== "tableHeader"))) bad("Rows contain cells only.");
        break;
      case "tableCell":
      case "tableHeader":
        if (parent !== "tableRow") bad("Cells must be in a row.");
        if (children.some((c) => !isObject(c) || c.type !== "paragraph")) bad("Table cells contain text only.");
        break;
      default:
        return bad("Unsupported content: only text, lists, tables and page breaks are allowed.");
    }
    for (const child of children) walk(child, type, depth + 1);
  };

  if (!isObject(doc) || doc.type !== "doc") bad("Content must be a document.");
  else walk(doc, "", 0);
  return result;
}

/** The field error for a template's content, or null when it is acceptable (§6.11, §8.4). */
export function templateContentError(doc: unknown, kind: TemplateKind): string | null {
  const r = checkTemplateContent(doc, kind);
  if (r.unrecognised.length > 0) return `Unrecognised placeholders: ${r.unrecognised.join(", ")}`;
  if (r.structure.length > 0) return r.structure[0] ?? "This content isn't allowed.";
  if (r.empty) return "Enter the template text.";
  return null;
}
