import { Editor } from "@tiptap/core";
import { expect, it } from "vitest";
import { checkTemplateContent } from "../../shared/template-content";
import { templateExtensions } from "./extensions";

const make = () => new Editor({ extensions: templateExtensions, content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Keyboard text" }] }] } });

it("produces only content the server accepts for every toolbar command", () => {
  const editor = make();
  editor.commands.selectAll();
  editor.chain().toggleHeading({ level: 2 }).toggleBold().toggleItalic().toggleUnderline().toggleTextAlign("center").run();
  editor.chain().insertContentAt(editor.state.doc.content.size, { type: "pageBreak" }).run();
  editor.commands.setTextSelection(2);
  editor.chain().insertTable({ rows: 2, cols: 2, withHeaderRow: false }).run();
  editor.chain().insertContent({ type: "placeholder", attrs: { key: "tenant_names", label: "Tenant names" } }).run();
  const json = editor.getJSON();
  const problem = checkTemplateContent(json, "master_lease");
  expect(problem.structure).toEqual([]);
  expect(problem.unrecognised).toEqual([]);
  expect(JSON.stringify(json)).toContain("pageBreak");
  expect(JSON.stringify(json)).toContain("tableCell");
  editor.destroy();
});

it("makes lists", () => {
  const editor = make();
  editor.commands.selectAll();
  editor.chain().toggleOrderedList().run();
  expect(JSON.stringify(editor.getJSON())).toContain("orderedList");
  editor.chain().toggleBulletList().run();
  expect(JSON.stringify(editor.getJSON())).toContain("bulletList");
  expect(checkTemplateContent(editor.getJSON(), "master_lease").structure).toEqual([]);
  editor.destroy();
});

it("has no link, code, image or strike formatting to offer", () => {
  const names = make().extensionManager.extensions.map((e) => e.name);
  for (const banned of ["link", "code", "codeBlock", "blockquote", "horizontalRule", "strike", "image"]) expect(names).not.toContain(banned);
});

it("lets Tab leave a table instead of adding rows from its last cell", () => {
  const editor = make();
  editor.chain().insertTable({ rows: 1, cols: 1, withHeaderRow: false }).run();
  const rows = () => JSON.stringify(editor.getJSON()).split("tableRow").length;
  const before = rows();
  const table = editor.extensionManager.extensions.find((e) => e.name === "table");
  const shortcuts = (table?.config.addKeyboardShortcuts as (this: { editor: Editor }) => Record<string, () => boolean>).call({ editor });
  // In the last cell there is no next cell: the key is left to the browser, which moves focus on.
  expect(shortcuts.Tab?.()).toBe(false);
  expect(rows()).toBe(before);
  editor.destroy();
});
