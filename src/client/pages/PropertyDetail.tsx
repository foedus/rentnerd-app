import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Button, Tab, TabList, TabPanel, Tabs } from "react-aria-components";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { UNEXPECTED_MESSAGE } from "../../shared/form-messages";
import { formatCents, formatDate } from "../../shared/format";
import { NotFound } from "../components/Notices";
import { Page } from "../components/Page";
import { DataTable, type Column } from "../components/ui";
import { UnauthenticatedError } from "../api";
import { useCanWrite } from "../me";
import { ComplianceTab } from "./PropertyCompliance";
import { TaxesTab } from "./PropertyTaxes";
import { currentValueText, ValuesTab } from "./PropertyValues";
import { fetchProperty, fetchPropertyUnits, PropertyNotFoundError, type PropertyRecord, type UnitRecord } from "../properties-api";

const TABS = ["Units", "Values", "Property taxes", "Compliance", "Investments"] as const;
const tabClass = "min-h-6 cursor-pointer border-b-2 border-transparent px-4 py-1 aria-selected:border-slate-900 aria-selected:font-semibold";

const dash = "–";
const unitColumns: Column<UnitRecord>[] = [
  { key: "label", header: "Unit", cell: (u) => <Link to={`/units/${u.id}`} className="underline">{u.archivedAt ? `${u.label} (archived)` : u.label}</Link> },
  { key: "use", header: "Use", cell: (u) => u.use },
  { key: "status", header: "Status", cell: (u) => (u.archivedAt ? "Archived" : (u.lease?.statusText ?? "Vacant")) },
  { key: "tenants", header: "Tenants", cell: (u) => (u.lease?.tenants.length ? u.lease.tenants.join(", ") : dash) },
  { key: "rent", header: "Current rent", cell: (u) => (u.lease?.currentRentCents == null ? dash : formatCents(u.lease.currentRentCents)) },
  { key: "end", header: "Lease end", cell: (u) => (u.lease?.leaseEndDate ? formatDate(u.lease.leaseEndDate) : dash) },
];

function Summary({ property }: { property: PropertyRecord }) {
  const current = currentValueText(property.currentValue);
  const rows: [string, string][] = [
    ["Address", `${property.street}, ${property.city}, ${property.state} ${property.zip}`],
    ["Type", property.propertyType],
    ["Owner", property.owner?.name ?? "—"],
    ["Located in New York City", property.inNyc ? "Yes" : "No"],
    ["Borough-Block-Lot (BBL)", property.bbl || "—"],
    ["Year built", property.yearBuilt ? String(property.yearBuilt) : "—"],
    ["Purchase price", property.purchasePriceCents == null ? "—" : formatCents(property.purchasePriceCents)],
    ["Purchase date", property.purchaseDate ? formatDate(property.purchaseDate) : "—"],
    ["Current value", current ? `${current.amount} (${current.basis})` : "—"],
  ];
  return (
    <dl className="mb-6 grid max-w-xl grid-cols-[max-content_minmax(0,1fr)] gap-x-6 gap-y-1">
      {rows.map(([term, value]) => (
        <div key={term} className="contents">
          <dt className="font-semibold">{term}</dt>
          <dd className="break-words">{value}</dd>
        </div>
      ))}
      <div className="contents">
        <dt className="font-semibold">Responsible landlords</dt>
        <dd className="break-words">
          {property.responsible.length === 0 ? (
            "—"
          ) : (
            <ul>
              {property.responsible.map((r) => (
                <li key={r.id}>
                  {r.name} ({r.email})
                </li>
              ))}
            </ul>
          )}
        </dd>
      </div>
    </dl>
  );
}

function UnitsTab({ property, archived, setArchived }: { property: PropertyRecord; archived: boolean; setArchived: (v: boolean) => void }) {
  const navigate = useNavigate();
  const canWrite = useCanWrite();
  const queryClient = useQueryClient();
  const units = useQuery({ queryKey: ["property-units", property.id, archived], queryFn: () => fetchPropertyUnits(property.id, archived), gcTime: 0 });
  const signedOut = units.error instanceof UnauthenticatedError;
  useEffect(() => {
    if (signedOut) void queryClient.invalidateQueries({ queryKey: ["me"] });
  }, [signedOut, queryClient]);
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-4">
        <label className="flex min-h-6 items-center gap-2">
          <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} />
          Show archived
        </label>
        {canWrite && !property.archivedAt && (
          <Button onPress={() => navigate(`/properties/${property.id}/units/new`)} className="min-h-6 rounded bg-slate-900 px-4 py-1 text-white">
            Add unit
          </Button>
        )}
      </div>
      {units.isPending && <p role="status">Loading…</p>}
      {units.isError && (
        <div>
          <p role="alert">{units.error instanceof Error ? units.error.message : UNEXPECTED_MESSAGE}</p>
          <Button onPress={() => void units.refetch()} className="mt-2 min-h-6 rounded border px-3 py-1">
            Try again
          </Button>
        </div>
      )}
      {units.data && <DataTable name="Units" columns={unitColumns} rows={units.data} rowKey={(u) => u.id} emptyMessage="No units yet." />}
    </>
  );
}

function PropertyView({ property }: { property: PropertyRecord }) {
  const navigate = useNavigate();
  const canWrite = useCanWrite();
  const [params, setParams] = useSearchParams();
  const [showArchived, setShowArchived] = useState(false);
  const asked = params.get("tab");
  const selected = TABS.find((t) => t.toLowerCase() === asked?.toLowerCase()) ?? "Units";
  return (
    <Page title={property.name}>
      {property.archivedAt && <p className="mb-2">This property is archived.</p>}
      <Summary property={property} />
      {canWrite && (
        <div className="mb-6 flex flex-wrap gap-2">
          <Button onPress={() => navigate(`/properties/${property.id}/edit`)} className="min-h-6 rounded border px-4 py-1">
            Edit property
          </Button>
        </div>
      )}
      <Tabs selectedKey={selected} onSelectionChange={(key) => setParams(key === "Units" ? {} : { tab: String(key) }, { replace: true })}>
        <TabList aria-label="Property sections" className="mb-4 flex flex-wrap gap-2">
          {TABS.map((t) => (
            <Tab key={t} id={t} className={tabClass}>
              {t}
            </Tab>
          ))}
        </TabList>
        <TabPanel id="Units">
          <UnitsTab property={property} archived={showArchived} setArchived={setShowArchived} />
        </TabPanel>
        <TabPanel id="Values">
          <ValuesTab property={property} />
        </TabPanel>
        <TabPanel id="Property taxes">
          <TaxesTab property={property} />
        </TabPanel>
        <TabPanel id="Compliance">
          <ComplianceTab property={property} />
        </TabPanel>
        {TABS.slice(4).map((t) => (
          <TabPanel key={t} id={t}>
            <h2 className="mb-2 text-xl font-semibold">{t}</h2>
            <p>Nothing here yet.</p>
          </TabPanel>
        ))}
      </Tabs>
    </Page>
  );
}

export function PropertyDetail() {
  const { id } = useParams();
  const queryClient = useQueryClient();
  const property = useQuery({ queryKey: ["property", id], queryFn: () => fetchProperty(id ?? ""), gcTime: 0 });
  const alertRef = useRef<HTMLParagraphElement>(null);
  const signedOut = property.error instanceof UnauthenticatedError;
  // A lost session sends the user to sign in again (the Shell redirects once /api/me answers 401).
  useEffect(() => {
    if (signedOut) void queryClient.invalidateQueries({ queryKey: ["me"] });
  }, [signedOut, queryClient]);
  useEffect(() => {
    if (property.isError) alertRef.current?.focus();
  }, [property.isError]);
  if (property.isPending) return <Page title="Property details"><p role="status">Loading…</p></Page>;
  if (property.error instanceof PropertyNotFoundError) return <NotFound />;
  if (property.isError) {
    return (
      <Page title="Property details">
        <p role="alert" ref={alertRef} tabIndex={-1} className="outline-none">
          {property.error.message}
        </p>
        <Button onPress={() => void property.refetch()} className="mt-2 min-h-6 rounded border px-3 py-1">
          Try again
        </Button>
      </Page>
    );
  }
  return <PropertyView property={property.data} />;
}
