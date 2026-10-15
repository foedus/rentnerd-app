import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button, Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import { useFormContext } from "react-hook-form";
import { UNEXPECTED_MESSAGE } from "../../shared/form-messages";
import { suggestNextDueDate } from "../../shared/compliance";
import { createComplianceCompletionSchema, updateComplianceItemSchema } from "../../shared/compliance-schemas";
import { isValidYmd, todayNy } from "../../shared/dates";
import { formatDate } from "../../shared/format";
import { TooManyRequestsError, UnauthenticatedError } from "../api";
import { AppForm, FormMessageError, TextFieldInput, useAppForm, VersionConflictError } from "../components/forms";
import { ConfirmDialog, DataTable, type Column } from "../components/ui";
import {
  deleteCompletion,
  fetchCompletions,
  fetchPropertyCompliance,
  markComplianceDone,
  MissingItemError,
  StaleItemError,
  updateComplianceItem,
  type ComplianceItemRecord,
} from "../compliance-api";
import { useCanWrite } from "../me";
import type { PropertyRecord } from "../properties-api";

type Action = { kind: "done" | "due" | "history"; item: ComplianceItemRecord; draft?: Draft };

const smallButton = "min-h-6 rounded border px-3 py-1";
const queryKey = (propertyId: string) => ["property-compliance", propertyId];
type Refresh = readonly unknown[];
export type Draft = Record<string, unknown>;

/** Re-reads the lists under `refresh` and returns the current version of an item, so a stale form can be kept open with what was typed. */
export async function reloadedItem<T extends { id: string; version: number }>(queryClient: ReturnType<typeof useQueryClient>, refresh: Refresh, id: string): Promise<T | undefined> {
  await queryClient.invalidateQueries({ queryKey: refresh });
  // Older cached pages or filters may still hold a stale copy; the newest version is the current one.
  let latest: T | undefined;
  for (const [, cached] of queryClient.getQueriesData<T[] | { data?: T[] }>({ queryKey: refresh })) {
    const found = (Array.isArray(cached) ? cached : cached?.data)?.find((r) => r.id === id);
    if (found && (!latest || found.version > latest.version)) latest = found;
  }
  return latest;
}

export function DialogShell({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <ModalOverlay isOpen onOpenChange={(open) => !open && onClose()} className="fixed inset-0 z-50 grid place-items-center bg-black/40">
      <Modal className="max-h-[90vh] w-full max-w-lg overflow-auto rounded bg-white p-6 shadow-lg">
        <Dialog aria-label={title} className="space-y-4 outline-none">
          <Heading slot="title" className="text-lg font-semibold">
            {title}
          </Heading>
          {children}
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}

/** Keeps Next due date at the §9.3 suggestion while Completed on changes, until the person types their own date. */
function SuggestNextDue({ item, kept }: { item: ComplianceItemRecord; kept: boolean }) {
  const { watch, setValue, formState } = useFormContext();
  const completedOn = String(watch("completedOn") ?? "");
  const edited = Boolean(formState.dirtyFields.nextDueDate);
  useEffect(() => {
    if (edited || kept || !isValidYmd(completedOn)) return;
    setValue("nextDueDate", suggestNextDueDate({ ...item.type, nextDueDate: item.nextDueDate }, completedOn) ?? "");
  }, [completedOn, edited, kept, item, setValue]);
  return null;
}

function failure(err: unknown, refresh: Refresh, queryClient: ReturnType<typeof useQueryClient>): never {
  if (err instanceof StaleItemError) throw new VersionConflictError();
  if (err instanceof MissingItemError) {
    void queryClient.invalidateQueries({ queryKey: refresh });
    throw new FormMessageError("This item no longer exists. Cancel to see the latest list.");
  }
  if (err instanceof UnauthenticatedError) {
    void queryClient.invalidateQueries({ queryKey: ["me"] });
    throw new FormMessageError("Your session has ended. Sign in again to continue.");
  }
  throw err;
}

export function MarkDoneForm({ refresh, item, draft, onDone, onStale }: { refresh: Refresh; item: ComplianceItemRecord; draft?: Draft; onDone: () => void; onStale: (draft: Draft) => void }) {
  const queryClient = useQueryClient();
  const today = todayNy();
  const form = useAppForm(createComplianceCompletionSchema, { completedOn: today, notes: "", nextDueDate: suggestNextDueDate({ ...item.type, nextDueDate: item.nextDueDate }, today) ?? "", ...draft } as never);
  return (
    <AppForm
      form={form}
      thing="Completion"
      idPrefix="mark-done-"
      submitLabel="Save"
      secondary={
        <Button onPress={onDone} className="min-h-6 rounded border px-4 py-1">
          Cancel
        </Button>
      }
      onReload={() => onStale(form.getValues() as Draft)}
      save={async (values) => {
        const v = values as { completedOn: string; notes?: string | null; nextDueDate?: string | null };
        try {
          await markComplianceDone(item.id, { completedOn: v.completedOn, notes: v.notes ?? null, nextDueDate: v.nextDueDate ?? null, version: item.version });
        } catch (err) {
          failure(err, refresh, queryClient);
        }
        await queryClient.invalidateQueries({ queryKey: refresh });
        onDone();
      }}
    >
      <SuggestNextDue item={item} kept={draft !== undefined} />
      <TextFieldInput name="completedOn" label="Completed on" type="date" required />
      <TextFieldInput name="notes" label="Notes" />
      <TextFieldInput name="nextDueDate" label="Next due date" type="date" />
    </AppForm>
  );
}

const dueSchema = updateComplianceItemSchema.pick({ nextDueDate: true });

export function SetDueForm({ refresh, item, draft, onDone, onStale }: { refresh: Refresh; item: ComplianceItemRecord; draft?: Draft; onDone: () => void; onStale: (draft: Draft) => void }) {
  const queryClient = useQueryClient();
  const form = useAppForm(dueSchema, { nextDueDate: item.nextDueDate ?? "", ...draft } as never);
  return (
    <AppForm
      form={form}
      thing="Due date"
      idPrefix="set-due-"
      submitLabel="Save"
      secondary={
        <Button onPress={onDone} className="min-h-6 rounded border px-4 py-1">
          Cancel
        </Button>
      }
      onReload={() => onStale(form.getValues() as Draft)}
      save={async (values) => {
        try {
          await updateComplianceItem(item.id, item.version, { nextDueDate: (values as { nextDueDate?: string | null }).nextDueDate ?? null });
        } catch (err) {
          failure(err, refresh, queryClient);
        }
        await queryClient.invalidateQueries({ queryKey: refresh });
        onDone();
      }}
    >
      <TextFieldInput name="nextDueDate" label="Next due date" type="date" />
    </AppForm>
  );
}

function HistoryBody({ propertyId, item, canWrite, onClose }: { propertyId: string; item: ComplianceItemRecord; canWrite: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [deleting, setDeleting] = useState<{ id: string; completedOn: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const history = useQuery({ queryKey: ["compliance-completions", item.id], queryFn: () => fetchCompletions(item.id), gcTime: 0 });
  const columns: Column<NonNullable<typeof history.data>[number]>[] = [
    { key: "on", header: "Completed on", cell: (c) => formatDate(c.completedOn) },
    { key: "notes", header: "Notes", cell: (c) => c.notes ?? "" },
    { key: "by", header: "Completed by", cell: (c) => c.completedByName ?? "—" },
    ...(canWrite
      ? [
          {
            key: "actions",
            header: "Actions",
            cell: (c: { id: string; completedOn: string }) => (
              <Button onPress={() => { setError(null); setDeleting(c); }} aria-label={`Delete completion of ${formatDate(c.completedOn)}`} className={smallButton}>
                Delete
              </Button>
            ),
          },
        ]
      : []),
  ];
  return (
    <>
      {error && <p role="alert" className="text-red-700">{error}</p>}
      {history.isPending && <p role="status">Loading…</p>}
      {history.isError && (
        <div>
          <p role="alert">{history.error.message}</p>
          <Button onPress={() => void history.refetch()} className={smallButton}>
            Try again
          </Button>
        </div>
      )}
      {history.data && <DataTable name="Completion history" columns={columns} rows={history.data} rowKey={(c) => c.id} emptyMessage="No completions yet." />}
      <div className="flex justify-end">
        <Button ref={closeButton} autoFocus onPress={onClose} className="min-h-6 rounded border px-4 py-1">
          Close
        </Button>
      </div>
      <ConfirmDialog
        isOpen={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete this completion?"
        confirmLabel="Delete completion"
        onConfirm={() => {
          const target = deleting;
          if (!target) return;
          deleteCompletion(target.id)
            .then(async () => {
              await queryClient.invalidateQueries({ queryKey: ["compliance-completions", item.id] });
              await queryClient.invalidateQueries({ queryKey: queryKey(propertyId) });
              // The deleted row's button is gone; keep keyboard users in the dialog.
              closeButton.current?.focus();
            })
            .catch((err: unknown) => {
              if (err instanceof UnauthenticatedError) void queryClient.invalidateQueries({ queryKey: ["me"] });
              setError(err instanceof TooManyRequestsError ? err.message : UNEXPECTED_MESSAGE);
            });
        }}
      >
        {deleting && <p>The completion of {formatDate(deleting.completedOn)} will be removed.</p>}
      </ConfirmDialog>
    </>
  );
}

/** The Compliance tab (§11.9): one row per item with its switch, status and the Mark done / Set due date / History actions. */
export function ComplianceTab({ property }: { property: PropertyRecord }) {
  const canWrite = useCanWrite();
  const queryClient = useQueryClient();
  const [action, setAction] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);
  const items = useQuery({ queryKey: queryKey(property.id), queryFn: () => fetchPropertyCompliance(property.id), gcTime: 0 });
  const signedOut = items.error instanceof UnauthenticatedError;
  useEffect(() => {
    if (signedOut) void queryClient.invalidateQueries({ queryKey: ["me"] });
  }, [signedOut, queryClient]);
  const writable = canWrite && !property.archivedAt;
  const close = () => setAction(null);
  /** After a version conflict: reopen the dialog on the latest version of the item, keeping what was typed. */
  async function restart(current: Action, draft: Draft) {
    const fresh = await reloadedItem<ComplianceItemRecord>(queryClient, queryKey(property.id), current.item.id);
    setAction(fresh ? { kind: current.kind, item: fresh, draft } : null);
  }

  async function toggle(item: ComplianceItemRecord, applicable: boolean) {
    setError(null);
    try {
      await updateComplianceItem(item.id, item.version, { applicable });
    } catch (err) {
      if (err instanceof UnauthenticatedError) void queryClient.invalidateQueries({ queryKey: ["me"] });
      setError(err instanceof StaleItemError ? "This item was changed by someone else. The list has been refreshed; try again." : err instanceof TooManyRequestsError ? err.message : UNEXPECTED_MESSAGE);
    }
    await queryClient.invalidateQueries({ queryKey: queryKey(property.id) });
  }

  const columns: Column<ComplianceItemRecord>[] = [
    { key: "item", header: "Item", cell: (i) => i.type.name },
    {
      key: "applies",
      header: "Applies to this property",
      cell: (i) => (
        <label className="inline-flex min-h-6 items-center gap-2">
          <input type="checkbox" role="switch" checked={i.applicable} disabled={!writable} onChange={(e) => void toggle(i, e.target.checked)} aria-label={`Applies to this property – ${i.type.name}`} className="h-5 w-5" />
          <span>{i.applicable ? "On" : "Off"}</span>
        </label>
      ),
    },
    { key: "status", header: "Status", cell: (i) => i.status },
    { key: "due", header: "Due date", cell: (i) => (i.nextDueDate ? formatDate(i.nextDueDate) : "—") },
    { key: "last", header: "Last completed", cell: (i) => (i.lastCompletedOn ? formatDate(i.lastCompletedOn) : "—") },
    {
      key: "actions",
      header: "Actions",
      cell: (i) => (
        <div className="flex flex-wrap gap-2">
          {writable && (
            <>
              <Button onPress={() => setAction({ kind: "done", item: i })} aria-label={`Mark done – ${i.type.name}`} className={smallButton}>
                Mark done
              </Button>
              <Button onPress={() => setAction({ kind: "due", item: i })} aria-label={`Set due date – ${i.type.name}`} className={smallButton}>
                Set due date
              </Button>
            </>
          )}
          <Button onPress={() => setAction({ kind: "history", item: i })} aria-label={`History – ${i.type.name}`} className={smallButton}>
            History
          </Button>
        </div>
      ),
    },
  ];
  return (
    <>
      <h2 className="mb-2 text-xl font-semibold">Compliance</h2>
      {error && <p role="alert" className="mb-2 text-red-700">{error}</p>}
      {items.isPending && <p role="status">Loading…</p>}
      {items.isError && (
        <div>
          <p role="alert">{items.error.message}</p>
          <Button onPress={() => void items.refetch()} className="mt-2 min-h-6 rounded border px-3 py-1">
            Try again
          </Button>
        </div>
      )}
      {items.data && <DataTable name="Compliance" columns={columns} rows={items.data} rowKey={(i) => i.id} emptyMessage="No compliance items yet." />}
      {action?.kind === "done" && (
        <DialogShell title={`Mark done – ${action.item.type.name}`} onClose={close}>
          <MarkDoneForm key={`${action.item.id}-${action.item.version}`} refresh={queryKey(property.id)} item={action.item} draft={action.draft} onDone={close} onStale={(draft) => void restart(action, draft)} />
        </DialogShell>
      )}
      {action?.kind === "due" && (
        <DialogShell title={`Set due date – ${action.item.type.name}`} onClose={close}>
          <SetDueForm key={`${action.item.id}-${action.item.version}`} refresh={queryKey(property.id)} item={action.item} draft={action.draft} onDone={close} onStale={(draft) => void restart(action, draft)} />
        </DialogShell>
      )}
      {action?.kind === "history" && (
        <DialogShell title={`History – ${action.item.type.name}`} onClose={close}>
          <HistoryBody propertyId={property.id} item={action.item} canWrite={writable} onClose={close} />
        </DialogShell>
      )}
    </>
  );
}
