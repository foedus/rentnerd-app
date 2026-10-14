import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Button, Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import { UNEXPECTED_MESSAGE } from "../../shared/form-messages";
import { formatCents } from "../../shared/format";
import { createPropertyTaxSchema } from "../../shared/schemas";
import { TooManyRequestsError, UnauthenticatedError } from "../api";
import { AppForm, FormMessageError, MoneyFieldInput, TextFieldInput, useAppForm, VersionConflictError } from "../components/forms";
import { ConfirmDialog, DataTable, type Column } from "../components/ui";
import { useCanWrite } from "../me";
import { deletePropertyTax, fetchPropertyTaxes, MissingTaxError, savePropertyTax, StaleTaxError, type PropertyRecord, type PropertyTaxRecord } from "../properties-api";

function TaxFields({ propertyId, tax, onDone, onReopen }: { propertyId: string; tax?: PropertyTaxRecord; onDone: () => void; onReopen: (t: PropertyTaxRecord) => void }) {
  const queryClient = useQueryClient();
  const form = useAppForm(createPropertyTaxSchema, { taxYear: tax?.taxYear ?? null, amountCents: tax?.amountCents ?? null } as never);
  return (
    <AppForm
      form={form}
      thing="Tax year"
      idPrefix="tax-dialog-"
      submitLabel="Save tax year"
      secondary={
        <Button onPress={onDone} className="min-h-6 rounded border px-4 py-1">
          Cancel
        </Button>
      }
      onReload={() =>
        // Show the latest saved values in the same dialog; if the year is gone, close it.
        void queryClient
          .fetchQuery({ queryKey: ["property-taxes", propertyId], queryFn: () => fetchPropertyTaxes(propertyId), staleTime: 0 })
          .then((rows) => {
            const fresh = tax && rows.find((r) => r.id === tax.id);
            if (fresh) onReopen(fresh);
            else onDone();
          })
          .catch(onDone)
      }
      save={async (values) => {
        try {
          await savePropertyTax(values, tax ? { id: tax.id, version: tax.version } : { propertyId });
        } catch (err) {
          if (err instanceof StaleTaxError) throw new VersionConflictError();
          if (err instanceof MissingTaxError) {
            void queryClient.invalidateQueries({ queryKey: ["property-taxes", propertyId] });
            throw new FormMessageError("This tax year no longer exists. It was deleted by someone else. Cancel to see the latest list.");
          }
          if (err instanceof UnauthenticatedError) {
            void queryClient.invalidateQueries({ queryKey: ["me"] });
            throw new FormMessageError("Your session has ended. Sign in again to continue.");
          }
          throw err;
        }
        await queryClient.invalidateQueries({ queryKey: ["property-taxes", propertyId] });
        onDone();
      }}
    >
      <TextFieldInput name="taxYear" label="Tax year" numeric required />
      <MoneyFieldInput name="amountCents" label="Annual property tax" required />
    </AppForm>
  );
}

/** The Property taxes tab (§11.9): tax years table and the Add/Edit dialog. */
export function TaxesTab({ property }: { property: PropertyRecord }) {
  const canWrite = useCanWrite();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<PropertyTaxRecord | "new" | null>(null);
  const [deleting, setDeleting] = useState<PropertyTaxRecord | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const taxes = useQuery({ queryKey: ["property-taxes", property.id], queryFn: () => fetchPropertyTaxes(property.id), gcTime: 0 });
  const signedOut = taxes.error instanceof UnauthenticatedError;
  useEffect(() => {
    if (signedOut) void queryClient.invalidateQueries({ queryKey: ["me"] });
  }, [signedOut, queryClient]);
  const writable = canWrite && !property.archivedAt;
  const columns: Column<PropertyTaxRecord>[] = [
    { key: "year", header: "Tax year", cell: (t) => String(t.taxYear) },
    { key: "amount", header: "Annual property tax", cell: (t) => formatCents(t.amountCents) },
    ...(writable
      ? [
          {
            key: "actions",
            header: "Actions",
            cell: (t: PropertyTaxRecord) => (
              <div className="flex gap-2">
                <Button onPress={() => setEditing(t)} aria-label={`Edit tax year ${t.taxYear}`} className="min-h-6 rounded border px-3 py-1">
                  Edit
                </Button>
                <Button onPress={() => { setDeleteError(null); setDeleting(t); }} aria-label={`Delete tax year ${t.taxYear}`} className="min-h-6 rounded border px-3 py-1">
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
      <h2 className="mb-2 text-xl font-semibold">Property taxes</h2>
      {writable && (
        <Button ref={addButton} onPress={() => setEditing("new")} className="mb-4 min-h-6 rounded bg-slate-900 px-4 py-1 text-white">
          Add tax year
        </Button>
      )}
      {deleteError && <p role="alert" className="mb-2 text-red-700">{deleteError}</p>}
      {taxes.isPending && <p role="status">Loading…</p>}
      {taxes.isError && (
        <div>
          <p role="alert">{taxes.error.message}</p>
          <Button onPress={() => void taxes.refetch()} className="mt-2 min-h-6 rounded border px-3 py-1">
            Try again
          </Button>
        </div>
      )}
      {taxes.data && <DataTable name="Property taxes" columns={columns} rows={taxes.data} rowKey={(t) => t.id} emptyMessage="No tax years yet." />}
      <ModalOverlay isOpen={editing !== null} onOpenChange={(open) => !open && setEditing(null)} className="fixed inset-0 z-50 grid place-items-center bg-black/40">
        <Modal className="max-h-[90vh] w-full max-w-md overflow-auto rounded bg-white p-6 shadow-lg">
          <Dialog aria-label={editing === "new" ? "Add tax year" : "Edit tax year"} className="space-y-4 outline-none">
            <Heading slot="title" className="text-lg font-semibold">
              {editing === "new" ? "Add tax year" : "Edit tax year"}
            </Heading>
            {editing && <TaxFields key={editing === "new" ? "new" : `${editing.id}-${editing.version}`} propertyId={property.id} tax={editing === "new" ? undefined : editing} onDone={() => setEditing(null)} onReopen={setEditing} />}
          </Dialog>
        </Modal>
      </ModalOverlay>
      <ConfirmDialog
        isOpen={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete this tax year?"
        confirmLabel="Delete tax year"
        onConfirm={() => {
          const target = deleting;
          if (!target) return;
          deletePropertyTax(target.id)
            .then(async () => {
              await queryClient.invalidateQueries({ queryKey: ["property-taxes", property.id] });
              // The deleted row's button is gone; keep keyboard users in the tab.
              addButton.current?.focus();
            })
            .catch((err: unknown) => {
              if (err instanceof UnauthenticatedError) void queryClient.invalidateQueries({ queryKey: ["me"] });
              setDeleteError(err instanceof TooManyRequestsError ? err.message : UNEXPECTED_MESSAGE);
            });
        }}
      >
        {deleting && <p>Tax year {deleting.taxYear} ({formatCents(deleting.amountCents)}) will be removed.</p>}
      </ConfirmDialog>
    </>
  );
}
