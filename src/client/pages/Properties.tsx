import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "react-aria-components";
import { Link, useLocation, useNavigate } from "react-router";
import { UNEXPECTED_MESSAGE } from "../../shared/form-messages";
import { Page } from "../components/Page";
import { DataTable, Pagination, type Column } from "../components/ui";
import { useCanWrite } from "../me";
import { fetchProperties, type PropertyRecord } from "../properties-api";
import { linkClass } from "./Owners";

const columns: Column<PropertyRecord>[] = [
  {
    key: "name",
    header: "Property",
    cell: (p) => (
      <>
        <Link to={`/properties/${p.id}`} className={linkClass}>
          {p.name}
        </Link>
        {p.archivedAt && " (archived)"}
      </>
    ),
  },
  { key: "address", header: "Address", cell: (p) => `${p.street}, ${p.city}, ${p.state} ${p.zip}` },
  { key: "owner", header: "Owner", cell: (p) => p.owner?.name ?? "—" },
  { key: "type", header: "Type", cell: (p) => p.propertyType },
  { key: "units", header: "Units", cell: (p) => p.unitCount },
  { key: "occupied", header: "Occupied", cell: (p) => p.occupiedCount },
  { key: "responsible", header: "Responsible landlords", cell: (p) => p.responsible.map((r) => r.name).join(", ") || "—" },
];

export function Properties() {
  const navigate = useNavigate();
  const canWrite = useCanWrite();
  const flash = (useLocation().state as { saved?: string } | null)?.saved ?? "";
  const [search, setSearch] = useState("");
  const [archived, setArchived] = useState(false);
  const [page, setPage] = useState(1);
  const properties = useQuery({
    queryKey: ["properties", search, archived, page],
    queryFn: () => fetchProperties({ q: search, archived, page }),
    placeholderData: (previous) => previous,
  });
  return (
    <Page title="Properties">
      <p role="status" className={flash ? "mb-2 text-green-800" : "sr-only"}>
        {flash}
      </p>
      <div className="mb-4 flex flex-wrap items-end gap-4">
        <div>
          <label htmlFor="search-properties" className="block">
            Search properties
          </label>
          <input
            id="search-properties"
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="mt-1 block min-h-6 rounded border px-3 py-1"
          />
        </div>
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
        {canWrite && (
          <Button onPress={() => navigate("/properties/new")} className="min-h-6 rounded bg-slate-900 px-4 py-1 text-white">
            Add property
          </Button>
        )}
      </div>
      {properties.isPending && <p role="status">Loading…</p>}
      {properties.isError && (
        <div>
          <p role="alert">{properties.error instanceof Error ? properties.error.message : UNEXPECTED_MESSAGE}</p>
          <Button onPress={() => void properties.refetch()} className="mt-2 min-h-6 rounded border px-3 py-1">
            Try again
          </Button>
        </div>
      )}
      {properties.data && (
        <>
          <DataTable
            name="Properties"
            columns={columns}
            rows={properties.data.data}
            rowKey={(p) => p.id}
            emptyMessage={search.trim() ? "No properties match your search." : "No properties yet. Add a property or import a spreadsheet."}
          />
          <Pagination page={properties.data.page} pageSize={properties.data.pageSize} total={properties.data.total} onPageChange={setPage} />
        </>
      )}
    </Page>
  );
}
