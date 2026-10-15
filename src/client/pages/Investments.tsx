import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Button } from "react-aria-components";
import { useFormContext } from "react-hook-form";
import { Link } from "react-router";
import { UNEXPECTED_MESSAGE } from "../../shared/form-messages";
import { formatCents, formatDate } from "../../shared/format";
import { createInvestmentSchema, INVESTMENT_CATEGORIES } from "../../shared/schemas";
import { TooManyRequestsError, UnauthenticatedError } from "../api";
import { AppForm, FormMessageError, MoneyFieldInput, SelectInput, TextFieldInput, useAppForm, VersionConflictError } from "../components/forms";
import { Page } from "../components/Page";
import { ConfirmDialog, DataTable, Pagination, type Column } from "../components/ui";
import { fetchPropertyNames } from "../compliance-api";
import {
  deleteInvestment,
  fetchInvestments,
  InvestmentRefusedError,
  saveInvestment,
  StaleInvestmentError,
  type InvestmentRecord,
} from "../investments-api";
import { useCanWrite } from "../me";
import { fetchPropertyUnits } from "../properties-api";
import { linkClass } from "./Owners";
import { DialogShell } from "./PropertyCompliance";

const smallButton = "min-h-6 rounded border px-3 py-1";
const inputClass = "mt-1 block min-h-6 max-w-full rounded border px-3 py-1";
const INVESTMENTS_KEY = ["investments"] as const;

/** The Unit choices follow the chosen Property (§11.21): "Whole property" first, then that property's units. */
function UnitSelect({ current }: { current: { id: string; label: string; propertyId: string } | null }) {
  const { watch, setValue } = useFormContext();
  const propertyId = String(watch("propertyId") ?? "");
  const unitId = String(watch("unitId") ?? "");
  const units = useQuery({ queryKey: ["property-units", propertyId, false], queryFn: () => fetchPropertyUnits(propertyId, false), enabled: propertyId !== "", gcTime: 0 });
  const options = (units.data ?? []).map((u) => ({ value: u.id, label: u.label }));
  // An entry on a unit that has since been archived keeps showing it until another is chosen.
  if (current && current.propertyId === propertyId && units.data && !options.some((o) => o.value === current.id)) options.push({ value: current.id, label: current.label });
  // Another property's unit can't stay selected.
  const stale = unitId !== "" && (propertyId === "" || (units.data !== undefined && !options.some((o) => o.value === unitId)));
  useEffect(() => {
    if (stale) setValue("unitId", "", { shouldDirty: true });
  }, [stale, setValue]);
  // Re-created when the choices arrive, so the browser applies the saved unit to the now-existing option.
  return <SelectInput key={options.map((o) => o.value).join()} name="unitId" label="Unit" options={options} emptyLabel="Whole property" />;
}

function EntryForm({ entry, propertyId, onSaved, onCancel }: { entry?: InvestmentRecord; propertyId?: string; onSaved: () => void; onCancel: () => void }) {
  const queryClient = useQueryClient();
  const properties = useQuery({ queryKey: ["compliance-property-names"], queryFn: fetchPropertyNames });
  const form = useAppForm(createInvestmentSchema, {
    entryDate: entry?.entryDate ?? "",
    propertyId: entry?.propertyId ?? propertyId ?? "",
    unitId: entry?.unitId ?? "",
    category: entry?.category ?? "",
    description: entry?.description ?? "",
    vendor: entry?.vendor ?? "",
    costCents: entry?.costCents ?? null,
  } as never);
  const names = (properties.data ?? []).map((p) => ({ value: p.id, label: p.name }));
  if (entry && !names.some((n) => n.value === entry.propertyId)) names.push({ value: entry.propertyId, label: entry.propertyName });
  return (
    <AppForm
      form={form}
      thing="Entry"
      idPrefix="investment-dialog-"
      submitLabel="Save entry"
      secondary={
        <Button onPress={onCancel} className="min-h-6 rounded border px-4 py-1">
          Cancel
        </Button>
      }
      onReload={() => void queryClient.invalidateQueries({ queryKey: INVESTMENTS_KEY }).then(onCancel)}
      save={async (values) => {
        try {
          await saveInvestment(values, entry ? { id: entry.id, version: entry.version } : undefined);
        } catch (err) {
          if (err instanceof StaleInvestmentError) throw new VersionConflictError();
          if (err instanceof InvestmentRefusedError) throw new FormMessageError(err.message);
          throw err;
        }
        await queryClient.invalidateQueries({ queryKey: INVESTMENTS_KEY });
        await queryClient.invalidateQueries({ queryKey: ["property"] });
        onSaved();
      }}
    >
      <TextFieldInput name="entryDate" label="Date" type="date" required />
      {/* Re-created when the choices arrive, so the browser applies the pre-filled property to the now-existing option. */}
      <SelectInput key={names.map((n) => n.value).join()} name="propertyId" label="Property" options={names} required />
      <UnitSelect current={entry?.unitId ? { id: entry.unitId, label: entry.unitLabel ?? "", propertyId: entry.propertyId } : null} />
      <SelectInput name="category" label="Category" options={INVESTMENT_CATEGORIES} required />
      <TextFieldInput name="description" label="Description" required />
      <TextFieldInput name="vendor" label="Vendor" />
      <MoneyFieldInput name="costCents" label="Cost" required />
    </AppForm>
  );
}

/** The investment log (§11.21), for every property or, with `propertyId`, for one property's tab (§11.9). */
export function InvestmentsPanel({ propertyId, canAdd = true }: { propertyId?: string; canAdd?: boolean }) {
  const canWrite = useCanWrite();
  const queryClient = useQueryClient();
  const [property, setProperty] = useState("");
  const [category, setCategory] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<InvestmentRecord | "new" | null>(null);
  const [deleting, setDeleting] = useState<InvestmentRecord | null>(null);
  const [message, setMessage] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const filters = { propertyId: propertyId ?? property, category, from, to, page };
  const properties = useQuery({ queryKey: ["compliance-property-names"], queryFn: fetchPropertyNames, enabled: propertyId === undefined });
  const list = useQuery({ queryKey: [...INVESTMENTS_KEY, filters], queryFn: () => fetchInvestments(filters), placeholderData: (previous) => previous });
  const signedOut = list.error instanceof UnauthenticatedError;
  useEffect(() => {
    if (signedOut) void queryClient.invalidateQueries({ queryKey: ["me"] });
  }, [signedOut, queryClient]);
  // Deleting the last entry of the last page leaves that page empty.
  useEffect(() => {
    if (list.data && list.data.data.length === 0 && page > 1 && !list.isPlaceholderData) setPage(page - 1);
  }, [list.data, list.isPlaceholderData, page]);
  const filter = (set: (v: string) => void) => (e: { target: { value: string } }) => {
    set(e.target.value);
    setPage(1);
    setMessage("");
  };

  const columns: Column<InvestmentRecord>[] = [
    { key: "date", header: "Date", cell: (e) => formatDate(e.entryDate) },
    {
      key: "property",
      header: "Property",
      cell: (e) => (
        <Link to={`/properties/${e.propertyId}`} className={linkClass}>
          {e.propertyName}
        </Link>
      ),
    },
    { key: "unit", header: "Unit", cell: (e) => e.unitLabel ?? "Whole property" },
    { key: "category", header: "Category", cell: (e) => e.category },
    { key: "description", header: "Description", cell: (e) => <span id={`investment-${e.id}`} className="break-words">{e.description}</span> },
    { key: "vendor", header: "Vendor", cell: (e) => e.vendor || "—" },
    { key: "cost", header: "Cost", cell: (e) => formatCents(e.costCents) },
    ...(canWrite
      ? [
          {
            key: "actions",
            header: "Actions",
            cell: (e: InvestmentRecord) => (
              <div className="flex gap-2">
                <Button onPress={() => { setMessage(""); setEditing(e); }} aria-describedby={`investment-${e.id}`} className={smallButton}>
                  Edit
                </Button>
                <Button onPress={() => { setMessage(""); setDeleteError(null); setDeleting(e); }} aria-describedby={`investment-${e.id}`} className={smallButton}>
                  Delete
                </Button>
              </div>
            ),
          },
        ]
      : []),
  ];
  const total = list.data?.totalCents ?? 0;
  const close = () => setEditing(null);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end gap-4">
        {propertyId === undefined && (
          <div className="min-w-0 max-w-full">
            <label htmlFor="investment-property" className="block">
              Property
            </label>
            <select id="investment-property" value={property} onChange={filter(setProperty)} className={inputClass}>
              <option value="">All properties</option>
              {properties.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label htmlFor="investment-category" className="block">
            Category
          </label>
          <select id="investment-category" value={category} onChange={filter(setCategory)} className={inputClass}>
            <option value="">All categories</option>
            {INVESTMENT_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="investment-from" className="block">
            From
          </label>
          <input id="investment-from" type="date" value={from} onChange={filter(setFrom)} className={inputClass} />
        </div>
        <div>
          <label htmlFor="investment-to" className="block">
            To
          </label>
          <input id="investment-to" type="date" value={to} onChange={filter(setTo)} className={inputClass} />
        </div>
        {canWrite && canAdd && (
          <Button ref={addButton} onPress={() => { setMessage(""); setEditing("new"); }} className="min-h-6 rounded bg-slate-900 px-4 py-1 text-white">
            Add entry
          </Button>
        )}
      </div>
      <p role="status" className={message ? "mb-2 text-green-800" : "sr-only"}>
        {message}
      </p>
      {from && to && from > to && <p role="alert" className="mb-2 text-red-700">From can't be after To.</p>}
      {deleteError && <p role="alert" className="mb-2 text-red-700">{deleteError}</p>}
      {list.isPending && <p role="status">Loading…</p>}
      {list.isError && (
        <div>
          <p role="alert">{list.error instanceof UnauthenticatedError ? "Your session has ended." : list.error.message}</p>
          <Button onPress={() => void list.refetch()} className="mt-2 min-h-6 rounded border px-3 py-1">
            Try again
          </Button>
        </div>
      )}
      {list.data && (
        <>
          <DataTable
            name="Investments"
            columns={columns}
            rows={list.data.data}
            rowKey={(e) => e.id}
            emptyMessage="No entries yet."
            footer={
              <tr className="border-t font-semibold">
                <th scope="row" colSpan={columns.length - (canWrite ? 2 : 1)} className="px-3 py-2 text-left">
                  Total
                </th>
                <td className="px-3 py-2">{formatCents(total)}</td>
                {canWrite && <td />}
              </tr>
            }
          />
          {list.data.total > list.data.pageSize && (
            <div className="mt-4">
              <Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPageChange={setPage} />
            </div>
          )}
        </>
      )}
      {editing && (
        <DialogShell title={editing === "new" ? "Add entry" : "Edit entry"} onClose={close}>
          <EntryForm
            entry={editing === "new" ? undefined : editing}
            propertyId={propertyId}
            onCancel={close}
            onSaved={() => {
              close();
              setMessage("Entry saved.");
            }}
          />
        </DialogShell>
      )}
      <ConfirmDialog
        isOpen={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete this entry?"
        confirmLabel="Delete entry"
        onConfirm={() => {
          const target = deleting;
          if (!target) return;
          deleteInvestment(target.id)
            .then(async () => {
              await queryClient.invalidateQueries({ queryKey: INVESTMENTS_KEY });
              await queryClient.invalidateQueries({ queryKey: ["property"] });
              setMessage("Entry deleted.");
              addButton.current?.focus();
            })
            .catch((err: unknown) => setDeleteError(err instanceof TooManyRequestsError ? err.message : UNEXPECTED_MESSAGE));
        }}
      >
        {deleting && <p>“{deleting.description}” ({formatCents(deleting.costCents)}, {formatDate(deleting.entryDate)}) will be removed for good.</p>}
      </ConfirmDialog>
    </>
  );
}

export function Investments() {
  return (
    <Page title="Investments">
      <InvestmentsPanel />
    </Page>
  );
}
