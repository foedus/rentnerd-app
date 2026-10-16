import { Fragment, Slice, type Node as PMNode, type Schema } from "@tiptap/pm/model";
import { findPlaceholder, placeholdersFor, type TemplateKind } from "../../shared/placeholders";

const TOKEN = /\{\{\s*([^{}]*?)\s*\}\}/g;

/** Splits one text node on `{{key}}` tokens; keys valid for the template type become chips, anything else stays text. */
function chipifyText(node: PMNode, schema: Schema, allowed: ReadonlySet<string>): PMNode[] {
  const chip = schema.nodes.placeholder;
  const text = node.text ?? "";
  if (!chip || !text.includes("{{")) return [node];
  const out: PMNode[] = [];
  let last = 0;
  const flush = (to: number) => {
    if (to > last) out.push(node.cut(last, to));
  };
  for (const m of text.matchAll(TOKEN)) {
    const key = m[1] ?? "";
    const found = findPlaceholder(key);
    if (!found || !allowed.has(key)) continue;
    flush(m.index);
    out.push(chip.create({ key, label: found.label }));
    last = m.index + m[0].length;
  }
  flush(text.length);
  return out;
}

/** Turns `{{key}}` tokens in pasted content into placeholder chips (§8.4). */
export function chipifyPaste(slice: Slice, schema: Schema, kind: TemplateKind): Slice {
  const allowed = new Set(placeholdersFor(kind).map((p) => p.key));
  const map = (fragment: Fragment): Fragment => {
    const nodes: PMNode[] = [];
    fragment.forEach((child) => {
      if (child.isText) nodes.push(...chipifyText(child, schema, allowed));
      else nodes.push(child.copy(map(child.content)));
    });
    return Fragment.fromArray(nodes);
  };
  return new Slice(map(slice.content), slice.openStart, slice.openEnd);
}
