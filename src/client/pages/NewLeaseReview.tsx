import { Button } from "react-aria-components";
import { formatCents, formatDate } from "../../shared/format";
import type { SpecialStepDraft, TermStepDraft, WizardTenantRow } from "../../shared/lease-wizard";
import { showsMoveOut } from "../../shared/lease-wizard";
import { forwardRef } from "react";
import { PROBLEM_TITLE } from "../../shared/form-messages";

const INCREASE_TEXT = { none: "None", percent: "Fixed percentage each year", schedule: "Custom schedule" } as const;

const money = (c: number | null) => (c === null ? "–" : formatCents(c));
const text = (s: string) => (s.trim() === "" ? "–" : s.trim());

/** Step 4 of the New lease wizard (SPEC §11.12): a summary of every value, then Save lease. */
export const ReviewStep = forwardRef<
  HTMLDivElement,
  {
    rows: readonly WizardTenantRow[]; primary: string | null; term: TermStepDraft; special: SpecialStepDraft; use: string; today: string;
    taxLine: string | null; onReplace: (() => void) | null; problems: string[]; saving: boolean; onSave: () => void;
  }
>(function ReviewStep({ rows, primary, term, special, use, today, taxLine, onReplace, problems, saving, onSave }, summary) {
  const items: [string, string][] = [
    ["Tenants", rows.map((r) => (r.key === primary ? `${r.name} (Primary contact)` : r.name)).join(", ")],
    ["Lease start date", formatDate(term.startDate)],
    ["Lease end date", formatDate(term.endDate)],
    ["Monthly rent", money(term.baseRentCents)],
    ["Security deposit", money(term.securityDepositCents)],
    ["Rent due day", term.rentDueDay.trim()],
    ["Late fee", money(term.lateFeeCents)],
    ["Late fee grace period (days)", text(term.lateFeeGraceDays)],
    ["Rent increases", INCREASE_TEXT[term.increaseType] + (term.increaseType === "percent" ? ` (${term.increasePercent.trim()}%)` : "")],
    ...(term.increaseType === "schedule" ? term.steps.map((s, i): [string, string] => [`Rent step ${i + 1}`, `${formatDate(s.effectiveDate)}: ${money(s.amountCents)}`]) : []),
    ...(showsMoveOut(term, today) && term.moveOutDate ? ([["Move-out date", formatDate(term.moveOutDate)], ["Reason", text(term.endReason)]] as [string, string][]) : []),
    ["Pets", text(special.pets)],
    ["Parking", text(special.parking)],
    ["Parking charge (monthly)", money(special.parkingChargeCents)],
    ...(use === "Commercial"
      ? ([["Base tax year", text(special.baseTaxYear)], ["Tenant's share of tax increase (%)", text(special.taxSharePercent)]] as [string, string][])
      : ([["Children reside in unit", text(special.childrenReside)]] as [string, string][])),
    ...(use === "Commercial" ? ([["Tax reimbursement (monthly)", taxLine ?? "–"]] as [string, string][]) : []),
    ["Break clause", text(special.breakClause)],
    ["Other special terms", text(special.otherTerms)],
  ];
  return (
    <section aria-labelledby="step-heading" className="max-w-xl space-y-4">
      {problems.length > 0 && (
        <div ref={summary} tabIndex={-1} role="alert" className="rounded border border-red-700 p-3 text-red-700">
          <h3 className="font-semibold">{PROBLEM_TITLE}</h3>
          <ul>
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}
      <dl aria-label="Lease summary" className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-x-4 gap-y-1">
        {items.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="font-medium">{label}</dt>
            <dd className="break-words whitespace-pre-wrap">{value}</dd>
          </div>
        ))}
      </dl>
      <div>
        <label htmlFor="lease-template" className="block">
          Lease template
        </label>
        <select id="lease-template" className="mt-1 block min-h-6 w-full rounded border px-3 py-1" value="">
          <option value="">None</option>
        </select>
      </div>
      <div className="flex gap-2">
        <Button onPress={onSave} isDisabled={saving} className="min-h-6 rounded bg-slate-900 px-4 py-1 text-white">
          Save lease
        </Button>
        {onReplace && (
          <Button onPress={onReplace} isDisabled={saving} className="min-h-6 rounded border px-4 py-1">
            Replace current lease
          </Button>
        )}
        <Button isDisabled className="min-h-6 rounded border px-4 py-1">
          Save and generate PDF
        </Button>
      </div>
    </section>
  );
});
