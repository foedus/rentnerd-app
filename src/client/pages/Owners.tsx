import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "react-aria-components";
import { Link, useLocation, useNavigate } from "react-router";
import { UNEXPECTED_MESSAGE } from "../../shared/form-messages";
import { Page } from "../components/Page";
import { DataTable, Pagination, type Column } from "../components/ui";
import { useCanWrite } from "../me";
import { fetchOwners, type OwnerRecord } from "../owners-api";

export const linkClass = "inline-block min-h-6 underline";

const columns: Column<OwnerRecord>[] = [
  {
    key: "name",
    header: "Owner name",
    cell: (o) => (
      <>
        <Link to={`/owners/${o.id}`} className={linkClass}>
          {o.name}
        </Link>
        {o.archivedAt && " (archived)"}
      </>
    ),
  },
  { key: "type", header: "Owner type", cell: (o) => o.ownerType },
  { key: "city", header: "City", cell: (o) => o.city },
  {
    key: "properties",
    header: "Properties",
    cell: (o) =>
      o.properties.map((p, i) => (
        <span key={p.id}>
          {i > 0 && ", "}
          <Link to={`/properties/${p.id}`} className={linkClass}>
            {p.name}
          </Link>
        </span>
      )),
  },
];

export function Owners() {
  const navigate = useNavigate();
  const canWrite = useCanWrite();
  const flash = (useLocation().state as { saved?: string } | null)?.saved ?? "";
  const [search, setSearch] = useState("");
  const [archived, setArchived] = useState(false);
  const [page, setPage] = useState(1);
  const owners = useQuery({
    queryKey: ["owners", search, archived, page],
    queryFn: () => fetchOwners({ q: search, archived, page }),
    placeholderData: (previous) => previous,
  });
  return (
    <Page title="Owners">
      <p role="status" className={flash ? "mb-2 text-green-800" : "sr-only"}>
        {flash}
      </p>
      <div className="mb-4 flex flex-wrap items-end gap-4">
        <div>
          <label htmlFor="search-owners" className="block">
            Search owners
          </label>
          <input
            id="search-owners"
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
          <Button onPress={() => navigate("/owners/new")} className="min-h-6 rounded bg-slate-900 px-4 py-1 text-white">
            Add owner
          </Button>
        )}
      </div>
      {owners.isPending && <p role="status">Loading…</p>}
      {owners.isError && <p role="alert">{owners.error instanceof Error ? owners.error.message : UNEXPECTED_MESSAGE}</p>}
      {owners.data && (
        <>
          <DataTable
            name="Owners"
            columns={columns}
            rows={owners.data.data}
            rowKey={(o) => o.id}
            emptyMessage={search.trim() ? "No owners match your search." : "No owners yet."}
          />
          <Pagination page={owners.data.page} pageSize={owners.data.pageSize} total={owners.data.total} onPageChange={setPage} />
        </>
      )}
    </Page>
  );
}
