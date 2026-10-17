import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { UNEXPECTED_MESSAGE } from "../../shared/form-messages";
import { formatCents, formatDate, pageCount } from "../../shared/format";
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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

const NO_LEASES = { data: [], page: 1, pageSize: 50, total: 0 };

export function Leases() {
  // The filters live in the address (?status=Active&archived=1&property=…&page=2) so Back, Reload and shared links keep them.
  // The page's own state answers clicks at once; the address follows (the router applies it in a deferred update).
  const [params, setParams] = useSearchParams();
  const [filters, setFilters] = useState(() => {
    const chosen = params.getAll("status");
    return {
      checked: chosen.length === 0 ? DEFAULT_CHECKED : chosen.filter((l) => l !== "none"),
      archived: params.get("archived") === "1",
      // A hand-typed or stale property that is not an id is ignored instead of reaching the server.
      propertyId: UUID.test(params.get("property") ?? "") ? (params.get("property") as string) : "",
      page: Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1),
    };
  });
  const { checked, archived, propertyId, page } = filters;
  const apply = (change: Partial<typeof filters>) => {
    const next = { ...filters, page: 1, ...change };
    setFilters(next);
    const query = new URLSearchParams();
    if (next.checked.join() !== DEFAULT_CHECKED.join()) for (const l of next.checked.length === 0 ? ["none"] : next.checked) query.append("status", l);
    if (next.archived) query.set("archived", "1");
    if (next.propertyId) query.set("property", next.propertyId);
    if (next.page > 1) query.set("page", String(next.page));
    setParams(query, { replace: true });
  };
  const setPage = (n: number) => apply({ page: n });
  const status = STATUS_FILTERS.filter((f) => checked.includes(f.label)).flatMap((f) => f.codes);
  const properties = useQuery({ queryKey: ["compliance-property-names"], queryFn: fetchPropertyNames });
  // Nothing checked would mean "no filter" to the server, so it is answered here, at once, with an empty list.
  const noStatus = status.length === 0;
  const leases = useQuery({
    queryKey: ["leases", status, archived, propertyId, page],
    queryFn: () => fetchLeases({ status, propertyId, archived, page }),
    placeholderData: (previous) => previous,
    enabled: !noStatus,
  });
  const data = noStatus ? NO_LEASES : leases.data;
  // A bookmarked page past the end (the list shrank) moves to the last page.
  const lastPage = leases.data ? Math.max(1, pageCount(leases.data.total, leases.data.pageSize)) : 1;
  useEffect(() => {
    if (leases.data && !leases.isPlaceholderData && page > lastPage) setPage(lastPage);
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
                onChange={(e) =>
                  // Keep the spec's order so the same selection always gives the same address.
                  apply({ checked: STATUS_FILTERS.map((x) => x.label).filter((l) => (l === f.label ? e.target.checked : checked.includes(l))) })
                }
              />
              {f.label}
            </label>
          ))}
        </fieldset>
        <label className="flex min-h-6 items-center gap-2">
          <input
            type="checkbox"
            checked={archived}
            onChange={(e) => apply({ archived: e.target.checked })}
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
            onChange={(e) => apply({ propertyId: e.target.value })}
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
        {data ? `${data.total} ${data.total === 1 ? "lease" : "leases"} shown.` : ""}
      </p>
      {!noStatus && leases.isPending && <p role="status">Loading…</p>}
      {!noStatus && leases.isError && <p role="alert">{leases.error instanceof Error ? leases.error.message : UNEXPECTED_MESSAGE}</p>}
      {data && (
        <>
          <DataTable name="Leases" columns={columns} rows={data.data} rowKey={(l) => l.id} emptyMessage="No leases match these filters." />
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPageChange={setPage} />
        </>
      )}
    </Page>
  );
}
