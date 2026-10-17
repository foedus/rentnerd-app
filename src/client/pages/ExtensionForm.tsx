import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Button } from "react-aria-components";
import { useLocation, useNavigate, useParams } from "react-router";
import { todayNy } from "../../shared/dates";
import { extensionBody, extensionIssues, draftFromExtension, newExtensionDraft, type ExtensionDraft } from "../../shared/extension-form";
import { CONFLICT_MESSAGE } from "../../shared/form-messages";
import { FieldErrorsError } from "../api";
import { VersionConflictError } from "../components/forms";
import { Page } from "../components/Page";
import { fetchExtension, fetchLease, saveExtension, type LeaseDetailRecord } from "../leases-api";
import { Field, fieldId, Money, ProblemSummary, RentIncreaseFields } from "./NewLeaseTerm";

/** The server names rent steps `rentSteps`; the form calls them `steps`. */
const FORM_FIELD: Record<string, string> = { rentSteps: "steps" };
const FORM_FIELDS = new Set(["startDate", "endDate", "baseRentCents", "increasePercent", "steps", "notes"]);

function Form({ lease, extensionId, initial }: { lease: LeaseDetailRecord; extensionId?: string; initial: ExtensionDraft }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(initial);
  const [issues, setIssues] = useState<Record<string, string>>({});
  const [other, setOther] = useState<string[]>([]);
  const [conflict, setConflict] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refusals, setRefusals] = useState(0);
  const summary = useRef<HTMLDivElement>(null);
  const alertBox = useRef<HTMLDivElement>(null);
  const set = (patch: Partial<ExtensionDraft["term"]>) => setDraft((d) => ({ ...d, term: { ...d.term, ...patch } }));
  const heading = `${extensionId ? "Edit" : "Add"} extension – ${lease.propertyName ?? ""} Unit ${lease.unitLabel ?? ""}`;
  const back = `/leases/${lease.id}`;

  useEffect(() => {
    if (refusals > 0) (summary.current ?? alertBox.current)?.focus();
  }, [refusals]);

  const save = async () => {
    setOther([]);
    setConflict(false);
    const found = extensionIssues(draft, todayNy());
    setIssues(found);
    if (Object.keys(found).length > 0) return setRefusals((n) => n + 1);
    setSaving(true);
    try {
      await saveExtension(extensionId ? { extensionId } : { leaseId: lease.id }, extensionBody(draft, lease.version));
      await queryClient.invalidateQueries();
      navigate(back);
    } catch (e) {
      const mapped: Record<string, string> = {};
      const rest: string[] = [];
      if (e instanceof FieldErrorsError) {
        for (const [field, message] of Object.entries(e.fields)) {
          const name = FORM_FIELD[field] ?? field;
          if (FORM_FIELDS.has(name)) mapped[name] = message;
          else rest.push(message);
        }
      } else if (e instanceof VersionConflictError) setConflict(true);
      else rest.push(e instanceof Error ? e.message : "Something went wrong. Please try again.");
      setIssues(mapped);
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
      <section className="max-w-xl space-y-4">
        <ProblemSummary ref={summary} items={Object.entries(issues).map(([name, text]) => ({ name, text }))} targetId={(name) => (name === "steps" ? fieldId("increaseType") : fieldId(name))} />
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
  return <Form lease={lease.data} extensionId={editing ? id : undefined} initial={extension.data ? draftFromExtension(extension.data) : newExtensionDraft(lease.data.effectiveEndDate)} />;
}
