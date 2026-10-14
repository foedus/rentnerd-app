import { forwardRef, useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "react-aria-components";
import { fieldLabel, PROBLEM_TITLE } from "../../shared/form-messages";
import { formatCents, formatDate, parseMoneyToCents } from "../../shared/format";
import { draftRentTerm, showsMoveOut, type TermStepDraft } from "../../shared/lease-wizard";
import { rentSchedule, type RentTerm } from "../../shared/rent";
import { END_REASONS } from "../../shared/schemas";
import { MoneyInput } from "../components/ui";

const INCREASES = [
  { value: "none", label: "None" },
  { value: "percent", label: "Fixed percentage each year" },
  { value: "schedule", label: "Custom schedule" },
] as const;

/** Row keys stay unique across Back and Next, which remount the step. */
let nextStepKey = 0;

export const fieldId = (name: string) => `term-${name.replace(/[^A-Za-z0-9_-]/g, "-")}`;
export const errorId = (name: string) => `${fieldId(name)}-error`;

/** Money typed into a field: cents, null when empty, NaN when it isn't an amount (so the check can say so). */
const centsOf = (text: string): number | null => {
  if (text.trim() === "") return null;
  const negative = /^\s*-/.test(text);
  const cents = parseMoneyToCents(text.replace(/^\s*-\s*/, ""));
  return cents === null ? Number.NaN : negative ? -cents : cents;
};

/** "Rent step 2: " in front of a message that belongs to a custom schedule row, so repeated messages can be told apart. */
function stepLabel(name: string, draft: TermStepDraft): string {
  const m = /^steps\.(.+)\.(date|amount)$/.exec(name);
  const index = m ? draft.steps.findIndex((s) => s.key === m[1]) : -1;
  return index >= 0 ? `Rent step ${index + 1}: ` : "";
}

export function Field({ name, label, required = false, error, children }: { name: string; label: string; required?: boolean; error?: string; children: (props: Record<string, unknown>) => ReactNode }) {
  return (
    <div>
      <label htmlFor={fieldId(name)} className="block">
        {fieldLabel(label, required)}
      </label>
      {error && (
        <p id={errorId(name)} className="text-red-700">
          {error}
        </p>
      )}
      {children({
        id: fieldId(name),
        "aria-required": required || undefined,
        "aria-invalid": error ? true : undefined,
        "aria-describedby": error ? errorId(name) : undefined,
        className: "mt-1 block min-h-6 w-full rounded border px-3 py-1",
      })}
    </div>
  );
}

export function Money({ name, label, required, value, onChange, error }: { name: string; label: string; required?: boolean; value: number | null; onChange: (v: number | null) => void; error?: string }) {
  return (
    <MoneyInput id={fieldId(name)} label={label} required={required} value={Number.isNaN(value) ? null : value} error={error} onChange={onChange} onTextChange={(t) => t.trim() !== "" && onChange(centsOf(t))} />
  );
}

/** The schedule, or nothing when the numbers are too large to work out (the fields show their own messages). */
function safeSchedule(term: RentTerm) {
  try {
    return rentSchedule(term);
  } catch {
    return [];
  }
}

function RentSchedule({ draft }: { draft: TermStepDraft }) {
  const term = draftRentTerm(draft);
  const periods = term ? safeSchedule(term) : [];
  return (
    <div>
      <h3 className="mb-1 font-semibold">Rent schedule</h3>
      <table aria-label="Rent schedule" className="w-full max-w-xl text-left">
        <thead>
          <tr>
            <th scope="col" className="py-1">Period start</th>
            <th scope="col" className="py-1">Period end</th>
            <th scope="col" className="py-1">Monthly rent</th>
          </tr>
        </thead>
        <tbody>
          {periods.length === 0 ? (
            <tr>
              <td colSpan={3} className="py-1 text-slate-700">Enter the dates and monthly rent to see the schedule.</td>
            </tr>
          ) : (
            periods.map((p) => (
              <tr key={p.periodStart} className="border-t">
                <td className="py-1">{formatDate(p.periodStart)}</td>
                <td className="py-1">{formatDate(p.periodEnd)}</td>
                <td className="py-1">{formatCents(p.rentCents)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

/** The "There is a problem" list shown after Next was refused; each message links to its field. */
export const ProblemSummary = forwardRef<HTMLDivElement, { items: { name: string; text: string }[]; targetId: (name: string) => string }>(function ProblemSummary({ items, targetId }, ref) {
  if (items.length === 0) return null;
  return (
    <div ref={ref} tabIndex={-1} role="alert" className="rounded border border-red-700 p-3 text-red-700">
      <h3 className="font-semibold">{PROBLEM_TITLE}</h3>
      <ul>
        {items.map(({ name, text }) => (
          <li key={name}>
            <a
              href={`#${targetId(name)}`}
              className="underline"
              onClick={(e) => {
                e.preventDefault();
                document.getElementById(targetId(name))?.focus();
              }}
            >
              {text}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
});

/** Step 2 of the New lease wizard (SPEC §11.12): term and rent. `issues` are shown after Next was refused. */
export function TermStep({ draft, setDraft, issues, today, focusSignal }: { draft: TermStepDraft; setDraft: (d: TermStepDraft) => void; issues: Record<string, string>; today: string; focusSignal: number }) {
  const set = (patch: Partial<TermStepDraft>) => setDraft({ ...draft, ...patch });
  const summary = useRef<HTMLDivElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [removed, setRemoved] = useState(0);
  const messages = Object.entries(issues);
  useEffect(() => {
    if (focusSignal > 0) summary.current?.focus();
  }, [focusSignal]);
  useEffect(() => {
    if (focusKey) document.getElementById(fieldId(`steps.${focusKey}.date`))?.focus();
  }, [focusKey]);
  useEffect(() => {
    if (removed > 0) addButton.current?.focus();
  }, [removed]);
  const updateStep = (key: string, patch: Partial<TermStepDraft["steps"][number]>) => set({ steps: draft.steps.map((s) => (s.key === key ? { ...s, ...patch } : s)) });
  return (
    <section aria-labelledby="step-heading" className="max-w-xl space-y-4">
      <ProblemSummary
        ref={summary}
        items={messages.map(([name, message]) => ({ name, text: `${stepLabel(name, draft)}${message}` }))}
        targetId={(name) => (name === "increaseType" || name === "steps" ? fieldId("increaseType") : fieldId(name))}
      />
      <Field name="startDate" label="Lease start date" required error={issues.startDate}>
        {(p) => <input {...p} type="date" value={draft.startDate} onChange={(e) => set({ startDate: e.target.value })} />}
      </Field>
      <Field name="endDate" label="Lease end date" required error={issues.endDate}>
        {(p) => <input {...p} type="date" value={draft.endDate} onChange={(e) => set({ endDate: e.target.value })} />}
      </Field>
      <Money name="baseRentCents" label="Monthly rent" required value={draft.baseRentCents} onChange={(v) => set({ baseRentCents: v })} error={issues.baseRentCents} />
      <Money name="securityDepositCents" label="Security deposit" value={draft.securityDepositCents} onChange={(v) => set({ securityDepositCents: v })} error={issues.securityDepositCents} />
      <Field name="rentDueDay" label="Rent due day" required error={issues.rentDueDay}>
        {(p) => <input {...p} type="text" inputMode="numeric" autoComplete="off" value={draft.rentDueDay} onChange={(e) => set({ rentDueDay: e.target.value })} />}
      </Field>
      <Money name="lateFeeCents" label="Late fee" value={draft.lateFeeCents} onChange={(v) => set({ lateFeeCents: v })} error={issues.lateFeeCents} />
      <Field name="lateFeeGraceDays" label="Late fee grace period (days)" error={issues.lateFeeGraceDays}>
        {(p) => <input {...p} type="text" inputMode="numeric" autoComplete="off" value={draft.lateFeeGraceDays} onChange={(e) => set({ lateFeeGraceDays: e.target.value })} />}
      </Field>
      <fieldset id={fieldId("increaseType")} role="radiogroup" tabIndex={-1} aria-invalid={issues.steps ? true : undefined} aria-describedby={issues.steps ? errorId("steps") : undefined} className="space-y-1">
        <legend>Rent increases</legend>
        {issues.steps && (
          <p id={errorId("steps")} className="text-red-700">
            {issues.steps}
          </p>
        )}
        {INCREASES.map((o) => (
          <label key={o.value} className="flex min-h-6 items-center gap-2">
            <input type="radio" name="increaseType" value={o.value} checked={draft.increaseType === o.value} onChange={() => set({ increaseType: o.value })} />
            {o.label}
          </label>
        ))}
      </fieldset>
      {draft.increaseType === "percent" && (
        <Field name="increasePercent" label="Annual increase (%)" required error={issues.increasePercent}>
          {(p) => <input {...p} type="text" inputMode="decimal" autoComplete="off" value={draft.increasePercent} onChange={(e) => set({ increasePercent: e.target.value })} />}
        </Field>
      )}
      {draft.increaseType === "schedule" && (
        <div className="space-y-3">
          {draft.steps.map((s, i) => (
            <div key={s.key} role="group" aria-label={`Rent step ${i + 1}`} className="flex flex-wrap items-end gap-3 rounded border p-3">
              <Field name={`steps.${s.key}.date`} label="Effective date" required error={issues[`steps.${s.key}.date`]}>
                {(p) => <input {...p} type="date" value={s.effectiveDate} onChange={(e) => updateStep(s.key, { effectiveDate: e.target.value })} />}
              </Field>
              <Money name={`steps.${s.key}.amount`} label="Monthly rent" required value={s.amountCents} onChange={(v) => updateStep(s.key, { amountCents: v })} error={issues[`steps.${s.key}.amount`]} />
              <Button
                onPress={() => {
                  set({ steps: draft.steps.filter((x) => x.key !== s.key) });
                  setRemoved((n) => n + 1);
                }}
                className="min-h-6 rounded border px-3 py-1"
              >
                Remove
              </Button>
            </div>
          ))}
          <Button ref={addButton} onPress={() => {
              const key = `step-${nextStepKey++}`;
              set({ steps: [...draft.steps, { key, effectiveDate: "", amountCents: null }] });
              setFocusKey(key);
            }} className="min-h-6 rounded border px-4 py-1">
            Add row
          </Button>
        </div>
      )}
      <RentSchedule draft={draft} />
      {showsMoveOut(draft, today) && (
        <>
          <Field name="moveOutDate" label="Move-out date" error={issues.moveOutDate}>
            {(p) => <input {...p} type="date" value={draft.moveOutDate} onChange={(e) => set({ moveOutDate: e.target.value })} />}
          </Field>
          <Field name="endReason" label="Reason" error={issues.endReason}>
            {(p) => (
              <select {...p} value={draft.endReason} onChange={(e) => set({ endReason: e.target.value })}>
                <option value="">Select…</option>
                {END_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </>
      )}
    </section>
  );
}
