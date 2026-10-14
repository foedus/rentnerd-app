import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Button, Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import { UNEXPECTED_MESSAGE } from "../../shared/form-messages";
import { formatCents, formatDate } from "../../shared/format";
import { createPropertyValueSchema, VALUE_KIND_LABELS, VALUE_KINDS } from "../../shared/schemas";
import { TooManyRequestsError, UnauthenticatedError } from "../api";
import { AppForm, MoneyFieldInput, SelectInput, TextFieldInput, useAppForm, VersionConflictError } from "../components/forms";
import { ConfirmDialog, DataTable, type Column } from "../components/ui";
import { useCanWrite } from "../me";
import {
  deletePropertyValue,
  fetchPropertyValues,
  savePropertyValue,
  StaleValueError,
  type CurrentValue,
  type PropertyRecord,
  type PropertyValueRecord,
} from "../properties-api";

/** "$950,000.00" with its basis, "Market estimate Jun 1, 2026" or "Purchase price" (D-15). */
export function currentValueText(v: CurrentValue | null | undefined): { amount: string; basis: string } | null {
  if (!v) return null;
  return { amount: formatCents(v.amountCents), basis: v.basis.kind === "market_estimate" ? `Market estimate ${formatDate(v.basis.date)}` : "Purchase price" };
}

const kindOptions = VALUE_KINDS.map((k) => ({ value: k, label: VALUE_KIND_LABELS[k] }));

function ValueFields({ propertyId, value, onDone }: { propertyId: string; value?: PropertyValueRecord; onDone: () => void }) {
  const queryClient = useQueryClient();
  const form = useAppForm(createPropertyValueSchema, { valueDate: value?.valueDate ?? "", kind: value?.kind ?? "", amountCents: value?.amountCents ?? null, source: value?.source ?? "" } as never);
  return (
    <AppForm
      form={form}
      thing="Value"
      idPrefix="value-dialog-"
      submitLabel="Save value"
      secondary={
        <Button onPress={onDone} className="min-h-6 rounded border px-4 py-1">
          Cancel
        </Button>
      }
      onReload={() => void queryClient.invalidateQueries({ queryKey: ["property-values", propertyId] }).then(onDone)}
      save={async (values) => {
        try {
          await savePropertyValue(values, value ? { id: value.id, version: value.version } : { propertyId });
        } catch (err) {
          if (err instanceof StaleValueError) throw new VersionConflictError();
          throw err;
        }
        await queryClient.invalidateQueries({ queryKey: ["property-values", propertyId] });
        await queryClient.invalidateQueries({ queryKey: ["property", propertyId] });
        onDone();
      }}
    >
      <TextFieldInput name="valueDate" label="Date" type="date" required />
      <SelectInput name="kind" label="Value type" options={kindOptions} required />
      <MoneyFieldInput name="amountCents" label="Amount" required />
      <TextFieldInput name="source" label="Source / notes" />
    </AppForm>
  );
}

/** The Values tab (§11.9): current value summary, history table and the Add/Edit dialog. */
export function ValuesTab({ property }: { property: PropertyRecord }) {
  const canWrite = useCanWrite();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<PropertyValueRecord | "new" | null>(null);
  const [deleting, setDeleting] = useState<PropertyValueRecord | null>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const values = useQuery({ queryKey: ["property-values", property.id], queryFn: () => fetchPropertyValues(property.id), gcTime: 0 });
  const signedOut = values.error instanceof UnauthenticatedError;
  useEffect(() => {
    if (signedOut) void queryClient.invalidateQueries({ queryKey: ["me"] });
  }, [signedOut, queryClient]);
  const current = currentValueText(property.currentValue);
  const writable = canWrite && !property.archivedAt;
  const columns: Column<PropertyValueRecord>[] = [
    { key: "date", header: "Date", cell: (v) => formatDate(v.valueDate) },
    { key: "kind", header: "Value type", cell: (v) => VALUE_KIND_LABELS[v.kind] },
    { key: "amount", header: "Amount", cell: (v) => formatCents(v.amountCents) },
    { key: "source", header: "Source / notes", cell: (v) => v.source || "—" },
    ...(writable
      ? [
          {
            key: "actions",
            header: "Actions",
            cell: (v: PropertyValueRecord) => (
              <div className="flex gap-2">
                <Button onPress={() => setEditing(v)} aria-label={`Edit ${VALUE_KIND_LABELS[v.kind]} ${formatDate(v.valueDate)}`} className="min-h-6 rounded border px-3 py-1">
                  Edit
                </Button>
                <Button onPress={() => { setDeleteError(null); setDeleting(v); }} aria-label={`Delete ${VALUE_KIND_LABELS[v.kind]} ${formatDate(v.valueDate)}`} className="min-h-6 rounded border px-3 py-1">
                  Delete
                </Button>
              </div>
            ),
          },
        ]
      : []),
  ];
  return (
    <>
      <h2 className="mb-2 text-xl font-semibold">Values</h2>
      <p className="mb-4">
        Current value: <strong>{current ? current.amount : "—"}</strong>
        {current && <span> ({current.basis})</span>}
      </p>
      {writable && (
        <Button ref={addButton} onPress={() => setEditing("new")} className="mb-4 min-h-6 rounded bg-slate-900 px-4 py-1 text-white">
          Add value
        </Button>
      )}
      {deleteError && <p role="alert" className="mb-2 text-red-700">{deleteError}</p>}
      {values.isPending && <p role="status">Loading…</p>}
      {values.isError && (
        <div>
          <p role="alert">{values.error.message}</p>
          <Button onPress={() => void values.refetch()} className="mt-2 min-h-6 rounded border px-3 py-1">
            Try again
          </Button>
        </div>
      )}
      {values.data && <DataTable name="Values" columns={columns} rows={values.data} rowKey={(v) => v.id} emptyMessage="No values yet." />}
      <ModalOverlay isOpen={editing !== null} onOpenChange={(open) => !open && setEditing(null)} className="fixed inset-0 z-50 grid place-items-center bg-black/40">
        <Modal className="max-h-[90vh] w-full max-w-md overflow-auto rounded bg-white p-6 shadow-lg">
          <Dialog aria-label={editing === "new" ? "Add value" : "Edit value"} className="space-y-4 outline-none">
            <Heading slot="title" className="text-lg font-semibold">
              {editing === "new" ? "Add value" : "Edit value"}
            </Heading>
            {editing && <ValueFields propertyId={property.id} value={editing === "new" ? undefined : editing} onDone={() => setEditing(null)} />}
          </Dialog>
        </Modal>
      </ModalOverlay>
      <ConfirmDialog
        isOpen={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete this value?"
        confirmLabel="Delete value"
        onConfirm={() => {
          const target = deleting;
          if (!target) return;
          deletePropertyValue(target.id)
            .then(async () => {
              await queryClient.invalidateQueries({ queryKey: ["property-values", property.id] });
              await queryClient.invalidateQueries({ queryKey: ["property", property.id] });
              // The deleted row's button is gone; keep keyboard users in the tab.
              addButton.current?.focus();
            })
            .catch((err: unknown) => setDeleteError(err instanceof TooManyRequestsError ? err.message : UNEXPECTED_MESSAGE));
        }}
      >
        {deleting && <p>{VALUE_KIND_LABELS[deleting.kind]} of {formatCents(deleting.amountCents)} dated {formatDate(deleting.valueDate)} will be removed from the history.</p>}
      </ConfirmDialog>
    </>
  );
}
