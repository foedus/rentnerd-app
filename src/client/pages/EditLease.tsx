import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Button } from "react-aria-components";
import { useNavigate, useParams } from "react-router";
import { todayNy } from "../../shared/dates";
import { CONFLICT_MESSAGE, PROBLEM_TITLE } from "../../shared/form-messages";
import { draftsFromLease, leaseUpdateBody } from "../../shared/lease-edit";
import { specialStepIssues, tenantStepIssue, termStepIssues } from "../../shared/lease-wizard";
import { FieldErrorsError } from "../api";
import { VersionConflictError } from "../components/forms";
import { Page } from "../components/Page";
import { fetchLease, updateLease, type LeaseDetailRecord } from "../leases-api";
import { TenantsStep, type Row } from "./NewLease";
import { SpecialStep } from "./NewLeaseSpecial";
import { TermStep } from "./NewLeaseTerm";

/** Names for the fields the server may refuse, so a message says what it is about. */
const FIELD_NAMES: Record<string, string> = {
  tenants: "Tenants", startDate: "Lease start date", endDate: "Lease end date", baseRentCents: "Monthly rent", securityDepositCents: "Security deposit",
  rentDueDay: "Rent due day", lateFeeCents: "Late fee", lateFeeGraceDays: "Late fee grace period (days)", increasePercent: "Annual increase (%)",
  rentSteps: "Rent increases", moveOutDate: "Move-out date", endReason: "Reason", pets: "Pets", parking: "Parking", parkingChargeCents: "Parking charge (monthly)",
  childrenReside: "Children reside in unit", breakClause: "Break clause", otherTerms: "Other special terms", baseTaxYear: "Base tax year",
  taxSharePercent: "Tenant's share of tax increase (%)",
};
const problemText = (field: string, message: string) => {
  const name = FIELD_NAMES[field.split(".")[0] ?? ""];
  return name ? `${name}: ${message}` : message;
};

function EditForm({ lease }: { lease: LeaseDetailRecord }) {
  const initial = draftsFromLease(lease);
  const navigate = useNavigate();
  const use = lease.unitUse === "Commercial" ? "Commercial" : "Residential";
  const [rows, setRows] = useState<Row[]>(initial.rows);
  const [primary, setPrimary] = useState<string | null>(initial.primary);
  const [tenantIssue, setTenantIssue] = useState<string | null>(null);
  const [term, setTerm] = useState(initial.term);
  const [termIssues, setTermIssues] = useState<Record<string, string> | null>(null);
  const [termRefusals, setTermRefusals] = useState(0);
  const [special, setSpecial] = useState(initial.special);
  const [specialIssues, setSpecialIssues] = useState<Record<string, string> | null>(null);
  const [specialRefusals, setSpecialRefusals] = useState(0);
  const [problems, setProblems] = useState<string[]>([]);
  const [conflict, setConflict] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refusals, setRefusals] = useState(0);
  const alertBox = useRef<HTMLDivElement>(null);
  const today = todayNy();

  // Once a message is showing, keep it in step with what the person fixes.
  useEffect(() => setTenantIssue((i) => (i === null ? null : tenantStepIssue(rows, primary))), [rows, primary]);
  useEffect(() => setTermIssues((i) => (i === null ? null : termStepIssues(term, todayNy()))), [term]);
  useEffect(() => setSpecialIssues((i) => (i === null ? null : specialStepIssues(special, use))), [special, use]);
  useEffect(() => {
    if (refusals > 0) alertBox.current?.focus();
  }, [refusals]);

  const save = async () => {
    setProblems([]);
    setConflict(false);
    const tenants = tenantStepIssue(rows, primary);
    const terms = termStepIssues(term, today);
    const specials = specialStepIssues(special, use);
    setTenantIssue(tenants);
    setTermIssues(terms);
    setSpecialIssues(specials);
    if (Object.keys(terms).length > 0) setTermRefusals((n) => n + 1);
    if (Object.keys(specials).length > 0) setSpecialRefusals((n) => n + 1);
    if (tenants || Object.keys(terms).length > 0 || Object.keys(specials).length > 0) return;
    setSaving(true);
    try {
      await updateLease(lease.id, leaseUpdateBody(lease.version, rows, primary, term, special, use, today));
      navigate(`/leases/${lease.id}`);
    } catch (e) {
      if (e instanceof VersionConflictError) setConflict(true);
      else setProblems(e instanceof FieldErrorsError ? Object.entries(e.fields).map(([f, m]) => problemText(f, m)) : [e instanceof Error ? e.message : "Something went wrong. Please try again."]);
      setRefusals((n) => n + 1);
      setSaving(false);
    }
  };

  return (
    <Page title={`Edit lease – ${lease.propertyName ?? ""} Unit ${lease.unitLabel ?? ""}`}>
      {(conflict || problems.length > 0) && (
        <div ref={alertBox} role="alert" tabIndex={-1} className="mb-4 max-w-xl rounded border border-red-700 p-3 outline-offset-2 focus:outline focus:outline-2">
          {conflict ? (
            <>
              <p>{CONFLICT_MESSAGE}</p>
              <Button onPress={() => window.location.reload()} className="mt-2 min-h-6 rounded border px-4 py-1">
                Reload
              </Button>
            </>
          ) : (
            <>
              <p className="font-semibold">{PROBLEM_TITLE}</p>
              <ul className="list-disc pl-5">
                {problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
      <h2 className="mb-3 text-xl font-semibold">Tenants</h2>
      <TenantsStep rows={rows} setRows={setRows} primary={primary} setPrimary={setPrimary} error={tenantIssue} allowNew={false} />
      <h2 className="mb-3 mt-8 text-xl font-semibold">Term and rent</h2>
      <TermStep draft={term} setDraft={setTerm} issues={termIssues ?? {}} today={today} focusSignal={termRefusals} />
      <h2 className="mb-3 mt-8 text-xl font-semibold">Special terms</h2>
      <SpecialStep draft={special} setDraft={setSpecial} issues={specialIssues ?? {}} use={use} propertyId={lease.propertyId ?? undefined} focusSignal={specialRefusals} />
      <div className="mt-6 flex gap-2">
        <Button onPress={() => void save()} isDisabled={saving} className="min-h-6 rounded bg-slate-900 px-4 py-1 text-white">
          Save lease
        </Button>
        <Button onPress={() => navigate(`/leases/${lease.id}`)} className="min-h-6 rounded border px-4 py-1">
          Cancel
        </Button>
      </div>
    </Page>
  );
}

/** /leases/:id/edit: the wizard's fields on one page (SPEC §11.13). Saving creates a new version. */
export function EditLease() {
  const { id = "" } = useParams();
  const lease = useQuery({ queryKey: ["lease", id, "edit"], queryFn: () => fetchLease(id), gcTime: 0 });
  if (lease.isPending) return <Page title="Edit lease"><p role="status">Loading…</p></Page>;
  if (lease.isError) {
    return (
      <Page title="Edit lease">
        <p role="alert">{lease.error.message}</p>
      </Page>
    );
  }
  return <EditForm lease={lease.data} />;
}
