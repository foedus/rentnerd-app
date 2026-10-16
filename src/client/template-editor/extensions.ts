import { Node, mergeAttributes } from "@tiptap/core";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import TextAlign from "@tiptap/extension-text-align";
import StarterKit from "@tiptap/starter-kit";

/** A hard page break between blocks (§8.4); stored as `{type: "pageBreak"}`. */
export const PageBreak = Node.create({
  name: "pageBreak",
  group: "block",
  atom: true,
  selectable: true,
  parseHTML: () => [{ tag: "div[data-page-break]" }],
  renderHTML: ({ HTMLAttributes }) => ["div", mergeAttributes(HTMLAttributes, { "data-page-break": "", class: "template-page-break" }), "Page break"],
});

/** A placeholder chip (§8.1) shown as "[Chip label]"; stored as `{type: "placeholder", attrs: {key, label}}`. */
export const PlaceholderChip = Node.create({
  name: "placeholder",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes: () => ({ key: { default: "" }, label: { default: "" } }),
  parseHTML: () => [
    {
      tag: "span[data-placeholder]",
      getAttrs: (el) => ({ key: (el as HTMLElement).getAttribute("data-placeholder") ?? "", label: (el as HTMLElement).getAttribute("data-label") ?? "" }),
    },
  ],
  renderHTML: ({ node }) => ["span", { "data-placeholder": node.attrs.key, "data-label": node.attrs.label, class: "template-chip" }, `[${node.attrs.label}]`],
  renderText: ({ node }) => `[${node.attrs.label}]`,
});

/** Only what §8.4 allows: headings 1–2, bold/italic/underline, lists, centre alignment, simple tables, page breaks. */
export const templateExtensions = [
  StarterKit.configure({
    heading: { levels: [1, 2] },
    link: false,
    code: false,
    codeBlock: false,
    blockquote: false,
    horizontalRule: false,
    strike: false,
  }),
  TextAlign.configure({ types: ["heading", "paragraph"], alignments: ["left", "center"] }),
  // Tab moves between cells but never adds rows, so keyboard users can always Tab out of a table (WCAG 2.1.2).
  Table.extend({
    addKeyboardShortcuts() {
      return { Tab: () => this.editor.commands.goToNextCell(), "Shift-Tab": () => this.editor.commands.goToPreviousCell() };
    },
  }).configure({ resizable: false }),
  TableRow,
  TableHeader,
  TableCell,
  PageBreak,
  PlaceholderChip,
];

export const EMPTY_DOC = { type: "doc", content: [{ type: "paragraph" }] };
