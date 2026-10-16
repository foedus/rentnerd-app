import { Fragment, Slice, type Node as PMNode, type Schema } from "@tiptap/pm/model";
import { findPlaceholder, placeholdersFor, type TemplateKind } from "../../shared/placeholders";

const TOKEN = /\{\{\s*([^{}\uFFFC]*?)\s*\}\}/g;
const OBJECT = "\uFFFC";

/** Replaces `{{key}}` tokens in one run of inline nodes, even when the token spans several text nodes (Word splits keys across formatting runs). Keys valid for the template type become chips. */
function chipifyInline(children: PMNode[], schema: Schema, allowed: ReadonlySet<string>): PMNode[] {
  const chip = schema.nodes.placeholder;
  const flat = children.map((c) => (c.isText ? (c.text ?? "") : OBJECT)).join("");
  if (!chip || !flat.includes("{{")) return children;
  const hits: { from: number; to: number; node: PMNode }[] = [];
  for (const m of flat.matchAll(TOKEN)) {
    const key = m[1] ?? "";
    const found = findPlaceholder(key);
    if (found && allowed.has(key)) hits.push({ from: m.index, to: m.index + m[0].length, node: chip.create({ key, label: found.label }) });
  }
  if (hits.length === 0) return children;
  const out: PMNode[] = [];
  let pos = 0;
  let h = 0;
  for (const child of children) {
    const size = child.isText ? (child.text ?? "").length : 1;
    const end = pos + size;
    let at = pos;
    while (at < end) {
      const hit = hits[h];
      if (!hit || hit.from >= end) {
        out.push(at === pos && end === pos + size ? child : child.cut(at - pos, end - pos));
        at = end;
      } else if (hit.from > at) {
        out.push(child.cut(at - pos, hit.from - pos));
        at = hit.from;
      } else {
        if (hit.from === at) out.push(hit.node);
        const stop = Math.min(hit.to, end);
        at = stop;
        if (hit.to <= end) h++;
      }
    }
    pos = end;
  }
  return out;
}

/** Turns `{{key}}` tokens in pasted content into placeholder chips (§8.4). */
export function chipifyPaste(slice: Slice, schema: Schema, kind: TemplateKind): Slice {
  const allowed = new Set(placeholdersFor(kind).map((p) => p.key));
  const map = (fragment: Fragment): Fragment => {
    const nodes: PMNode[] = [];
    fragment.forEach((child) => {
      nodes.push(child.isText ? child : child.copy(map(child.content)));
    });
    return Fragment.fromArray(fragment.firstChild?.isInline ? chipifyInline(nodes, schema, allowed) : nodes);
  };
  return new Slice(map(slice.content), slice.openStart, slice.openEnd);
}

const NOISE_ELEMENTS = "style, script, meta, link, title, xml";

/** Marks Word headers, footers, footnotes, endnotes, comments and shapes so they can be counted and dropped. */
function isWordExtra(el: Element): boolean {
  const style = el.getAttribute("style") ?? "";
  if (/mso-element:\s*(header|footer|footnote|endnote|comment|comment-list|footnote-list|endnote-list|textbox)/i.test(style)) return true;
  if (/^(v|o|w):/i.test(el.tagName) && !/^o:p$/i.test(el.tagName)) return true;
  return /^(MsoHeader|MsoFooter|MsoFootnoteText|MsoEndnoteText|MsoCommentText)$/.test(el.getAttribute("class") ?? "") || /^(sdfootnote|ftn|edn|_ftn|_edn|_cmnt)/i.test(el.getAttribute("id") ?? "");
}

/** Cleans pasted HTML before the editor parses it (§8.4): drops images, shapes, headers, footers, footnotes, comments and hyperlinks (keeping link text), splits merged cells and unwraps tracked-change markup. Returns the cleaned HTML and whether anything was removed. */
export function cleanPastedHtml(html: string): { html: string; removed: boolean } {
  const doc = new DOMParser().parseFromString(html, "text/html");
  let removed = false;
  doc.querySelectorAll(NOISE_ELEMENTS).forEach((el) => el.remove());
  doc.body.querySelectorAll("[style]").forEach((el) => {
    if (/mso-list:\s*ignore/i.test(el.getAttribute("style") ?? "")) el.remove();
  });
  doc.body.querySelectorAll("*").forEach((el) => {
    if (/^o:p$/i.test(el.tagName)) el.replaceWith(...Array.from(el.childNodes));
    else if (el.isConnected && isWordExtra(el)) {
      removed = true;
      el.remove();
    }
  });
  doc.body.querySelectorAll("img, picture, svg, canvas, object, embed, iframe, video, audio").forEach((el) => {
    removed = true;
    el.remove();
  });
  doc.body.querySelectorAll("a, ins, del").forEach((el) => {
    if (el.tagName === "DEL") {
      removed = true;
      el.remove();
      return;
    }
    if (el.tagName === "A" && el.hasAttribute("href")) removed = true;
    el.replaceWith(...Array.from(el.childNodes));
  });
  doc.body.querySelectorAll("td[colspan], th[colspan], td[rowspan], th[rowspan]").forEach((cell) => {
    const span = Number(cell.getAttribute("colspan") ?? "1");
    if (span > 1 || Number(cell.getAttribute("rowspan") ?? "1") > 1) removed = true;
    cell.removeAttribute("colspan");
    cell.removeAttribute("rowspan");
    for (let i = 1; i < span && i < 50; i++) cell.after(doc.createElement(cell.tagName.toLowerCase()));
  });
  const comments: Node[] = [];
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_COMMENT);
  while (walker.nextNode()) comments.push(walker.currentNode);
  comments.forEach((c) => c.parentNode?.removeChild(c));
  return { html: doc.body.innerHTML, removed };
}
