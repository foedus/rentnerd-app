import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "react-aria-components";
import { Link, useLocation, useNavigate } from "react-router";
import { UNEXPECTED_MESSAGE } from "../../shared/form-messages";
import { formatDateTime } from "../../shared/format";
import { TEMPLATE_KIND_LABELS } from "../../shared/placeholders";
import { Page } from "../components/Page";
import { DataTable, Pagination, type Column } from "../components/ui";
import { useCanWrite } from "../me";
import { fetchTemplates, type TemplateRecord } from "../templates-api";
import { linkClass } from "./Owners";

const columns: Column<TemplateRecord>[] = [
  {
    key: "name",
    header: "Name",
    cell: (t) => (
      <>
        <Link to={`/templates/${t.id}`} className={linkClass}>
          {t.name}
        </Link>
        {t.archivedAt && " (archived)"}
      </>
    ),
  },
  { key: "type", header: "Type", cell: (t) => TEMPLATE_KIND_LABELS[t.kind] },
  { key: "updated", header: "Last updated", cell: (t) => formatDateTime(t.updatedAt) },
  { key: "by", header: "Updated by", cell: (t) => t.updatedByName ?? "—" },
];

/** /templates (§11.19). */
export function Templates() {
  const navigate = useNavigate();
  const canWrite = useCanWrite();
  const flash = (useLocation().state as { saved?: string } | null)?.saved ?? "";
  const [archived, setArchived] = useState(false);
  const [page, setPage] = useState(1);
  const templates = useQuery({ queryKey: ["templates", archived, page], queryFn: () => fetchTemplates({ archived, page }), placeholderData: (previous) => previous });
  return (
    <Page title="Templates">
      <p role="status" className={flash ? "mb-2 text-green-800" : "sr-only"}>
        {flash}
      </p>
      <div className="mb-4 flex flex-wrap items-end gap-4">
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
          <Button onPress={() => navigate("/templates/new")} className="min-h-6 rounded bg-slate-900 px-4 py-1 text-white">
            New template
          </Button>
        )}
      </div>
      {templates.isPending && <p role="status">Loading…</p>}
      {templates.isError && <p role="alert">{templates.error instanceof Error ? templates.error.message : UNEXPECTED_MESSAGE}</p>}
      {templates.data && (
        <>
          <DataTable name="Templates" columns={columns} rows={templates.data.data} rowKey={(t) => t.id} emptyMessage="No templates yet." />
          <Pagination page={templates.data.page} pageSize={templates.data.pageSize} total={templates.data.total} onPageChange={setPage} />
        </>
      )}
    </Page>
  );
}
