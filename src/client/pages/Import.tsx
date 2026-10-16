import { useState } from "react";
import { Button } from "react-aria-components";
import { IMPORT_SHEETS, IMPORT_TEMPLATE_FILENAME } from "../../shared/import-template";
import { UNEXPECTED_MESSAGE } from "../../shared/form-messages";
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

/** /import (§11.22): instructions and the template download. Upload, check and commit come with later tasks. */
export function Import() {
  const [error, setError] = useState<string | null>(null);
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
        {error && <p role="alert" className="text-red-700">{error}</p>}
      </div>
    </Page>
  );
}
