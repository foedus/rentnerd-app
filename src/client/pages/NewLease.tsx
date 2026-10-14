import { useQuery } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import { Button, ComboBox, Input, Label, ListBox, ListBoxItem, Popover } from "react-aria-components";
import { useNavigate, useParams } from "react-router";
import { todayNy } from "../../shared/dates";
import { blankTermStep, tenantStepIssue, termStepIssues, type TermStepDraft, type WizardTenantRow } from "../../shared/lease-wizard";
import { createTenantSchema, TENANT_TYPES } from "../../shared/schemas";
import { AppForm, RadioGroupInput, TextFieldInput, useAppForm } from "../components/forms";
import { Page } from "../components/Page";
import { ConfirmDialog } from "../components/ui";
import { fetchUnit, UnitNotFoundError } from "../properties-api";
import { fetchTenants } from "../tenants-api";
import { TermStep } from "./NewLeaseTerm";
import { useWatch } from "react-hook-form";

const STEP_TITLES = ["Tenants", "Term and rent", "Special terms", "Review"] as const;
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

/** /units/:id/leases/new: Step X of 4 (SPEC §11.12). Steps 3 and 4 are added by the following tasks. */
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
  const today = todayNy();
  const guard = useDiscardGuard(rows.length > 0);

  // Once a message is showing, keep it in step with what the person fixes.
  useEffect(() => {
    setError((e) => (e === null ? null : tenantStepIssue(rows, primary)));
  }, [rows, primary]);
  useEffect(() => {
    setTermIssues((i) => (i === null ? null : termStepIssues(term, todayNy())));
  }, [term]);

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
    setStep(step + 1);
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
      <h2 id="step-heading" className="mb-3 text-xl font-semibold">
        {STEP_TITLES[step - 1]}
      </h2>
      {step === 1 && <TenantsStep rows={rows} setRows={setRows} primary={primary} setPrimary={setPrimary} error={error} />}
      {step === 2 && <TermStep draft={term} setDraft={setTerm} issues={termIssues ?? {}} today={today} focusSignal={termRefusals} />}
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
