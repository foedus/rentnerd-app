import { useRef, useState } from "react";
import { Button } from "react-aria-components";
import { IMPORT_SHEETS, IMPORT_TEMPLATE_FILENAME } from "../../shared/import-template";
import { UNEXPECTED_MESSAGE } from "../../shared/form-messages";
import type { ImportProblem } from "../../shared/import-validate";
import { Page } from "../components/Page";

const buttonClass = "min-h-6 rounded border px-3 py-1";

/** Fetches the workbook and hands it to the browser as a file download. */
export async function downloadImportTemplate(): Promise<void> {
  const res = await fetch("/api/import/template");
  if (!res.ok) throw new Error(UNEXPECTED_MESSAGE);
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = IMPORT_TEMPLATE_FILENAME;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

type Outcome = { errors: ImportProblem[]; counts: Record<string, number> };

/** Uploads the file for checking; failures come back as the message to show. */
export async function checkImportUpload(file: File | undefined): Promise<Outcome | { message: string }> {
  if (!file) return { message: "Choose an .xlsx file." };
  const body = new FormData();
  body.append("file", file);
  const res = await fetch("/api/import/validate", { method: "POST", body });
  const json = (await res.json().catch(() => null)) as (Outcome & { error?: undefined }) | { error?: { message?: string } } | null;
  if (res.ok && json && "errors" in json) return json;
  return { message: json?.error?.message ?? UNEXPECTED_MESSAGE };
}

function Problems({ errors }: { errors: ImportProblem[] }) {
  return (
    <section aria-labelledby="import-problems">
      <h2 id="import-problems" className="font-semibold">
        We found {errors.length} {errors.length === 1 ? "problem" : "problems"}. Fix them in the spreadsheet and check the file again.
      </h2>
      <table aria-label="Problems" className="mt-2 w-full border-collapse text-left">
        <thead>
          <tr>{["Sheet", "Row", "Column", "Problem"].map((h) => <th key={h} scope="col" className="border-b px-2 py-1">{h}</th>)}</tr>
        </thead>
        <tbody>
          {errors.map((e, i) => (
            <tr key={i}>
              <td className="border-b px-2 py-1">{e.sheet}</td>
              <td className="border-b px-2 py-1">{e.row ?? ""}</td>
              <td className="border-b px-2 py-1">{e.column ?? ""}</td>
              <td className="border-b px-2 py-1">{e.problem}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** /import (§11.22): instructions, the template download and the file check. Committing comes with a later task. */
export function Import() {
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const busy = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const check = async () => {
    if (busy.current) return;
    setError(null);
    setOutcome(null);
    busy.current = true;
    try {
      const result = await checkImportUpload(input.current?.files?.[0]);
      if ("message" in result) setError(result.message);
      else setOutcome(result);
    } catch {
      setError(UNEXPECTED_MESSAGE);
    } finally {
      busy.current = false;
    }
  };
  const n = (sheet: string) => outcome?.counts[sheet] ?? 0;
  return (
    <Page title="Import">
      <div className="max-w-3xl space-y-3">
        <p>Bring your existing portfolio into RentNerd from a spreadsheet.</p>
        <ol className="list-decimal space-y-1 pl-6">
          <li>Download the template.</li>
          <li>Fill in the sheets {IMPORT_SHEETS.join(", ")}. The Instructions sheet explains every column.</li>
          <li>Upload the file and check it. Nothing is imported until the check finds no problems and you confirm.</li>
        </ol>
        <p>Import only creates new records; it never changes existing ones.</p>
        <Button
          className={buttonClass}
          onPress={() => {
            setError(null);
            downloadImportTemplate().catch(() => setError(UNEXPECTED_MESSAGE));
          }}
        >
          Download template
        </Button>
        <div className="space-y-1">
          <label htmlFor="import-file" className="block font-medium">Spreadsheet file</label>
          <input id="import-file" ref={input} type="file" accept=".xlsx" aria-describedby="import-file-hint" />
          <p id="import-file-hint" className="text-sm">An .xlsx file, 5 MB or smaller.</p>
        </div>
        <Button className={buttonClass} onPress={() => void check()}>
          Check file
        </Button>
        {error && <p role="alert" className="text-red-700">{error}</p>}
        <div aria-live="polite">
          {outcome && outcome.errors.length > 0 && <Problems errors={outcome.errors} />}
          {outcome && outcome.errors.length === 0 && (
            <div className="space-y-2">
              <p>
                Ready to import: {n("Owners")} owners, {n("Properties")} properties, {n("Units")} units, {n("Tenants")} tenants, {n("Leases")} leases.
              </p>
              <Button className={buttonClass} onPress={() => { setOutcome(null); if (input.current) { input.current.value = ""; input.current.focus(); } }}>
                Cancel
              </Button>
            </div>
          )}
        </div>
      </div>
    </Page>
  );
}
