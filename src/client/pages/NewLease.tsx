import { useQuery } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import { Button, ComboBox, Input, Label, ListBox, ListBoxItem, Popover } from "react-aria-components";
import { useNavigate, useParams } from "react-router";
import { addDays, isValidYmd, todayNy } from "../../shared/dates";
import { formatCents, formatDate } from "../../shared/format";
import { blankSpecialStep, blankTermStep, leaseRequestBody, specialStepIssues, tenantStepIssue, termStepIssues, type SpecialStepDraft, type TermStepDraft, type WizardTenantRow } from "../../shared/lease-wizard";
import { createTenantSchema, END_REASONS, TENANT_TYPES } from "../../shared/schemas";
import { AppForm, RadioGroupInput, TextFieldInput, useAppForm } from "../components/forms";
import { Page } from "../components/Page";
import { ConfirmDialog } from "../components/ui";
import { fetchUnit, UnitNotFoundError } from "../properties-api";
import { fetchTenants } from "../tenants-api";
import { FieldErrorsError } from "../api";
import { createLease, OverlapError } from "../leases-api";
import { ReviewStep } from "./NewLeaseReview";
import { draftTaxReimbursement, SpecialStep, usePropertyTaxYears } from "./NewLeaseSpecial";
import { TermStep } from "./NewLeaseTerm";
import { useWatch } from "react-hook-form";

const STEP_TITLES = ["Tenants", "Term and rent", "Special terms", "Review"] as const;
/** Names for the fields the server may refuse, so a message on the Review step says what it is about. */
const FIELD_NAMES: Record<string, string> = {
  tenants: "Tenants", newTenants: "Tenants", startDate: "Lease start date", endDate: "Lease end date", baseRentCents: "Monthly rent",
  securityDepositCents: "Security deposit", rentDueDay: "Rent due day", lateFeeCents: "Late fee", lateFeeGraceDays: "Late fee grace period (days)",
  increasePercent: "Annual increase (%)", rentSteps: "Rent increases", moveOutDate: "Move-out date", endReason: "Reason", pets: "Pets", parking: "Parking",
  parkingChargeCents: "Parking charge (monthly)", childrenReside: "Children reside in unit", breakClause: "Break clause", otherTerms: "Other special terms",
  baseTaxYear: "Base tax year", taxSharePercent: "Tenant's share of tax increase (%)",
};
const fieldProblem = (field: string, message: string) => {
  const name = FIELD_NAMES[field.split(".")[0] ?? ""];
  return name ? `${name}: ${message}` : message;
};
/** Remembers (for this browser tab) which wizard history entry saved a lease, so Back doesn't land on an empty form. */
const SAVED_ENTRY_KEY = "newLeaseSavedEntry";

/** A random token kept in this history entry's own state, so only this exact entry (not any entry with the same router key) is recognised later. */
function entryToken(): string {
  const state = (window.history.state ?? {}) as Record<string, unknown>;
  if (typeof state.newLeaseToken === "string") return state.newLeaseToken;
  const token = Math.random().toString(36).slice(2) + Date.now().toString(36);
  window.history.replaceState({ ...state, newLeaseToken: token }, "");
  return token;
}
const blankTenant = { tenantType: "", firstName: "", lastName: "", businessName: "", contactPerson: "", email: "", phone: "", notes: "" };

/** Asks before the person leaves the wizard (a link, a reload or closing the tab) with data they entered. */
function useDiscardGuard(dirty: boolean) {
  const navigate = useNavigate();
  // A link address to go to, or "back" for the browser's Back button.
  const [target, setTarget] = useState<string | null>(null);
  // The browser Back button can't be cancelled, so one extra history entry is kept on top (at most one) and put back after a Back.
  const guardEntry = useRef(false);
  const dirtyNow = useRef(dirty);
  dirtyNow.current = dirty;
  useEffect(() => {
    const onPop = () => {
      if (!guardEntry.current) return;
      if (!dirtyNow.current) {
        guardEntry.current = false; // Back used up the extra entry while nothing was entered
        return;
      }
      window.history.pushState(window.history.state, "");
      setTarget("back");
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  useEffect(() => {
    if (!dirty) return;
    if (!guardEntry.current) {
      window.history.pushState(window.history.state, "");
      guardEntry.current = true;
    }
    const onClick = (e: MouseEvent) => {
      const link = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!link || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      if (link.target && link.target !== "_self") return;
      const href = link.getAttribute("href") ?? "";
      // Only this app's own links (a path such as "/tenants"); the wizard's own address is not leaving.
      if (!href.startsWith("/") || href.startsWith("//") || href.split(/[?#]/)[0] === window.location.pathname) return;
      e.preventDefault();
      e.stopPropagation();
      setTarget(href);
    };
    const onUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    document.addEventListener("click", onClick, true);
    window.addEventListener("beforeunload", onUnload);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("beforeunload", onUnload);
    };
  }, [dirty]);
  return {
    open: target !== null,
    close: () => setTarget(null),
    discard: () => {
      const to = target;
      setTarget(null);
      if (to === "back") {
        // Past the extra entry and the wizard itself; the guard is already off once the wizard state is gone.
        window.history.go(-2);
      } else if (to) navigate(to);
    },
  };
}

function ExistingTenantPicker({ taken, onPick }: { taken: ReadonlySet<string>; onPick: (id: string, name: string, detail?: string) => void }) {
  const [text, setText] = useState("");
  // Picking a tenant remounts the box (new key), which closes its pop-up; focus is put back on the input.
  const [generation, setGeneration] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (generation > 0) input.current?.focus();
  }, [generation]);
  const results = useQuery({
    queryKey: ["tenants", "wizard-search", text.trim()],
    queryFn: () => fetchTenants({ q: text, archived: false, page: 1 }),
    enabled: text.trim().length > 0,
  });
  const items = (results.data?.data ?? []).filter((t) => !taken.has(t.id) && !t.archivedAt);
  return (
    <ComboBox
      inputValue={text}
      key={generation}
      onInputChange={(v) => setText(v.trimStart())}
      items={items}
      allowsEmptyCollection
      menuTrigger="input"
      selectedKey={null}
      onSelectionChange={(key) => {
        const picked = items.find((t) => t.id === key);
        if (!picked) return;
        onPick(picked.id, picked.displayName, picked.email ?? undefined);
        setText("");
        setGeneration((g) => g + 1);
      }}
      className="flex max-w-md flex-col gap-1"
    >
      <Label className="font-medium">Add existing tenant</Label>
      <Input ref={input} className="min-h-6 rounded border px-2 py-1" autoComplete="off" />
      <Popover className="w-(--trigger-width) rounded border bg-white shadow">
        <ListBox
          className="max-h-60 overflow-auto p-1"
          renderEmptyState={() => <p className="px-2 py-1 text-slate-700">{results.isPending ? "Searching…" : "No tenants found."}</p>}
        >
          {(t: (typeof items)[number]) => (
            <ListBoxItem id={t.id} textValue={t.displayName} className="min-h-6 cursor-pointer rounded px-2 py-1 data-[focused]:bg-slate-200">
              {t.displayName}
              {t.email ? <span className="ml-2 text-slate-700">{t.email}</span> : null}
            </ListBoxItem>
          )}
        </ListBox>
      </Popover>
    </ComboBox>
  );
}

function NewTenantForm({ onAdd, onCancel }: { onAdd: (name: string, values: Record<string, unknown>) => void; onCancel: () => void }) {
  const form = useAppForm(createTenantSchema, blankTenant as never);
  const type = useWatch({ control: form.control, name: "tenantType" }) as string;
  return (
    <div className="max-w-xl rounded border bg-white p-4">
      <h3 className="mb-2 font-semibold">New tenant</h3>
      <AppForm
        form={form}
        thing="Tenant"
        submitLabel="Add tenant"
        idPrefix="new-tenant-"
        secondary={
          <Button onPress={onCancel} className="min-h-6 rounded border px-4 py-1">
            Cancel
          </Button>
        }
        save={async (values) => {
          const v = values as Record<string, string | null | undefined>;
          const name = v.tenantType === "Business" ? `${v.businessName} (${v.contactPerson})` : `${v.firstName} ${v.lastName}`;
          onAdd(name, values as Record<string, unknown>);
        }}
      >
        <RadioGroupInput name="tenantType" legend="Tenant type" options={TENANT_TYPES} required />
        {type === "Individual" && (
          <>
            <TextFieldInput name="firstName" label="First name" required autoComplete="off" />
            <TextFieldInput name="lastName" label="Last name" required autoComplete="off" />
          </>
        )}
        {type === "Business" && (
          <>
            <TextFieldInput name="businessName" label="Business name" required autoComplete="off" />
            <TextFieldInput name="contactPerson" label="Contact person" required autoComplete="off" />
          </>
        )}
        <TextFieldInput name="email" label="Email" type="email" autoComplete="off" />
        <TextFieldInput name="phone" label="Phone" type="tel" autoComplete="off" />
        <TextFieldInput name="notes" label="Notes" />
      </AppForm>
    </div>
  );
}

interface Row extends WizardTenantRow {
  /** The email, shown so two tenants with the same name can be told apart. */
  detail?: string;
  /** Only for tenants created with the lease. */
  newTenant?: Record<string, unknown>;
}

function TenantsStep({
  rows, setRows, primary, setPrimary, error,
}: { rows: Row[]; setRows: (r: Row[]) => void; primary: string | null; setPrimary: (k: string | null) => void; error: string | null }) {
  const [adding, setAdding] = useState(false);
  const addButton = useRef<HTMLButtonElement>(null);
  const errorId = useId();
  const nextKey = useRef(0);
  const add = (row: Omit<Row, "key">) => setRows([...rows, { ...row, key: `row-${nextKey.current++}` }]);
  const taken = new Set(rows.flatMap((r) => (r.tenantId ? [r.tenantId] : [])));
  return (
    <section aria-labelledby="step-heading" className="space-y-4">
      <ExistingTenantPicker taken={taken} onPick={(tenantId, name, detail) => add({ tenantId, name, detail })} />
      {adding ? (
        <NewTenantForm
          onAdd={(name, newTenant) => {
            add({ name, newTenant, detail: typeof newTenant.email === "string" ? newTenant.email : undefined });
            setAdding(false);
            queueMicrotask(() => addButton.current?.focus());
          }}
          onCancel={() => {
            setAdding(false);
            queueMicrotask(() => addButton.current?.focus());
          }}
        />
      ) : (
        <Button ref={addButton} onPress={() => setAdding(true)} className="min-h-6 rounded border px-4 py-1">
          Add new tenant
        </Button>
      )}
      {rows.length > 0 && (
        <table aria-label="Tenants on this lease" className="w-full max-w-xl text-left">
          <thead>
            <tr>
              <th scope="col" className="py-1">Name</th>
              <th scope="col" className="py-1">Primary contact</th>
              <th scope="col" className="py-1"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-t">
                <td id={`${r.key}-name`} className="py-1">
                  {r.name}
                  {r.detail ? <span className="ml-2 text-slate-700">{r.detail}</span> : null}
                  {r.newTenant ? <span className="ml-2 text-slate-700">(new)</span> : null}
                </td>
                <td className="py-1">
                  <label className="inline-flex min-h-6 items-center gap-2">
                    <input
                      type="radio"
                      name="primaryContact"
                      checked={primary === r.key}
                      onChange={() => setPrimary(r.key)}
                      aria-describedby={`${r.key}-name${error ? ` ${errorId}` : ""}`}
                    />
                    Primary contact
                  </label>
                </td>
                <td className="py-1">
                  <Button
                    onPress={() => {
                      setRows(rows.filter((x) => x.key !== r.key));
                      if (primary === r.key) setPrimary(null);
                      queueMicrotask(() => addButton.current?.focus());
                    }}
                    aria-describedby={`${r.key}-name`}
                    className="min-h-6 rounded border px-3 py-1"
                  >
                    Remove
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-red-800">
          {error}
        </p>
      )}
    </section>
  );
}

/** /units/:id/leases/new: Step X of 4 (SPEC §11.12). */
export function NewLease() {
  const { id = "" } = useParams();
  const unit = useQuery({ queryKey: ["unit", id], queryFn: () => fetchUnit(id), gcTime: 0 });
  const [step, setStep] = useState(1);
  const [rows, setRows] = useState<Row[]>([]);
  const [primary, setPrimary] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [term, setTerm] = useState<TermStepDraft>(blankTermStep);
  // Shown after Next was refused, then kept in step with what the person fixes.
  const [termIssues, setTermIssues] = useState<Record<string, string> | null>(null);
  const [termRefusals, setTermRefusals] = useState(0);
  const [special, setSpecial] = useState<SpecialStepDraft>(blankSpecialStep);
  const [specialIssues, setSpecialIssues] = useState<Record<string, string> | null>(null);
  const [specialRefusals, setSpecialRefusals] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveProblems, setSaveProblems] = useState<string[]>([]);
  const [saveRefusals, setSaveRefusals] = useState(0);
  const reviewSummary = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const [canReplace, setCanReplace] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [replaceReason, setReplaceReason] = useState("Replaced by new lease");
  const today = todayNy();
  const use = unit.data?.use === "Commercial" ? "Commercial" : "Residential";
  const taxYears = usePropertyTaxYears(unit.data?.propertyId, use === "Commercial");
  const taxResult = draftTaxReimbursement(taxYears.data ?? [], special);
  const guard = useDiscardGuard(rows.length > 0);

  // Once a message is showing, keep it in step with what the person fixes.
  useEffect(() => {
    setError((e) => (e === null ? null : tenantStepIssue(rows, primary)));
  }, [rows, primary]);
  useEffect(() => {
    setTermIssues((i) => (i === null ? null : termStepIssues(term, todayNy())));
  }, [term]);
  useEffect(() => {
    setSpecialIssues((i) => (i === null ? null : specialStepIssues(special, use)));
  }, [special, use]);
  // An offer to replace the current lease belongs to the dates it was refused for.
  useEffect(() => {
    setCanReplace(false);
  }, [rows, primary, term]);
  // Back from a lease this wizard saved lands here again: go to the unit instead of showing an empty form.
  useEffect(() => {
    if (sessionStorage.getItem(SAVED_ENTRY_KEY) === entryToken()) {
      sessionStorage.removeItem(SAVED_ENTRY_KEY);
      navigate(`/units/${id}`, { replace: true });
    }
  }, [id, navigate]);
  // Moving between steps puts focus on the step heading, so keyboard and screen reader users start at the new step.
  const firstStep = useRef(true);
  useEffect(() => {
    if (firstStep.current) {
      firstStep.current = false;
      return;
    }
    document.getElementById("step-heading")?.focus();
  }, [step]);
  useEffect(() => {
    if (saveRefusals > 0) reviewSummary.current?.focus();
  }, [saveRefusals]);

  const next = () => {
    if (step === 1) {
      const issue = tenantStepIssue(rows, primary);
      setError(issue);
      if (issue) return;
    }
    if (step === 2) {
      const issues = termStepIssues(term, today);
      if (Object.keys(issues).length > 0) {
        setTermIssues(issues);
        setTermRefusals((n) => n + 1);
        return;
      }
      setTermIssues(null);
    }
    if (step === 3) {
      const issues = specialStepIssues(special, use);
      if (Object.keys(issues).length > 0) {
        setSpecialIssues(issues);
        setSpecialRefusals((n) => n + 1);
        return;
      }
      setSpecialIssues(null);
    }
    setStep(step + 1);
  };

  const save = async (replaceReason?: string) => {
    setSaving(true);
    setSaveProblems([]);
    try {
      const body = leaseRequestBody(rows, primary, term, special, use, today);
      const saved = await createLease(id, replaceReason ? { ...body, replaceCurrentLease: { endReason: replaceReason } } : body);
      sessionStorage.setItem(SAVED_ENTRY_KEY, entryToken());
      navigate(`/leases/${saved.id}`, { replace: true });
    } catch (e) {
      setCanReplace(e instanceof OverlapError && e.canReplace);
      setSaveProblems(e instanceof FieldErrorsError ? Object.entries(e.fields).map(([f, m]) => fieldProblem(f, m)) : [e instanceof Error ? e.message : "Something went wrong. Please try again."]);
      setSaveRefusals((n) => n + 1);
      setSaving(false);
    }
  };

  if (unit.isPending) return <Page title="New lease"><p role="status">Loading…</p></Page>;
  if (unit.isError) {
    return (
      <Page title="New lease">
        <p role="alert">{unit.error instanceof UnitNotFoundError ? "Unit not found." : unit.error.message}</p>
      </Page>
    );
  }
  return (
    <Page title="New lease">
      <p className="mb-1 text-slate-700">
        {unit.data.property?.name} Unit {unit.data.label}
      </p>
      <p className="mb-4 font-medium">Step {step} of 4</p>
      <h2 id="step-heading" tabIndex={-1} className="mb-3 text-xl font-semibold outline-offset-2 focus:outline focus:outline-2">
        {STEP_TITLES[step - 1]}
      </h2>
      {step === 1 && <TenantsStep rows={rows} setRows={setRows} primary={primary} setPrimary={setPrimary} error={error} />}
      {step === 2 && <TermStep draft={term} setDraft={setTerm} issues={termIssues ?? {}} today={today} focusSignal={termRefusals} />}
      {step === 3 && <SpecialStep draft={special} setDraft={setSpecial} issues={specialIssues ?? {}} use={use} propertyId={unit.data.propertyId} focusSignal={specialRefusals} />}
      {step === 4 && <ReviewStep ref={reviewSummary} rows={rows} primary={primary} term={term} special={special} use={use} today={today} taxLine={taxResult ? formatCents(taxResult.cents) : null} problems={saveProblems} saving={saving} onSave={() => save()} onReplace={canReplace ? () => setReplacing(true) : null} />}
      <div className="mt-6 flex gap-2">
        {step > 1 && (
          <Button onPress={() => setStep(step - 1)} className="min-h-6 rounded border px-4 py-1">
            Back
          </Button>
        )}
        {step < 4 && (
          <Button onPress={next} className="min-h-6 rounded bg-slate-900 px-4 py-1 text-white">
            Next
          </Button>
        )}
      </div>
      <ConfirmDialog
        isOpen={replacing}
        onOpenChange={(o) => !o && setReplacing(false)}
        title={`End the current lease on ${isValidYmd(term.startDate) ? formatDate(addDays(term.startDate, -1)) : "the day before the new lease starts"} and start this one?`}
        confirmLabel="Replace current lease"
        onConfirm={() => {
          setReplacing(false);
          void save(replaceReason);
        }}
      >
        <label htmlFor="replace-reason" className="block">
          Reason
        </label>
        <select id="replace-reason" value={replaceReason} onChange={(e) => setReplaceReason(e.target.value)} className="mt-1 block min-h-6 w-full rounded border px-3 py-1">
          {END_REASONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </ConfirmDialog>
      <ConfirmDialog
        isOpen={guard.open}
        onOpenChange={(o) => !o && guard.close()}
        title="Discard this lease? Your changes will be lost."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        onConfirm={guard.discard}
      />
    </Page>
  );
}
