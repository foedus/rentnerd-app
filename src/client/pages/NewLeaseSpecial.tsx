import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { formatCents } from "../../shared/format";
import { taxReimbursement } from "../../shared/income";
import type { SpecialStepDraft } from "../../shared/lease-wizard";
import { fetchPropertyTaxes } from "../properties-api";
import { Field, fieldId, Money, ProblemSummary } from "./NewLeaseTerm";

const NO_TAX_YEARS_HINT = "Add tax years on the property's Property taxes tab to calculate tax reimbursement.";

/** Step 3 of the New lease wizard (SPEC §11.12): special terms. `issues` are shown after Next was refused. */
export function SpecialStep({
  draft, setDraft, issues, use, propertyId, focusSignal,
}: { draft: SpecialStepDraft; setDraft: (d: SpecialStepDraft) => void; issues: Record<string, string>; use: string; propertyId: string | undefined; focusSignal: number }) {
  const set = (patch: Partial<SpecialStepDraft>) => setDraft({ ...draft, ...patch });
  const commercial = use === "Commercial";
  const summary = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focusSignal > 0) summary.current?.focus();
  }, [focusSignal]);
  const taxes = useQuery({
    queryKey: ["property-taxes", propertyId],
    queryFn: () => fetchPropertyTaxes(propertyId as string),
    enabled: commercial && !!propertyId,
  });
  const years = taxes.data ?? [];
  const share = draft.taxSharePercent.trim();
  const reimbursement = taxReimbursement(
    years,
    draft.baseTaxYear === "" ? null : Number(draft.baseTaxYear),
    /^\d+(\.\d{1,4})?$/.test(share) && Number(share) > 0 && Number(share) <= 100 ? share : null,
  );
  return (
    <section aria-labelledby="step-heading" className="max-w-xl space-y-4">
      <ProblemSummary ref={summary} items={Object.entries(issues).map(([name, text]) => ({ name, text }))} targetId={fieldId} />
      <Field name="pets" label="Pets" error={issues.pets}>
        {(p) => <input {...p} type="text" autoComplete="off" value={draft.pets} onChange={(e) => set({ pets: e.target.value })} />}
      </Field>
      <Field name="parking" label="Parking" error={issues.parking}>
        {(p) => <input {...p} type="text" autoComplete="off" value={draft.parking} onChange={(e) => set({ parking: e.target.value })} />}
      </Field>
      <Money name="parkingChargeCents" label="Parking charge (monthly)" value={draft.parkingChargeCents} onChange={(v) => set({ parkingChargeCents: v })} error={issues.parkingChargeCents} />
      {!commercial && (
        <fieldset id={fieldId("childrenReside")} role="radiogroup" tabIndex={-1} aria-required aria-invalid={issues.childrenReside ? true : undefined} aria-describedby={issues.childrenReside ? `${fieldId("childrenReside")}-error` : undefined} className="space-y-1">
          <legend>Children reside in unit (required)</legend>
          {issues.childrenReside && (
            <p id={`${fieldId("childrenReside")}-error`} className="text-red-700">
              {issues.childrenReside}
            </p>
          )}
          {(["Yes", "No"] as const).map((o) => (
            <label key={o} className="flex min-h-6 items-center gap-2">
              <input type="radio" name="childrenReside" value={o} checked={draft.childrenReside === o} onChange={() => set({ childrenReside: o })} />
              {o}
            </label>
          ))}
        </fieldset>
      )}
      <Field name="breakClause" label="Break clause" error={issues.breakClause}>
        {(p) => <textarea {...p} rows={3} value={draft.breakClause} onChange={(e) => set({ breakClause: e.target.value })} />}
      </Field>
      <Field name="otherTerms" label="Other special terms" error={issues.otherTerms}>
        {(p) => <textarea {...p} rows={4} value={draft.otherTerms} onChange={(e) => set({ otherTerms: e.target.value })} />}
      </Field>
      {commercial && (
        <>
          <Field name="baseTaxYear" label="Base tax year" error={issues.baseTaxYear}>
            {(p) => (
              <select {...p} value={draft.baseTaxYear} onChange={(e) => set({ baseTaxYear: e.target.value })}>
                <option value="">Select…</option>
                {years.map((y) => (
                  <option key={y.taxYear} value={String(y.taxYear)}>
                    {y.taxYear}
                  </option>
                ))}
              </select>
            )}
          </Field>
          {taxes.isSuccess && years.length === 0 && <p className="text-slate-700">{NO_TAX_YEARS_HINT}</p>}
          {taxes.isError && <p role="alert">Couldn't load the property's tax years. Try again.</p>}
          <Field name="taxSharePercent" label="Tenant's share of tax increase (%)" error={issues.taxSharePercent}>
            {(p) => <input {...p} type="text" inputMode="decimal" autoComplete="off" value={draft.taxSharePercent} onChange={(e) => set({ taxSharePercent: e.target.value })} />}
          </Field>
          <p>
            <span className="font-medium">Tax reimbursement (monthly)</span>: {reimbursement ? formatCents(reimbursement.cents) : "–"}
            {reimbursement && <span className="block text-slate-700">{reimbursement.explanation}</span>}
          </p>
        </>
      )}
    </section>
  );
}
