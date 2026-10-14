import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { Button } from "react-aria-components";
import { formatCents, formatDate } from "../../shared/format";
import { DataTable, type Column } from "../components/ui";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import { NotFound } from "../components/Notices";
import { Page } from "../components/Page";
import { UnauthenticatedError } from "../api";
import { useCanWrite } from "../me";
import { fetchUnit, UnitNotFoundError, type UnitLeaseInfo, type UnitRecord } from "../properties-api";

const orDash = (v: number | null | undefined) => (v == null ? "—" : String(v));

type HistoryRow = UnitLeaseInfo["history"][number];

const historyColumns: Column<HistoryRow>[] = [
  { key: "start", header: "Start", cell: (l) => <Link to={`/leases/${l.id}`} className="underline">{formatDate(l.startDate)}</Link> },
  { key: "end", header: "End", cell: (l) => formatDate(l.endDate) },
  { key: "tenants", header: "Tenants", cell: (l) => l.tenants.join(", ") || "–" },
  { key: "status", header: "Status", cell: (l) => l.statusLabel },
  { key: "rent", header: "Rent at end", cell: (l) => formatCents(l.rentAtEndCents) },
];

function LeaseCards({ info }: { info: UnitLeaseInfo }) {
  const current = info.currentLease;
  return (
    <>
      <section aria-labelledby="unit-current-lease" className="mb-6">
        <h2 id="unit-current-lease" className="mb-2 text-xl font-semibold">Current lease</h2>
        {current ? (
          <div className="break-words">
            <p>{current.tenants.join(", ") || "–"}</p>
            <p>{formatDate(current.startDate)} to {formatDate(current.endDate)}</p>
            <p>{current.statusLabel}</p>
            <Link to={`/leases/${current.id}`} className="inline-block min-h-6 underline">View lease</Link>
          </div>
        ) : (
          <p>No current lease.</p>
        )}
      </section>
      <section aria-labelledby="unit-lease-history" className="mb-6">
        <h2 id="unit-lease-history" className="mb-2 text-xl font-semibold">Lease history</h2>
        <DataTable name="Lease history" columns={historyColumns} rows={info.history} rowKey={(l) => l.id} emptyMessage="No leases yet." />
      </section>
    </>
  );
}

function UnitView({ unit }: { unit: UnitRecord }) {
  const navigate = useNavigate();
  const canWrite = useCanWrite();
  const flash = (useLocation().state as { saved?: string } | null)?.saved ?? "";
  const rows: [string, string][] = [
    ["Use", unit.use],
    ["Bedrooms", orDash(unit.bedrooms)],
    ["Bathrooms", orDash(unit.bathrooms)],
    ["Square feet", orDash(unit.squareFeet)],
    ["Owner", unit.owner ? (unit.ownerOverrideId ? `${unit.owner.name} (set for this unit, not the property's owner)` : unit.owner.name) : "—"],
    ["Status", unit.archivedAt ? "Archived" : (unit.lease?.statusText ?? "Vacant")],
  ];
  if (unit.lease?.occupied) rows.push(["Current rent", formatCents(unit.lease.currentRentCents ?? 0)]);
  else if (unit.lease?.potentialRentCents != null) rows.push(["Potential rent", formatCents(unit.lease.potentialRentCents)]);
  return (
    <Page title={`${unit.property?.name ?? "Property"} – Unit ${unit.label}`}>
      {flash && <p role="status">{flash}</p>}
      {unit.property && (
        <p className="mb-4">
          <Link to={`/properties/${unit.property.id}`} className="inline-block min-h-6 underline">
            Back to {unit.property.name}
          </Link>
        </p>
      )}
      <dl className="mb-6 grid max-w-xl grid-cols-[max-content_minmax(0,1fr)] gap-x-6 gap-y-1">
        {rows.map(([term, value]) => (
          <div key={term} className="contents">
            <dt className="font-semibold">{term}</dt>
            <dd className="break-words">{value}</dd>
          </div>
        ))}
      </dl>
      {unit.lease && <LeaseCards info={unit.lease} />}
      {canWrite && (
        <Button onPress={() => navigate(`/units/${unit.id}/edit`)} className="min-h-6 rounded border px-4 py-1">
          Edit unit
        </Button>
      )}
    </Page>
  );
}

/** /units/:id (§11.11): the summary only for now; lease cards and the Archive/Delete buttons come with later tasks. */
export function UnitDetail() {
  const { id } = useParams();
  const queryClient = useQueryClient();
  const unit = useQuery({ queryKey: ["unit", id], queryFn: () => fetchUnit(id ?? ""), gcTime: 0 });
  const alertRef = useRef<HTMLParagraphElement>(null);
  const signedOut = unit.error instanceof UnauthenticatedError;
  useEffect(() => {
    if (signedOut) void queryClient.invalidateQueries({ queryKey: ["me"] });
  }, [signedOut, queryClient]);
  useEffect(() => {
    if (unit.isError) alertRef.current?.focus();
  }, [unit.isError]);
  if (unit.isPending) return <Page title="Unit details"><p role="status">Loading…</p></Page>;
  if (unit.error instanceof UnitNotFoundError) return <NotFound />;
  if (unit.isError) {
    return (
      <Page title="Unit details">
        <p role="alert" ref={alertRef} tabIndex={-1} className="outline-none">
          {unit.error.message}
        </p>
        <Button onPress={() => void unit.refetch()} className="mt-2 min-h-6 rounded border px-3 py-1">
          Try again
        </Button>
      </Page>
    );
  }
  return <UnitView unit={unit.data} />;
}
