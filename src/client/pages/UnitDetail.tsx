import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { Button } from "react-aria-components";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import { NotFound } from "../components/Notices";
import { Page } from "../components/Page";
import { UnauthenticatedError } from "../api";
import { useCanWrite } from "../me";
import { fetchUnit, UnitNotFoundError, type UnitRecord } from "../properties-api";

const orDash = (v: number | null | undefined) => (v == null ? "—" : String(v));

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
    ["Status", unit.archivedAt ? "Archived" : "Vacant"],
  ];
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
