import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Button } from "react-aria-components";
import { useLocation, useNavigate, useParams } from "react-router";
import { todayNy } from "../../shared/dates";
import { tenantStepIssue } from "../../shared/lease-wizard";
import { draftFromExtension, extensionBody, extensionIssues, keepsMasterTenant, MASTER_TENANT_MESSAGE, newExtensionDraft, type ExtensionDraft, type TermValues } from "../../shared/extension-form";
import { CONFLICT_MESSAGE } from "../../shared/form-messages";
import { FieldErrorsError } from "../api";
import { VersionConflictError } from "../components/forms";
import { Page } from "../components/Page";
import { fetchExtension, fetchLease, saveExtension, type LeaseDetailRecord } from "../leases-api";
import { TenantsStep, type Row } from "./NewLease";
import { SpecialStep } from "./NewLeaseSpecial";
import { Field, fieldId, Money, ProblemSummary, RentIncreaseFields } from "./NewLeaseTerm";

/** The server names rent steps `rentSteps`; the form calls them `steps`. */
const FORM_FIELD: Record<string, string> = { rentSteps: "steps" };
const MAIN_FIELDS = ["startDate", "endDate", "baseRentCents", "increasePercent", "steps", "notes"];
const RENT_TERM_FIELDS = ["securityDepositCents", "rentDueDay", "lateFeeCents", "lateFeeGraceDays"];
const SPECIAL_FIELDS = ["pets", "parking", "parkingChargeCents", "childrenReside", "breakClause", "otherTerms", "baseTaxYear", "taxSharePercent"];
const FORM_FIELDS = new Set([...MAIN_FIELDS, ...RENT_TERM_FIELDS, ...SPECIAL_FIELDS]);
const pick = (issues: Record<string, string>, names: string[]) => Object.fromEntries(Object.entries(issues).filter(([k]) => names.includes(k)));
const omit = (issues: Record<string, string>, names: string[]) => Object.fromEntries(Object.entries(issues).filter(([k]) => !names.includes(k)));

function Form({ lease, extensionId, initial }: { lease: LeaseDetailRecord; extensionId?: string; initial: ExtensionDraft }) {
  const use = lease.unitUse === "Commercial" ? "Commercial" : "Residential";
  const masterIds = lease.masterTenants.map((t) => t.tenantId);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(initial);
  const [issues, setIssues] = useState<Record<string, string>>({});
  const [other, setOther] = useState<string[]>([]);
  const [conflict, setConflict] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tenantIssue, setTenantIssue] = useState<string | null>(null);
  const [otherOpen, setOtherOpen] = useState(false);
  const [specialRefusals, setSpecialRefusals] = useState(0);
  const [refusals, setRefusals] = useState(0);
  const summary = useRef<HTMLDivElement>(null);
  const alertBox = useRef<HTMLDivElement>(null);
  const tenantBox = useRef<HTMLDivElement>(null);
  const set = (patch: Partial<ExtensionDraft["term"]>) => setDraft((d) => ({ ...d, term: { ...d.term, ...patch } }));
  const setRows = (rows: Row[]) => setDraft((d) => ({ ...d, rows }));
  const setPrimary = (primary: string | null) => setDraft((d) => ({ ...d, primary }));
  const tenantProblem = (d: ExtensionDraft): string | null =>
    tenantStepIssue(d.rows, d.primary) ?? (keepsMasterTenant(d.rows, masterIds) ? null : MASTER_TENANT_MESSAGE);
  const heading = `${extensionId ? "Edit" : "Add"} extension – ${lease.propertyName ?? ""} Unit ${lease.unitLabel ?? ""}`;
  const back = `/leases/${lease.id}`;

  useEffect(() => {
    if (refusals > 0) (summary.current ?? alertBox.current ?? tenantBox.current)?.focus();
  }, [refusals]);

  const save = async () => {
    setOther([]);
    setConflict(false);
    const found = extensionIssues(draft, todayNy(), use);
    const tenants = tenantProblem(draft);
    setIssues(found);
    setTenantIssue(tenants);
    const hidden = Object.keys(found).some((k) => [...RENT_TERM_FIELDS, ...SPECIAL_FIELDS].includes(k));
    if (hidden) setOtherOpen(true);
    if (Object.keys(pick(found, SPECIAL_FIELDS)).length > 0 && Object.keys(omit(found, SPECIAL_FIELDS)).length === 0 && !tenants) setSpecialRefusals((n) => n + 1);
    if (tenants || Object.keys(found).length > 0) return setRefusals((n) => n + 1);
    setSaving(true);
    try {
      await saveExtension(extensionId ? { extensionId } : { leaseId: lease.id }, extensionBody(draft, lease.version, use));
      await queryClient.invalidateQueries();
      navigate(back);
    } catch (e) {
      const mapped: Record<string, string> = {};
      const rest: string[] = [];
      let tenants: string | null = null;
      if (e instanceof FieldErrorsError) {
        for (const [field, message] of Object.entries(e.fields)) {
          const name = FORM_FIELD[field] ?? field;
          if (name === "tenants") tenants = message;
          else if (FORM_FIELDS.has(name)) mapped[name] = message;
          else rest.push(message);
        }
      } else if (e instanceof VersionConflictError) setConflict(true);
      else rest.push(e instanceof Error ? e.message : "Something went wrong. Please try again.");
      setIssues(mapped);
      setTenantIssue(tenants);
      if (Object.keys(mapped).some((k) => [...RENT_TERM_FIELDS, ...SPECIAL_FIELDS].includes(k))) setOtherOpen(true);
      setOther(rest);
      setRefusals((n) => n + 1);
      setSaving(false);
    }
  };

  return (
    <Page title={heading}>
      {(conflict || other.length > 0) && (
        <div ref={alertBox} role="alert" tabIndex={-1} className="mb-4 max-w-xl rounded border border-red-700 p-3 outline-offset-2 focus:outline focus:outline-2">
          {conflict ? (
            <>
              <p>{CONFLICT_MESSAGE}</p>
              <Button onPress={() => window.location.reload()} className="mt-2 min-h-6 rounded border px-4 py-1">
                Reload
              </Button>
            </>
          ) : (
            other.map((m) => <p key={m}>{m}</p>)
          )}
        </div>
      )}
      <h2 className="mb-3 text-xl font-semibold">Tenants</h2>
      <div ref={tenantBox} tabIndex={-1} className="outline-offset-2 focus:outline focus:outline-2">
        <TenantsStep rows={draft.rows} setRows={setRows} primary={draft.primary} setPrimary={setPrimary} error={tenantIssue} allowNew={false} />
      </div>
      <h2 className="mb-3 mt-8 text-xl font-semibold">Term and rent</h2>
      <section className="max-w-xl space-y-4">
        <ProblemSummary ref={summary} items={Object.entries(omit(issues, SPECIAL_FIELDS)).map(([name, text]) => ({ name, text }))} targetId={(name) => (name === "steps" ? fieldId("increaseType") : fieldId(name))} />
        <Field name="startDate" label="Extension start date" required error={issues.startDate}>
          {(p) => <input {...p} type="date" value={draft.term.startDate} onChange={(e) => set({ startDate: e.target.value })} />}
        </Field>
        <Field name="endDate" label="Extension end date" required error={issues.endDate}>
          {(p) => <input {...p} type="date" value={draft.term.endDate} onChange={(e) => set({ endDate: e.target.value })} />}
        </Field>
        <Money name="baseRentCents" label="Monthly rent" required value={draft.term.baseRentCents} onChange={(v) => set({ baseRentCents: v })} error={issues.baseRentCents} />
        <RentIncreaseFields draft={draft.term} set={set} issues={issues} />
        <Field name="notes" label="Notes" error={issues.notes}>
          {(p) => <textarea {...p} rows={3} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />}
        </Field>
      </section>
      <div className="mt-8 max-w-xl">
        <Button onPress={() => setOtherOpen((o) => !o)} aria-expanded={otherOpen} aria-controls="other-terms" className="min-h-6 rounded border px-4 py-1">
          Change other terms (optional)
        </Button>
        <p className="mt-1 text-slate-700">Everything else stays the same unless you change it here</p>
        {otherOpen && (
          <div id="other-terms" role="group" aria-label="Other terms" className="mt-4 space-y-4">
            <h3 className="font-semibold">Rent terms</h3>
            <Money name="securityDepositCents" label="Security deposit" value={draft.term.securityDepositCents} onChange={(v) => set({ securityDepositCents: v })} error={issues.securityDepositCents} />
            <Field name="rentDueDay" label="Rent due day" required error={issues.rentDueDay}>
              {(p) => <input {...p} type="text" inputMode="numeric" autoComplete="off" value={draft.term.rentDueDay} onChange={(e) => set({ rentDueDay: e.target.value })} />}
            </Field>
            <Money name="lateFeeCents" label="Late fee" value={draft.term.lateFeeCents} onChange={(v) => set({ lateFeeCents: v })} error={issues.lateFeeCents} />
            <Field name="lateFeeGraceDays" label="Late fee grace period (days)" error={issues.lateFeeGraceDays}>
              {(p) => <input {...p} type="text" inputMode="numeric" autoComplete="off" value={draft.term.lateFeeGraceDays} onChange={(e) => set({ lateFeeGraceDays: e.target.value })} />}
            </Field>
            <h3 className="font-semibold">Other income and special terms</h3>
            <SpecialStep draft={draft.special} setDraft={(special) => setDraft((d) => ({ ...d, special }))} issues={pick(issues, SPECIAL_FIELDS)} use={use} propertyId={lease.propertyId ?? undefined} focusSignal={specialRefusals} />
          </div>
        )}
      </div>
      <div className="mt-6 flex gap-2">
        <Button onPress={() => void save()} isDisabled={saving} className="min-h-6 rounded bg-slate-900 px-4 py-1 text-white">
          Save extension
        </Button>
        <Button onPress={() => navigate(back)} className="min-h-6 rounded border px-4 py-1">
          Cancel
        </Button>
      </div>
    </Page>
  );
}

/** /leases/:id/extensions/new and /extensions/:id/edit (SPEC §11.14): dates, rent, rent increases and notes; everything else is copied from the previous term. */
export function ExtensionForm() {
  const { id = "" } = useParams();
  const editing = useLocation().pathname.startsWith("/extensions/");
  const extension = useQuery({ queryKey: ["extension", id], queryFn: () => fetchExtension(id), enabled: editing, gcTime: 0 });
  const leaseId = editing ? extension.data?.leaseId : id;
  const lease = useQuery({ queryKey: ["lease", leaseId, "extension-form"], queryFn: () => fetchLease(leaseId ?? ""), enabled: Boolean(leaseId), gcTime: 0 });
  const error = (editing ? extension.error : null) ?? lease.error;
  const title = editing ? "Edit extension" : "Add extension";
  if (error) {
    return (
      <Page title={title}>
        <p role="alert">{error.message}</p>
      </Page>
    );
  }
  if (!lease.data || (editing && !extension.data)) return <Page title={title}><p role="status">Loading…</p></Page>;
  const ended = lease.data.status === "ended" || lease.data.status === "ended_superseded" || Boolean(lease.data.moveOutDate);
  if (!editing && ended) {
    return (
      <Page title={title}>
        <p role="alert">Extensions can't be added to an ended lease or one with a move-out date.</p>
      </Page>
    );
  }
  const latest = [...lease.data.extensions].sort((a, b) => a.startDate.localeCompare(b.startDate)).at(-1);
  if (editing && latest?.id !== id) {
    return (
      <Page title={title}>
        <p role="alert">Only the latest extension can be edited.</p>
      </Page>
    );
  }
  const master: TermValues = { ...lease.data, tenants: lease.data.masterTenants };
  const previous = [...lease.data.extensions].sort((x, y) => x.startDate.localeCompare(y.startDate)).at(-1) ?? master;
  const initial = editing ? draftFromExtension(latest ?? master) : newExtensionDraft(previous, lease.data.effectiveEndDate);
  return <Form lease={lease.data} extensionId={editing ? id : undefined} initial={initial} />;
}
