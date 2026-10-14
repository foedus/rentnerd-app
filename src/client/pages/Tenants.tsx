import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "react-aria-components";
import { Link, useLocation, useNavigate } from "react-router";
import { UNEXPECTED_MESSAGE } from "../../shared/form-messages";
import { Page } from "../components/Page";
import { DataTable, Pagination, type Column } from "../components/ui";
import { useCanWrite } from "../me";
import { fetchTenants, type TenantRecord } from "../tenants-api";
import { linkClass } from "./Owners";

const columns: Column<TenantRecord>[] = [
  {
    key: "name",
    header: "Name",
    cell: (t) => (
      <>
        <Link to={`/tenants/${t.id}`} className={linkClass}>
          {t.tenantType === "Business" ? t.businessName : t.displayName}
        </Link>
        {t.archivedAt && " (archived)"}
      </>
    ),
  },
  { key: "contact", header: "Contact person", cell: (t) => t.contactPerson || "–" },
  { key: "email", header: "Email", cell: (t) => t.email || "–" },
  { key: "phone", header: "Phone", cell: (t) => t.phone || "–" },
  // Leases arrive in a later task; until then no tenant has a unit.
  { key: "units", header: "Current unit(s)", cell: () => "–" },
];

export function Tenants() {
  const navigate = useNavigate();
  const canWrite = useCanWrite();
  const flash = (useLocation().state as { saved?: string } | null)?.saved ?? "";
  const [search, setSearch] = useState("");
  const [archived, setArchived] = useState(false);
  const [page, setPage] = useState(1);
  const tenants = useQuery({
    queryKey: ["tenants", search, archived, page],
    queryFn: () => fetchTenants({ q: search, archived, page }),
    placeholderData: (previous) => previous,
  });
  return (
    <Page title="Tenants">
      <p role="status" className={flash ? "mb-2 text-green-800" : "sr-only"}>
        {flash}
      </p>
      <div className="mb-4 flex flex-wrap items-end gap-4">
        <div>
          <label htmlFor="search-tenants" className="block">
            Search tenants
          </label>
          <input
            id="search-tenants"
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
          <Button onPress={() => navigate("/tenants/new")} className="min-h-6 rounded bg-slate-900 px-4 py-1 text-white">
            Add tenant
          </Button>
        )}
      </div>
      {tenants.isPending && <p role="status">Loading…</p>}
      {tenants.isError && <p role="alert">{tenants.error instanceof Error ? tenants.error.message : UNEXPECTED_MESSAGE}</p>}
      {tenants.data && (
        <>
          <DataTable
            name="Tenants"
            columns={columns}
            rows={tenants.data.data}
            rowKey={(t) => t.id}
            emptyMessage={search.trim() ? "No tenants match your search." : "No tenants yet."}
          />
          <Pagination page={tenants.data.page} pageSize={tenants.data.pageSize} total={tenants.data.total} onPageChange={setPage} />
        </>
      )}
    </Page>
  );
}
