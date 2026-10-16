import type { ReactNode } from "react";
import { Link } from "react-router";
import { Page } from "../components/Page";

const Code = ({ children }: { children: ReactNode }) => <code className="[overflow-wrap:anywhere] rounded bg-gray-100 px-1">{children}</code>;

const EXTENSION_KEYS = [
  "extension_start_date",
  "extension_end_date",
  "extension_monthly_rent",
  "previous_end_date",
  "previous_monthly_rent",
  "previous_tenant_names",
  "removed_tenant_names",
  "added_tenant_names",
];

/** /help/templates: SPEC.md Appendix A as an in-app page (§11.20). */
export function HelpTemplates() {
  return (
    <Page title="Converting a Word lease">
      <div className="max-w-3xl space-y-3">
        <p>How to turn an existing Word lease into a RentNerd template.</p>
        <ol className="list-decimal space-y-3 pl-6">
          <li>
            Open your existing lease in Microsoft Word. (If you only have a PDF, open the PDF in Word first: <strong>File → Open</strong>, choose the PDF, and accept the conversion. Check the result for errors.)
          </li>
          <li>
            Remove anything that varies per tenant, and type the matching <Code>{"{{key}}"}</Code> in its place. For example, replace “John and Jane Smith” with <Code>{"{{tenant_names}}"}</Code>, and “$2,150” with <Code>{"{{monthly_rent}}"}</Code>. Keep a printed copy of the key list beside you.
          </li>
          <li>
            Signature lines: replace the tenant signature area with <Code>{"{{tenant_signature_blocks}}"}</Code>, and type the owner block as normal text using <Code>{"{{owner_name}}"}</Code> and <Code>{"{{owner_signatory}}"}</Code>.
          </li>
          <li>Remove headers, footers, logos, images and page numbers. (RentNerd strips them anyway when you paste, and adds its own footer with page numbers.)</li>
          <li>
            In Word press <strong>Ctrl+A</strong> (Mac: <strong>⌘A</strong>) then <strong>Ctrl+C</strong> (<strong>⌘C</strong>).
          </li>
          <li>
            In RentNerd go to <strong>Templates → New template</strong>. Enter a <strong>Template name</strong>, choose the <strong>Template type</strong>, click in the editor and paste (<strong>Ctrl+V</strong> / <strong>⌘V</strong>).
          </li>
          <li>
            Check the warning “Unrecognised placeholders” and fix any misspelled keys, either by retyping or with <strong>Insert placeholder</strong>. You can’t save until every placeholder is recognised.
          </li>
          <li>
            Fix headings, bold text and numbered clauses with the toolbar if the paste lost them. Insert <strong>Page break</strong> where you want a new page.
          </li>
          <li>
            Click <strong>Preview PDF</strong> and compare it with your original. Repeat until it’s right, then <strong>Save template</strong>.
          </li>
          <li>
            Create a separate <strong>Lease extension</strong> template the same way, using the extension keys (
            {EXTENSION_KEYS.map((k, i) => (
              <span key={k}>
                {i > 0 && ", "}
                <Code>{`{{${k}}}`}</Code>
              </span>
            ))}
            ). In an extension template, the ordinary keys such as <Code>{"{{tenant_names}}"}</Code> and <Code>{"{{monthly_rent}}"}</Code> print the extension’s values.
          </li>
        </ol>
        <p>
          <Link to="/templates" className="text-blue-800 underline">
            Back to Templates
          </Link>
        </p>
      </div>
    </Page>
  );
}
