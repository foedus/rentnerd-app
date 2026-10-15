import { useId, useState, type ReactNode } from "react";
import { Button, Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import { fieldLabel } from "../../shared/form-messages";
import { formatCents, pageCount, parseMoneyToCents } from "../../shared/format";

interface ConfirmDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  /** Text of the button that closes without confirming; "Cancel" unless the spec words it differently. */
  cancelLabel?: string;
  onConfirm: () => void;
}

/** Confirmation for destructive actions (SPEC §11). Focus starts on "Cancel", Escape closes, focus returns to the opener. */
export function ConfirmDialog({ isOpen, onOpenChange, title, children, confirmLabel, cancelLabel = "Cancel", onConfirm }: ConfirmDialogProps) {
  return (
    <ModalOverlay isOpen={isOpen} onOpenChange={onOpenChange} isDismissable className="fixed inset-0 z-50 grid place-items-center bg-black/40">
      <Modal className="max-w-md rounded bg-white p-6 shadow-lg">
        <Dialog className="space-y-4 outline-none">
          {({ close }) => (
            <>
              <Heading slot="title" className="text-lg font-semibold">
                {title}
              </Heading>
              <div>{children}</div>
              <div className="flex justify-end gap-2">
                <Button autoFocus onPress={close} className="min-h-6 rounded border px-4 py-1">
                  {cancelLabel}
                </Button>
                <Button
                  onPress={() => {
                    close();
                    onConfirm();
                  }}
                  className="min-h-6 rounded bg-red-800 px-4 py-1 text-white"
                >
                  {confirmLabel}
                </Button>
              </div>
            </>
          )}
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}

interface ReasonButtonProps {
  children: ReactNode;
  onPress: () => void;
  /** When set, the button is unavailable: it stays focusable, does nothing, and this text is its accessible description. */
  unavailableReason?: string;
  className?: string;
}

/** A button that explains why it is unavailable (SPEC §11): `aria-disabled` plus an accessible description. */
export function ReasonButton({ children, onPress, unavailableReason, className = "min-h-6 rounded border px-4 py-1" }: ReasonButtonProps) {
  const reasonId = useId();
  return (
    <>
      <button
        type="button"
        aria-disabled={unavailableReason ? true : undefined}
        aria-describedby={unavailableReason ? reasonId : undefined}
        onClick={() => {
          if (!unavailableReason) onPress();
        }}
        className={`${className}${unavailableReason ? " opacity-60" : ""}`}
      >
        {children}
      </button>
      {unavailableReason && (
        <span id={reasonId} className="sr-only">
          {unavailableReason}
        </span>
      )}
    </>
  );
}

interface MoneyInputProps {
  id: string;
  label: string;
  required?: boolean;
  /** Integer cents, or null when empty or not yet valid. */
  value: number | null;
  onChange: (cents: number | null) => void;
  /** Called with the typed text after onChange, e.g. to tell an empty field from text that isn't an amount. */
  onTextChange?: (text: string) => void;
  error?: string;
}

/** Accepts "2150", "2,150" or "2150.00"; shows "$2,150.00" once the field is left (SPEC §11). */
export function MoneyInput({ id, label, required = false, value, onChange, onTextChange, error }: MoneyInputProps) {
  const [text, setText] = useState(value === null ? "" : formatCents(value));
  const errorId = `${id}-error`;
  return (
    <div>
      <label htmlFor={id} className="block">
        {fieldLabel(label, required)}
      </label>
      {error && (
        <p id={errorId} className="text-red-700">
          {error}
        </p>
      )}
      <input
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={text}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onChange={(e) => {
          setText(e.target.value);
          onChange(parseMoneyToCents(e.target.value));
          onTextChange?.(e.target.value);
        }}
        onBlur={() => {
          const cents = parseMoneyToCents(text);
          if (cents !== null) setText(formatCents(cents));
        }}
        className="mt-1 block min-h-6 w-full rounded border px-3 py-1"
      />
    </div>
  );
}

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
}

interface DataTableProps<T> {
  /** Accessible name of the table (the §11 table name). */
  name: string;
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  emptyMessage?: string;
  /** Extra rows at the bottom of the table, e.g. a total. */
  footer?: ReactNode;
}

/** Named table inside a keyboard-focusable, horizontally scrollable region. */
export function DataTable<T>({ name, columns, rows, rowKey, emptyMessage, footer }: DataTableProps<T>) {
  return (
    <div role="region" aria-label={`${name} (scrollable)`} tabIndex={0} className="overflow-x-auto">
      <table aria-label={name} className="w-full text-left">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" className="px-3 py-2">
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && emptyMessage ? (
            <tr>
              <td colSpan={columns.length} className="px-3 py-2">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={rowKey(row)} className="border-t">
                {columns.map((c) => (
                  <td key={c.key} className="px-3 py-2">
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
        {footer && <tfoot>{footer}</tfoot>}
      </table>
    </div>
  );
}

interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}

/** "Previous" / "Next" and "Page X of Y" (SPEC §11). Unavailable buttons stay focusable. */
export function Pagination({ page, pageSize, total, onPageChange }: PaginationProps) {
  const pages = pageCount(total, pageSize);
  return (
    <nav aria-label="Pagination" className="flex items-center gap-3">
      <ReasonButton onPress={() => onPageChange(page - 1)} unavailableReason={page <= 1 ? "You are on the first page" : undefined}>
        Previous
      </ReasonButton>
      <span aria-live="polite">{`Page ${page} of ${pages}`}</span>
      <ReasonButton onPress={() => onPageChange(page + 1)} unavailableReason={page >= pages ? "You are on the last page" : undefined}>
        Next
      </ReasonButton>
    </nav>
  );
}
