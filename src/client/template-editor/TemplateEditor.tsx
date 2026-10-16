import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Button, Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import { placeholdersFor, type TemplateKind } from "../../shared/placeholders";
import { EMPTY_DOC, templateExtensions } from "./extensions";
import { chipifyPaste } from "./paste";

const barButton = "min-h-6 min-w-6 rounded border px-2 py-1 aria-pressed:bg-slate-200";

interface Command {
  label: string;
  run: (editor: Editor) => void;
  /** Present for controls that switch a format on and off. */
  active?: (editor: Editor) => boolean;
  /** Table cells hold text only (§8.4), so these can't be used inside a table. */
  notInTable?: boolean;
}

/** New blocks go after the selection, so a command never wipes the selected text. */
const insertAfterSelection = (editor: Editor, content: Record<string, unknown>) => editor.chain().insertContentAt(editor.state.selection.to, content).run();

const COMMANDS: Command[] = [
  { label: "Heading 1", run: (e) => e.chain().toggleHeading({ level: 1 }).run(), active: (e) => e.isActive("heading", { level: 1 }) },
  { label: "Heading 2", run: (e) => e.chain().toggleHeading({ level: 2 }).run(), active: (e) => e.isActive("heading", { level: 2 }) },
  { label: "Bold", run: (e) => e.chain().toggleBold().run(), active: (e) => e.isActive("bold") },
  { label: "Italic", run: (e) => e.chain().toggleItalic().run(), active: (e) => e.isActive("italic") },
  { label: "Underline", run: (e) => e.chain().toggleUnderline().run(), active: (e) => e.isActive("underline") },
  { label: "Numbered list", notInTable: true, run: (e) => e.chain().toggleOrderedList().run(), active: (e) => e.isActive("orderedList") },
  { label: "Bulleted list", notInTable: true, run: (e) => e.chain().toggleBulletList().run(), active: (e) => e.isActive("bulletList") },
  { label: "Align center", run: (e) => e.chain().toggleTextAlign("center").run(), active: (e) => e.isActive({ textAlign: "center" }) },
  { label: "Page break", notInTable: true, run: (e) => insertAfterSelection(e, { type: "pageBreak" }) },
  { label: "Insert table", notInTable: true, run: (e) => e.chain().insertTable({ rows: 3, cols: 3, withHeaderRow: false }).run() },
];
const PLACEHOLDER_LABEL = "Insert placeholder";

/** Searchable list of the chip labels valid for the template type (§11.20). */
function PlaceholderPicker({ kind, isOpen, onClose, onPick }: { kind: TemplateKind; isOpen: boolean; onClose: () => void; onPick: (key: string, label: string) => void }) {
  const [search, setSearch] = useState("");
  useEffect(() => {
    if (!isOpen) setSearch("");
  }, [isOpen]);
  const wanted = search.trim().toLowerCase();
  const choices = placeholdersFor(kind).filter((p) => p.label.toLowerCase().includes(wanted));
  return (
    <ModalOverlay isOpen={isOpen} onOpenChange={(open) => !open && onClose()} isDismissable className="fixed inset-0 z-50 grid place-items-center bg-black/40">
      <Modal className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded bg-white p-6 shadow-lg">
        <Dialog className="space-y-3 outline-none" aria-label="Insert placeholder">
          <Heading slot="title" className="text-lg font-semibold">
            Insert placeholder
          </Heading>
          <div>
            <label htmlFor="placeholder-search" className="block">
              Search placeholders
            </label>
            <input id="placeholder-search" type="search" autoFocus value={search} onChange={(e) => setSearch(e.target.value)} className="mt-1 block min-h-6 w-full rounded border px-3 py-1" />
          </div>
          <p role="status" className="sr-only">{`${choices.length} placeholders`}</p>
          <ul className="space-y-1">
            {choices.map((p) => (
              <li key={p.key}>
                <button type="button" onClick={() => onPick(p.key, p.label)} className="min-h-6 w-full rounded border px-3 py-1 text-left">
                  {p.label}
                </button>
              </li>
            ))}
          </ul>
          {choices.length === 0 && <p>No placeholders match your search.</p>}
          <Button onPress={onClose} className="min-h-6 rounded border px-4 py-1">
            Close
          </Button>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}

/** One Tab stop for the whole toolbar; the arrow keys move between controls (WAI-ARIA toolbar). */
function Toolbar({ editor, kind, readOnly }: { editor: Editor; kind: TemplateKind; readOnly: boolean }) {
  const [current, setCurrent] = useState(0);
  const [picking, setPicking] = useState(false);
  const bar = useRef<HTMLDivElement>(null);
  const pressed = useEditorState({ editor, selector: ({ editor: e }) => COMMANDS.map((c) => (c.active ? c.active(e) : undefined)) });
  const inTable = useEditorState({ editor, selector: ({ editor: e }) => e.isActive("table") });
  const total = COMMANDS.length + 1;
  const move = (to: number) => {
    const next = (to + total) % total;
    setCurrent(next);
    bar.current?.querySelectorAll<HTMLButtonElement>("button")[next]?.focus();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "ArrowRight") move(current + 1);
    else if (e.key === "ArrowLeft") move(current - 1);
    else if (e.key === "Home") move(0);
    else if (e.key === "End") move(total - 1);
    else return;
    e.preventDefault();
  };
  const props = (i: number) => ({
    type: "button" as const,
    tabIndex: i === current ? 0 : -1,
    disabled: readOnly,
    onFocus: () => setCurrent(i),
    // Keep the editor's selection when a control is clicked with the mouse.
    onMouseDown: (e: React.MouseEvent) => e.preventDefault(),
    className: barButton,
  });
  return (
    <div ref={bar} role="toolbar" aria-label="Formatting" aria-orientation="horizontal" onKeyDown={onKeyDown} className="mb-2 flex flex-wrap gap-1">
      {COMMANDS.map((c, i) => (
        <button key={c.label} {...props(i)} aria-label={c.label} aria-pressed={pressed[i]} aria-disabled={c.notInTable && inTable ? true : undefined} title={c.notInTable && inTable ? "Not available inside a table" : undefined} onClick={() => !(c.notInTable && inTable) && c.run(editor)}>
          {c.label}
        </button>
      ))}
      <button {...props(COMMANDS.length)} aria-label={PLACEHOLDER_LABEL} aria-haspopup="dialog" onClick={() => setPicking(true)}>
        {PLACEHOLDER_LABEL}
      </button>
      <PlaceholderPicker
        kind={kind}
        isOpen={picking}
        onClose={() => setPicking(false)}
        onPick={(key, label) => {
          setPicking(false);
          editor.chain().focus().insertContent({ type: "placeholder", attrs: { key, label } }).run();
        }}
      />
    </div>
  );
}

/** The TipTap editor with its toolbar. `onChange` gets the TipTap JSON after every edit. */
export function TemplateEditor({ kind, content, readOnly = false, id, describedBy, onChange }: { kind: TemplateKind; content?: Record<string, unknown>; readOnly?: boolean; id?: string; describedBy?: string; onChange: (doc: Record<string, unknown>) => void }) {
  const editor = useEditor({
    extensions: templateExtensions,
    content: content ?? EMPTY_DOC,
    editable: !readOnly,
    editorProps: {
      transformPasted: (slice, view) => chipifyPaste(slice, view.state.schema, kind),
      attributes: {
        "aria-label": "Template content",
        "aria-multiline": "true",
        role: "textbox",
        class: "template-content min-h-48 rounded border bg-white p-3",
        ...(id ? { id } : {}),
        ...(describedBy ? { "aria-describedby": describedBy, "aria-invalid": "true" } : {}),
      },
    },
    onUpdate: ({ editor: e }) => onChange(e.getJSON() as Record<string, unknown>),
    immediatelyRender: false,
    // The default stylesheet is injected inline, which the Content Security Policy blocks; styles.css carries what is needed.
    injectCSS: false,
  });
  useEffect(() => {
    editor?.setEditable(!readOnly);
  }, [editor, readOnly]);
  if (!editor) return null;
  return (
    <div>
      <Toolbar editor={editor} kind={kind} readOnly={readOnly} />
      <EditorContent editor={editor} />
    </div>
  );
}
