import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, type ReactNode } from "react";
import { Button } from "react-aria-components";
import { Link } from "react-router";
import { formatCents, formatDate } from "../../shared/format";
import { UNEXPECTED_MESSAGE } from "../../shared/form-messages";
import { formatOccupancy, formatYield } from "../../shared/stats";
import { UnauthenticatedError } from "../api";
import { Page } from "../components/Page";
import { DataTable, type Column } from "../components/ui";
import { fetchDashboard, type DashboardRecord } from "../dashboard-api";
import { linkClass } from "./Owners";

type PropertyRow = DashboardRecord["byProperty"][number];
type DecisionRow = DashboardRecord["leasesNeedingDecision"][number];
type EndingRow = DashboardRecord["leasesEndingSoon"][number];

const money = (cents: number | null) =>
  cents === null ? "—" : formatCents(cents);

const propertyColumns: Column<PropertyRow>[] = [
  {
    key: "name",
    header: "Property",
    cell: (p) => (
      <Link to={`/properties/${p.propertyId}`} className={linkClass}>
        {p.name}
      </Link>
    ),
  },
  { key: "type", header: "Type", cell: (p) => p.propertyType },
  { key: "units", header: "Units", cell: (p) => p.units },
  { key: "occupied", header: "Occupied", cell: (p) => p.occupied },
  {
    key: "occupancy",
    header: "Occupancy",
    cell: (p) => formatOccupancy(p.occupancyTenths),
  },
  {
    key: "rent",
    header: "Monthly rent",
    cell: (p) => money(p.monthlyRentRollCents),
  },
  {
    key: "other",
    header: "Other income (monthly)",
    cell: (p) => money(p.monthlyOtherIncomeCents),
  },
  { key: "value", header: "Value", cell: (p) => money(p.valueCents) },
  {
    key: "yield",
    header: "Gross yield",
    cell: (p) => formatYield(p.grossYieldHundredths),
  },
];

type LeaseRow = DecisionRow | EndingRow;
const leaseColumns: Column<LeaseRow>[] = [
  {
    key: "property",
    header: "Property",
    cell: (r) => (
      <Link to={`/properties/${r.propertyId}`} className={linkClass}>
        {r.propertyName}
      </Link>
    ),
  },
  {
    key: "unit",
    header: "Unit",
    cell: (r) => (
      <Link to={`/leases/${r.leaseId}`} className={linkClass}>
        {r.unitLabel}
      </Link>
    ),
  },
  {
    key: "tenants",
    header: "Tenants",
    cell: (r) => r.tenants.join(", ") || "—",
  },
];
const rentColumn: Column<LeaseRow> = {
  key: "rent",
  header: "Current rent",
  cell: (r) => formatCents(r.currentRentCents),
};
const decisionColumns: Column<LeaseRow>[] = [
  ...leaseColumns,
  {
    key: "ended",
    header: "Ended on",
    cell: (r) => formatDate((r as DecisionRow).endedOn),
  },
  rentColumn,
];
const endingColumns: Column<LeaseRow>[] = [
  ...leaseColumns,
  {
    key: "end",
    header: "End date",
    cell: (r) => formatDate((r as EndingRow).endDate),
  },
  { key: "days", header: "Days left", cell: (r) => (r as EndingRow).daysLeft },
  rentColumn,
];

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = `dash-${title.toLowerCase().replace(/\W+/g, "-")}`;
  return (
    <section aria-labelledby={id} className="mb-6">
      <h2 id={id} className="mb-2 text-xl font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Summary({ data }: { data: DashboardRecord | undefined }) {
  const s = data?.summary;
  if (!s) return null;
  const rows: [string, string][] = [
    ["Units", String(s.units)],
    ["Occupied", String(s.occupied)],
    ["Vacant", String(s.vacant)],
    ["Occupancy", formatOccupancy(s.occupancyTenths)],
    ["Monthly rent roll", formatCents(s.monthlyRentRollCents)],
    ["Annual rent roll", formatCents(s.annualRentRollCents)],
    ["Monthly other income", formatCents(s.monthlyOtherIncomeCents)],
    ["Vacancy loss (monthly)", formatCents(s.vacancyLossCents)],
    ["Portfolio value", money(s.valueCents)],
    ["Gross yield", formatYield(s.grossYieldHundredths)],
  ];
  return (
    <Section title="Portfolio summary">
      <dl className="grid max-w-xl grid-cols-1 gap-x-6 sm:grid-cols-[max-content_minmax(0,1fr)] sm:gap-y-1">
        {rows.map(([term, value]) => (
          <div key={term} className="contents">
            <dt className="mt-2 font-semibold sm:mt-0">{term}</dt>
            <dd className="min-w-0 break-words">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2">{s.yieldNote}</p>
    </Section>
  );
}

export function Dashboard() {
  const dashboard = useQuery({
    queryKey: ["dashboard"],
    queryFn: fetchDashboard,
  });
  const data = dashboard.data;
  const queryClient = useQueryClient();
  const signedOut = dashboard.error instanceof UnauthenticatedError;
  // A lost session sends the user to sign in again (the Shell redirects once /api/me answers 401).
  useEffect(() => {
    if (signedOut) void queryClient.invalidateQueries({ queryKey: ["me"] });
  }, [signedOut, queryClient]);
  return (
    <Page title="Dashboard">
      {dashboard.isPending && <p role="status">Loading…</p>}
      {dashboard.isError && (
        <div>
          <p role="alert">
            {dashboard.error instanceof Error
              ? dashboard.error.message
              : UNEXPECTED_MESSAGE}
          </p>
          <Button
            onPress={() => void dashboard.refetch()}
            className="mt-2 min-h-6 rounded border px-3 py-1"
          >
            Try again
          </Button>
        </div>
      )}
      {!dashboard.isError && (
        <>
          <Summary data={data} />
          <Section title="By property">
            <DataTable
              name="By property"
              columns={propertyColumns}
              rows={data?.byProperty ?? []}
              rowKey={(p) => p.propertyId}
              emptyMessage={data ? "None." : undefined}
            />
          </Section>
          <Section title="Leases needing a decision">
            <DataTable
              name="Leases needing a decision"
              columns={decisionColumns}
              rows={data?.leasesNeedingDecision ?? []}
              rowKey={(r) => r.leaseId}
              emptyMessage={data ? "None." : undefined}
            />
          </Section>
          <Section title="Leases ending in the next 90 days">
            <DataTable
              name="Leases ending in the next 90 days"
              columns={endingColumns}
              rows={data?.leasesEndingSoon ?? []}
              rowKey={(r) => r.leaseId}
              emptyMessage={data ? "None." : undefined}
            />
          </Section>
        </>
      )}
    </Page>
  );
}
