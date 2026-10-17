import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { UNEXPECTED_MESSAGE } from "../../shared/form-messages";
import { formatCents, formatDate } from "../../shared/format";
import { LEASE_STATUS_LABELS, type LeaseStatus } from "../../shared/lease";
import { fetchPropertyNames } from "../compliance-api";
import { fetchLeases, type LeaseListRow } from "../leases-api";
import { Page } from "../components/Page";
import { DataTable, Pagination, type Column } from "../components/ui";
import { linkClass } from "./Owners";

/** The Status checkboxes (§11.17); "Ended" also covers leases ended because a later lease replaced them. */
export const STATUS_FILTERS: { label: string; codes: LeaseStatus[] }[] = [
  { label: LEASE_STATUS_LABELS.upcoming, codes: ["upcoming"] },
  { label: LEASE_STATUS_LABELS.active, codes: ["active"] },
  { label: LEASE_STATUS_LABELS.month_to_month, codes: ["month_to_month"] },
  { label: LEASE_STATUS_LABELS.needs_decision, codes: ["needs_decision"] },
  { label: LEASE_STATUS_LABELS.ended, codes: ["ended", "ended_superseded"] },
];

const DEFAULT_CHECKED = STATUS_FILTERS.map((f) => f.label).filter((l) => l !== LEASE_STATUS_LABELS.ended);

const columns: Column<LeaseListRow>[] = [
  {
    key: "property",
    header: "Property",
    cell: (l) => (
      <Link to={`/leases/${l.id}`} className={`${linkClass} break-words`} aria-label={`${l.propertyName ?? "Lease"}, unit ${l.unitLabel ?? "–"}`}>
        <span className="break-all">{l.propertyName ?? "–"}</span>
      </Link>
    ),
  },
  {
    key: "unit",
    header: "Unit",
    cell: (l) => (
      <Link to={`/units/${l.unitId}`} className={linkClass}>
        {l.unitLabel ?? "–"}
      </Link>
    ),
  },
  { key: "tenants", header: "Tenants", cell: (l) => <span className="break-words">{l.currentTenants.map((t) => t.displayName).join(", ") || "–"}</span> },
  { key: "start", header: "Start", cell: (l) => formatDate(l.startDate) },
  { key: "end", header: "Effective end", cell: (l) => formatDate(l.effectiveEndDate) },
  { key: "rent", header: "Current rent", cell: (l) => formatCents(l.currentRentCents) },
  { key: "status", header: "Status", cell: (l) => l.statusLabel },
];

export function Leases() {
  const [checked, setChecked] = useState<string[]>(DEFAULT_CHECKED);
  const [archived, setArchived] = useState(false);
  const [propertyId, setPropertyId] = useState("");
  const [page, setPage] = useState(1);
  const status = STATUS_FILTERS.filter((f) => checked.includes(f.label)).flatMap((f) => f.codes);
  const properties = useQuery({ queryKey: ["compliance-property-names"], queryFn: fetchPropertyNames });
  // Nothing checked would mean "no filter" to the server, so it is answered here with an empty list.
  const leases = useQuery({
    queryKey: ["leases", status, archived, propertyId, page],
    queryFn: () => (status.length === 0 ? Promise.resolve({ data: [], page: 1, pageSize: 50, total: 0 }) : fetchLeases({ status, propertyId, archived, page })),
    placeholderData: (previous) => previous,
  });
  return (
    <Page title="Leases">
      <div className="mb-4 flex flex-wrap items-end gap-4">
        <fieldset className="flex flex-wrap items-center gap-4">
          <legend className="mb-1">Status</legend>
          {STATUS_FILTERS.map((f) => (
            <label key={f.label} className="flex min-h-6 items-center gap-2">
              <input
                type="checkbox"
                checked={checked.includes(f.label)}
                onChange={(e) => {
                  setChecked(e.target.checked ? [...checked, f.label] : checked.filter((l) => l !== f.label));
                  setPage(1);
                }}
              />
              {f.label}
            </label>
          ))}
        </fieldset>
        <label className="flex min-h-6 items-center gap-2">
          <input
            type="checkbox"
            checked={archived}
            onChange={(e) => {
              setArchived(e.target.checked);
              setPage(1);
            }}
          />
          Show archived
        </label>
        <div className="min-w-0 max-w-full">
          <label htmlFor="lease-property" className="block">
            Property
          </label>
          <select
            id="lease-property"
            value={propertyId}
            onChange={(e) => {
              setPropertyId(e.target.value);
              setPage(1);
            }}
            className="mt-1 block min-h-6 w-64 max-w-full rounded border px-3 py-1"
          >
            <option value="">All properties</option>
            {properties.data?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p role="status" className="sr-only">
        {leases.data ? `${leases.data.total} ${leases.data.total === 1 ? "lease" : "leases"} shown.` : ""}
      </p>
      {leases.isPending && <p role="status">Loading…</p>}
      {leases.isError && <p role="alert">{leases.error instanceof Error ? leases.error.message : UNEXPECTED_MESSAGE}</p>}
      {leases.data && (
        <>
          <DataTable name="Leases" columns={columns} rows={leases.data.data} rowKey={(l) => l.id} emptyMessage="No leases match these filters." />
          <Pagination page={leases.data.page} pageSize={leases.data.pageSize} total={leases.data.total} onPageChange={setPage} />
        </>
      )}
    </Page>
  );
}
