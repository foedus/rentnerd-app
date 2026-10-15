import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Button } from "react-aria-components";
import { useFormContext } from "react-hook-form";
import { COMPLIANCE_APPLIES_TO, COMPLIANCE_SCHEDULE_LABELS, MONTH_NAMES, describeSchedule } from "../../shared/compliance-rules";
import { createComplianceTypeSchema } from "../../shared/compliance-schemas";
import { UNEXPECTED_MESSAGE } from "../../shared/form-messages";
import { UnauthenticatedError } from "../api";
import { AppForm, CheckboxInput, FormMessageError, SelectInput, TextFieldInput, useAppForm, VersionConflictError } from "../components/forms";
import { ConfirmDialog, DataTable, type Column } from "../components/ui";
import {
  createComplianceType,
  deleteComplianceType,
  fetchComplianceTypes,
  MissingItemError,
  setComplianceTypeArchived,
  StaleItemError,
  TypeRefusedError,
  updateComplianceType,
  type ComplianceTypeRecord,
} from "../compliance-api";
import { useCanWrite } from "../me";
import { DialogShell } from "./PropertyCompliance";

const TYPES_KEY = ["compliance-types"] as const;
const smallButton = "min-h-6 rounded border px-3 py-1";
const NOTICE = "Default dates are starting points. Check current requirements with the relevant agency; RentNerd does not provide legal advice.";
const SCHEDULE_OPTIONS = Object.entries(COMPLIANCE_SCHEDULE_LABELS).map(([value, label]) => ({ value, label }));
const MONTH_OPTIONS = MONTH_NAMES.map((label, i) => ({ value: String(i + 1), label }));

type Dialog = { kind: "form"; type?: ComplianceTypeRecord; draft?: Record<string, unknown> } | { kind: "delete"; type: ComplianceTypeRecord };

/** The schedule fields that belong to the chosen Schedule. */
function ScheduleFields() {
  const { watch } = useFormContext();
  const schedule = watch("scheduleType");
  return (
    <>
      {schedule === "annual_date" && (
        <>
          <SelectInput name="dueMonth" label="Month" options={MONTH_OPTIONS} />
          <TextFieldInput name="dueDay" label="Day" numeric />
        </>
      )}
      {schedule === "interval" && <TextFieldInput name="intervalMonths" label="Repeat every (months)" numeric />}
    </>
  );
}

function TypeForm({ type, draft, onDone, onStale }: { type?: ComplianceTypeRecord; draft?: Record<string, unknown>; onDone: () => void; onStale: (draft: Record<string, unknown>) => void }) {
  const queryClient = useQueryClient();
  const form = useAppForm(createComplianceTypeSchema, {
    name: type?.name ?? "",
    description: type?.description ?? "",
    appliesTo: type?.appliesTo ?? "",
    nycOnly: type?.nycOnly ?? false,
    scheduleType: type?.scheduleType ?? "",
    dueMonth: type?.dueMonth != null ? String(type.dueMonth) : "",
    dueDay: type?.dueDay ?? null,
    intervalMonths: type?.intervalMonths ?? null,
    ...draft,
  } as never);
  return (
    <AppForm
      form={form}
      thing="Item type"
      idPrefix="item-type-"
      submitLabel="Save item type"
      secondary={
        <Button onPress={onDone} className="min-h-6 rounded border px-4 py-1">
          Cancel
        </Button>
      }
      onReload={() => onStale(form.getValues() as Record<string, unknown>)}
      save={async (values) => {
        try {
          if (type) await updateComplianceType(type.id, type.version, values);
          else await createComplianceType(values);
        } catch (err) {
          if (err instanceof StaleItemError) throw new VersionConflictError();
          if (err instanceof TypeRefusedError) throw new FormMessageError(err.message);
          if (err instanceof MissingItemError) throw new FormMessageError("This item type no longer exists. Cancel to see the latest list.");
          if (err instanceof UnauthenticatedError) {
            void queryClient.invalidateQueries({ queryKey: ["me"] });
            throw new FormMessageError("Your session has ended. Sign in again to continue.");
          }
          throw err;
        }
        // Items were added to or changed on every property.
        await queryClient.invalidateQueries();
        onDone();
      }}
    >
      <TextFieldInput name="name" label="Name" required />
      <TextFieldInput name="description" label="Description" />
      <SelectInput name="appliesTo" label="Applies to" options={COMPLIANCE_APPLIES_TO} required />
      <CheckboxInput name="nycOnly" label="New York City properties only" />
      <SelectInput name="scheduleType" label="Schedule" options={SCHEDULE_OPTIONS} required />
      <ScheduleFields />
    </AppForm>
  );
}

/** Compliance → Item types (§11.18). */
export function ItemTypes() {
  const canWrite = useCanWrite();
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [message, setMessage] = useState("");
  const tableArea = useRef<HTMLDivElement>(null);
  const types = useQuery({ queryKey: TYPES_KEY, queryFn: fetchComplianceTypes });

  const refresh = () => queryClient.invalidateQueries();
  /** Runs an action on a type and shows a refusal as a message instead of failing silently. */
  async function run(action: () => Promise<void>) {
    setMessage("");
    try {
      await action();
    } catch (err) {
      setMessage(err instanceof TypeRefusedError ? err.message : err instanceof StaleItemError ? "This item type was changed by someone else. The list has been reloaded." : err instanceof MissingItemError ? "This item type no longer exists. The list has been reloaded." : UNEXPECTED_MESSAGE);
    }
    await refresh();
    // A deleted row takes the focused button with it; keep keyboard users at the table.
    setTimeout(() => {
      if (document.activeElement === document.body || document.activeElement === null) tableArea.current?.querySelector<HTMLElement>("[role=region]")?.focus();
    }, 50);
  }
  async function reopen(current: Dialog, draft: Record<string, unknown>) {
    await refresh();
    const fresh = current.kind === "form" && current.type ? (await queryClient.fetchQuery({ queryKey: TYPES_KEY, queryFn: fetchComplianceTypes, staleTime: 0 })).find((t) => t.id === current.type?.id) : undefined;
    setDialog(fresh ? { kind: "form", type: fresh, draft } : null);
  }

  const columns: Column<ComplianceTypeRecord>[] = [
    { key: "name", header: "Name", cell: (t) => (t.archivedAt ? `${t.name} (archived)` : t.name) },
    { key: "applies", header: "Applies to", cell: (t) => t.appliesTo },
    { key: "nyc", header: "NYC only", cell: (t) => (t.nycOnly ? "Yes" : "No") },
    { key: "schedule", header: "Schedule", cell: (t) => describeSchedule(t) },
    ...(canWrite
      ? [
          {
            key: "actions",
            header: "Actions",
            cell: (t: ComplianceTypeRecord) => (
              <div className="flex flex-wrap gap-2">
                {!t.archivedAt && (
                  <Button onPress={() => setDialog({ kind: "form", type: t })} aria-label={`Edit – ${t.name}`} className={smallButton}>
                    Edit
                  </Button>
                )}
                <Button onPress={() => void run(() => setComplianceTypeArchived(t.id, t.version, !t.archivedAt))} aria-label={`${t.archivedAt ? "Restore" : "Archive"} – ${t.name}`} className={smallButton}>
                  {t.archivedAt ? "Restore" : "Archive"}
                </Button>
                <Button onPress={() => setDialog({ kind: "delete", type: t })} aria-label={`Delete – ${t.name}`} className={smallButton}>
                  Delete
                </Button>
              </div>
            ),
          },
        ]
      : []),
  ];

  const close = () => setDialog(null);
  return (
    <>
      <p className="mb-4">{NOTICE}</p>
      {canWrite && (
        <Button onPress={() => setDialog({ kind: "form" })} className="mb-4 min-h-6 rounded bg-slate-900 px-4 py-1 text-white">
          Add item type
        </Button>
      )}
      <p role="alert" className="mb-4 text-red-700">
        {message}
      </p>
      {types.isError && (
        <div>
          <p role="alert">{types.error instanceof UnauthenticatedError ? "Your session has ended. Sign in again to continue." : types.error.message}</p>
          <Button onPress={() => void types.refetch()} className={smallButton}>
            Try again
          </Button>
        </div>
      )}
      {types.isPending && <p role="status">Loading…</p>}
      {types.data && (
        <div ref={tableArea}>
          <DataTable name="Item types" columns={columns} rows={types.data} rowKey={(t) => t.id} emptyMessage="No item types yet." />
        </div>
      )}
      {dialog?.kind === "form" && (
        <DialogShell title={dialog.type ? `Edit item type – ${dialog.type.name}` : "Add item type"} onClose={close}>
          <TypeForm key={`${dialog.type?.id ?? "new"}-${dialog.type?.version ?? 0}`} type={dialog.type} draft={dialog.draft} onDone={close} onStale={(draft) => void reopen(dialog, draft)} />
        </DialogShell>
      )}
      <ConfirmDialog
        isOpen={dialog?.kind === "delete"}
        onOpenChange={(open) => !open && close()}
        title={dialog?.kind === "delete" ? `Delete ${dialog.type.name}?` : "Delete item type?"}
        confirmLabel="Delete"
        onConfirm={() => {
          if (dialog?.kind === "delete") void run(() => deleteComplianceType((dialog as { type: ComplianceTypeRecord }).type.id));
        }}
      >
        This removes the item type from every property. It can't be undone. An item type with completions can't be deleted; archive it instead.
      </ConfirmDialog>
    </>
  );
}
