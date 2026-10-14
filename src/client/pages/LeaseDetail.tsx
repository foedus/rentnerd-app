import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useParams } from "react-router";
import { formatCents, formatDate } from "../../shared/format";
import { formatSharePercent } from "../../shared/income";
import { fetchLease, type LeaseDetailRecord } from "../leases-api";
import { Page } from "../components/Page";
import { DataTable, type Column } from "../components/ui";

type Tenant = LeaseDetailRecord["current"]["tenants"][number];
type Period = LeaseDetailRecord["rentSchedule"][number];

const tenantColumns: Column<Tenant>[] = [
  { key: "name", header: "Name", cell: (t) => t.displayName },
  { key: "email", header: "Email", cell: (t) => t.email || "–" },
  { key: "phone", header: "Phone", cell: (t) => t.phone || "–" },
  { key: "primary", header: "Contact", cell: (t) => (t.isPrimary ? "Primary contact" : "") },
];

const scheduleColumns: Column<Period>[] = [
  { key: "start", header: "Period start", cell: (p) => formatDate(p.periodStart) },
  { key: "end", header: "Period end", cell: (p) => formatDate(p.periodEnd) },
  { key: "rent", header: "Monthly rent", cell: (p) => formatCents(p.rentCents) },
  { key: "term", header: "Term", cell: (p) => p.term },
];

const money = (cents: number | null) => (cents === null ? "–" : formatCents(cents));
const text = (value: string | null) => value || "–";

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = `lease-${title.toLowerCase().replace(/\W+/g, "-")}`;
  return (
    <section aria-labelledby={id} className="mb-6">
      <h2 id={id} className="mb-2 text-xl font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Facts({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="grid max-w-xl grid-cols-1 gap-x-6 sm:grid-cols-[max-content_minmax(0,1fr)] sm:gap-y-1">
      {rows.map(([term, value]) => (
        <div key={term} className="contents">
          <dt className="mt-2 font-semibold sm:mt-0">{term}</dt>
          <dd className="min-w-0 whitespace-pre-line break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function LeaseView({ lease }: { lease: LeaseDetailRecord }) {
  const c = lease.current;
  const commercial = lease.unitUse === "Commercial";
  const special: [string, string][] = [
    ["Pets", text(c.pets)],
    ["Parking", text(c.parking)],
    ...(commercial ? [] : [["Children reside in unit", c.childrenReside === null ? "–" : c.childrenReside ? "Yes" : "No"] as [string, string]]),
    ["Break clause", text(c.breakClause)],
    ["Other special terms", text(c.otherTerms)],
    ...(commercial
      ? ([
          ["Base tax year", c.baseTaxYear === null ? "–" : String(c.baseTaxYear)],
          ["Tenant's share of tax increase (%)", c.taxSharePercent === null ? "–" : formatSharePercent(String(c.taxSharePercent))],
        ] as [string, string][])
      : []),
  ];
  return (
    <Page title={`Lease – ${lease.propertyName ?? ""} Unit ${lease.unitLabel ?? ""}`}>
      <p className="mb-4">
        <span className="inline-block rounded border px-2 py-0.5 font-semibold">{lease.statusLabel}</span>
      </p>
      <Section title="Tenants">
        <DataTable name="Tenants" columns={tenantColumns} rows={c.tenants} rowKey={(t) => t.tenantId} emptyMessage="No tenants." />
      </Section>
      <Section title="Term and rent">
        <Facts
          rows={[
            ["Lease start date", formatDate(lease.startDate)],
            ["Lease end date", formatDate(lease.endDate)],
            ["Effective end date", formatDate(lease.effectiveEndDate)],
            ["Current monthly rent", formatCents(lease.currentRentCents)],
            ["Security deposit", money(c.securityDepositCents)],
            ["Rent due day", String(c.rentDueDay)],
            ["Late fee", money(c.lateFeeCents)],
            ["Late fee grace period", c.lateFeeGraceDays === null ? "–" : `${c.lateFeeGraceDays} ${c.lateFeeGraceDays === 1 ? "day" : "days"}`],
          ]}
        />
        <div className="mt-4">
          <DataTable name="Rent schedule" columns={scheduleColumns} rows={lease.rentSchedule} rowKey={(p) => `${p.term}-${p.periodStart}`} />
        </div>
      </Section>
      <Section title="Special terms">
        <Facts rows={special} />
      </Section>
      <Section title="Other income">
        <Facts
          rows={[
            ["Parking charge (monthly)", money(c.parkingChargeCents)],
            ...(commercial ? ([["Tax reimbursement (monthly)", money(c.taxReimbursementCents)]] as [string, string][]) : []),
          ]}
        />
        {commercial && c.taxReimbursementExplanation && <p className="mt-1 text-slate-700">{c.taxReimbursementExplanation}</p>}
      </Section>
    </Page>
  );
}

export function LeaseDetail() {
  const { id } = useParams();
  const lease = useQuery({ queryKey: ["lease", id], queryFn: () => fetchLease(id ?? ""), gcTime: 0 });
  if (lease.isPending) return <Page title="Lease details"><p role="status">Loading…</p></Page>;
  if (lease.isError) {
    return (
      <Page title="Lease details">
        <p role="alert" tabIndex={-1} autoFocus className="outline-none">
          {lease.error.message}
        </p>
      </Page>
    );
  }
  return <LeaseView lease={lease.data} />;
}
