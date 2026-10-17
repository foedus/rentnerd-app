import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Button } from "react-aria-components";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import { UNEXPECTED_MESSAGE } from "../../shared/form-messages";
import { fetchTenantLeases, type LeaseListRow } from "../leases-api";
import { formatDate } from "../../shared/format";
import { Page } from "../components/Page";
import { ConfirmDialog, DataTable, ReasonButton, type Column } from "../components/ui";
import { useCanWrite } from "../me";
import { deleteTenant, fetchTenant, tenantAction, type TenantAction, type TenantRecord } from "../tenants-api";

const ON_LEASE_DELETE = "Tenants on a lease can only be archived";

const leaseColumns = (tenantId: string): Column<LeaseListRow>[] => [
  { key: "property", header: "Property", cell: (l) =>
      l.propertyId ? (
        <Link to={`/properties/${l.propertyId}`} className="block max-w-48 break-words underline">
          {l.propertyName ?? "–"}
        </Link>
      ) : (
        <span className="block max-w-48 break-words">{l.propertyName ?? "–"}</span>
      ),
  },
  {
    key: "unit",
    header: "Unit",
    cell: (l) => (
      <Link to={`/leases/${l.id}`} className="underline" aria-label={`Lease for unit ${l.unitLabel ?? ""}`}>
        {l.unitLabel ?? "–"}
      </Link>
    ),
  },
  { key: "start", header: "Start", cell: (l) => formatDate(l.startDate) },
  { key: "end", header: "End", cell: (l) => formatDate(l.effectiveEndDate) },
  { key: "status", header: "Status", cell: (l) => l.statusLabel },
  { key: "primary", header: "Primary contact", cell: (l) => (l.currentTenants.some((t) => t.tenantId === tenantId && t.isPrimary) ? "Yes" : "No") },
];

function Details({ tenant }: { tenant: TenantRecord }) {
  const rows: [string, string | null][] = [
    ["Tenant type", tenant.tenantType],
    ...(tenant.tenantType === "Business"
      ? ([["Business name", tenant.businessName], ["Contact person", tenant.contactPerson]] as [string, string | null][])
      : ([["First name", tenant.firstName], ["Last name", tenant.lastName]] as [string, string | null][])),
    ["Email", tenant.email],
    ["Phone", tenant.phone],
    ["Notes", tenant.notes],
  ];
  return (
    <dl className="mb-6 grid max-w-xl grid-cols-[max-content_minmax(0,1fr)] gap-x-6 gap-y-1">
      {rows.map(([term, value]) => (
        <div key={term} className="contents">
          <dt className="font-semibold">{term}</dt>
          <dd className="min-w-0 break-words">{value || "–"}</dd>
        </div>
      ))}
    </dl>
  );
}

function TenantView({ tenant }: { tenant: TenantRecord }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const canWrite = useCanWrite();
  const flash = (useLocation().state as { saved?: string } | null)?.saved ?? "";
  const outcome = useRef<HTMLDivElement>(null);
  const [notice, setNotice] = useState(flash);
  const [problem, setProblem] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["tenant"] });
    await queryClient.invalidateQueries({ queryKey: ["tenants"] });
    await queryClient.invalidateQueries({ queryKey: ["tenant-leases"] });
  };
  const busy = useRef(false);
  const run = async (action: TenantAction) => {
    if (busy.current) return; // a double-click would re-send the old version and report a false conflict
    busy.current = true;
    setNotice("");
    setProblem("");
    try {
      await tenantAction(action, tenant);
      setNotice(action === "archive" ? "Tenant archived." : "Tenant restored.");
    } catch (err) {
      setProblem(err instanceof Error ? err.message : UNEXPECTED_MESSAGE);
    } finally {
      busy.current = false;
    }
    await refresh();
    outcome.current?.focus();
  };
  const remove = async () => {
    try {
      await deleteTenant(tenant.id);
    } catch (err) {
      setNotice("");
      setProblem(err instanceof Error ? err.message : UNEXPECTED_MESSAGE);
      outcome.current?.focus();
      return;
    }
    await refresh();
    navigate("/tenants", { state: { saved: "Tenant deleted." } });
  };
  const leases = useQuery({ queryKey: ["tenant-leases", tenant.id], queryFn: () => fetchTenantLeases(tenant.id), gcTime: 0 });
  return (
    <Page title={tenant.displayName}>
      <div ref={outcome} tabIndex={-1} className="outline-none">
        <p role="status" className={notice ? "mb-2 text-green-800" : "sr-only"}>
          {notice}
        </p>
        {problem && (
          <p role="alert" className="mb-2 text-red-700">
            {problem}
          </p>
        )}
      </div>
      {tenant.archivedAt && <p className="mb-2">This tenant is archived.</p>}
      <Details tenant={tenant} />
      <h2 className="mb-2 text-xl font-semibold">Leases</h2>
      <div className="mb-6">
        {leases.isError ? (
          <p role="alert">{leases.error.message}</p>
        ) : (
          <DataTable name="Leases" columns={leaseColumns(tenant.id)} rows={leases.data ?? []} rowKey={(l) => l.id} emptyMessage={leases.isPending ? "Loading…" : "This tenant is not on any lease."} />
        )}
      </div>
      {canWrite && (
        <div className="flex flex-wrap gap-2">
          <Button onPress={() => navigate(`/tenants/${tenant.id}/edit`)} className="min-h-6 select-none rounded border px-4 py-1">
            Edit tenant
          </Button>
          {tenant.archivedAt ? (
            <Button onPress={() => void run("restore")} className="min-h-6 select-none rounded border px-4 py-1">
              Restore tenant
            </Button>
          ) : (
            <Button onPress={() => void run("archive")} className="min-h-6 select-none rounded border px-4 py-1">
              Archive tenant
            </Button>
          )}
          <ReasonButton onPress={() => setConfirmingDelete(true)} unavailableReason={tenant.onLease ? ON_LEASE_DELETE : undefined}>
            Delete tenant
          </ReasonButton>
        </div>
      )}
      <ConfirmDialog
        isOpen={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        title={`Delete ${tenant.displayName}? This can't be undone.`}
        confirmLabel="Delete"
        onConfirm={() => void remove()}
      />
    </Page>
  );
}

export function TenantDetail() {
  const { id } = useParams();
  const tenant = useQuery({ queryKey: ["tenant", id], queryFn: () => fetchTenant(id ?? ""), gcTime: 0 });
  if (tenant.isPending) return <Page title="Tenant details"><p role="status">Loading…</p></Page>;
  if (tenant.isError) {
    return (
      <Page title="Tenant details">
        <p role="alert" tabIndex={-1} autoFocus className="outline-none">
          {tenant.error.message}
        </p>
      </Page>
    );
  }
  return <TenantView tenant={tenant.data} />;
}
