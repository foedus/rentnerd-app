import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { formatCents, formatDate, formatDateTime } from "../../shared/format";
import { formatSharePercent } from "../../shared/income";
import { fetchLeaseVersion } from "../leases-api";
import { Page } from "../components/Page";

const money = (c: number | null) => (c === null ? "–" : formatCents(c));
const text = (s: string | null) => s || "–";
const INCREASES = { none: "None", percent: "Fixed percentage each year", schedule: "Custom schedule" } as const;

/** /leases/:id/versions/:n: a saved version of a lease, read-only (SPEC §11.13, D-31). */
export function LeaseVersion() {
  const { id = "", n = "" } = useParams();
  const version = useQuery({ queryKey: ["lease-version", id, n], queryFn: () => fetchLeaseVersion(id, n), gcTime: 0 });
  if (version.isPending) return <Page title="Lease version"><p role="status">Loading…</p></Page>;
  if (version.isError) {
    return (
      <Page title="Lease version">
        <p role="alert">{version.error.message}</p>
      </Page>
    );
  }
  const v = version.data;
  const s = v.snapshot;
  const rows: [string, string][] = [
    ["Tenants", v.snapshotTenants.map((t) => (t.isPrimary ? `${t.displayName} (Primary contact)` : t.displayName)).join(", ") || "–"],
    ["Lease start date", formatDate(s.startDate)],
    ["Lease end date", formatDate(s.endDate)],
    ["Monthly rent", money(s.baseRentCents)],
    ["Security deposit", money(s.securityDepositCents)],
    ["Rent due day", String(s.rentDueDay)],
    ["Late fee", money(s.lateFeeCents)],
    ["Late fee grace period (days)", s.lateFeeGraceDays === null ? "–" : String(s.lateFeeGraceDays)],
    ["Rent increases", INCREASES[s.increaseType] + (s.increaseType === "percent" && s.increasePercent !== null ? ` (${s.increasePercent}%)` : "")],
    ...(s.increaseType === "schedule" ? s.rentSteps.map((r, i): [string, string] => [`Rent step ${i + 1}`, `${formatDate(r.effectiveDate)}: ${money(r.amountCents)}`]) : []),
    ...(s.moveOutDate ? ([["Move-out date", formatDate(s.moveOutDate)], ["Reason", text(s.endReason)]] as [string, string][]) : []),
    ["Pets", text(s.pets)],
    ["Parking", text(s.parking)],
    ["Parking charge (monthly)", money(s.parkingChargeCents)],
    ["Children reside in unit", s.childrenReside === null ? "–" : s.childrenReside ? "Yes" : "No"],
    ["Break clause", text(s.breakClause)],
    ["Other special terms", text(s.otherTerms)],
    ["Base tax year", s.baseTaxYear === null ? "–" : String(s.baseTaxYear)],
    ["Tenant's share of tax increase (%)", s.taxSharePercent === null ? "–" : formatSharePercent(String(s.taxSharePercent))],
  ];
  return (
    <Page title={`Lease version ${v.versionNumber}`}>
      <p className="mb-1">
        Changed on {formatDateTime(v.changedAt)}
        {v.changedByName ? ` by ${v.changedByName}` : ""}
      </p>
      <p className="mb-4">{v.summary}</p>
      <dl className="grid max-w-xl grid-cols-1 gap-x-6 sm:grid-cols-[max-content_minmax(0,1fr)] sm:gap-y-1">
        {rows.map(([term, value]) => (
          <div key={term} className="contents">
            <dt className="mt-2 font-semibold sm:mt-0">{term}</dt>
            <dd className="min-w-0 whitespace-pre-line break-words">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-6">
        <Link to={`/leases/${id}`} className="underline">
          Back to lease
        </Link>
      </p>
    </Page>
  );
}
