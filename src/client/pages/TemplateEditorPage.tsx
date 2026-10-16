import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useFormContext } from "react-hook-form";
import { useLocation, useNavigate, useParams } from "react-router";
import { UNEXPECTED_MESSAGE, fieldErrorId, fieldId } from "../../shared/form-messages";
import { TEMPLATE_KIND_LABELS, TEMPLATE_KINDS, type TemplateKind } from "../../shared/placeholders";
import { createTemplateSchema } from "../../shared/template-schemas";
import { FieldErrorsError, UnauthenticatedError } from "../api";
import { AppForm, FormMessageError, SelectInput, TextFieldInput, useAppForm, VersionConflictError } from "../components/forms";
import { Page } from "../components/Page";
import { ConfirmDialog, ReasonButton } from "../components/ui";
import { useCanWrite } from "../me";
import { EMPTY_DOC } from "../template-editor/extensions";
import { TemplateEditor } from "../template-editor/TemplateEditor";
import { fetchTemplate, MissingTemplateError, saveTemplate, StaleTemplateError, templateAction, TemplateRefusedError, type TemplateRecord } from "../templates-api";

const KIND_OPTIONS = TEMPLATE_KINDS.map((value) => ({ value, label: TEMPLATE_KIND_LABELS[value] }));
const IN_USE_REASON = "Templates used for generated PDFs can only be archived";

/** The editor area, wired to the form's `content` value and its error. */
function ContentField({ template }: { template?: TemplateRecord }) {
  const { watch, setValue, getFieldState, formState } = useFormContext();
  const error = getFieldState("content", formState).error?.message;
  const kind = (template?.kind ?? watch("kind")) as TemplateKind | "";
  return (
    <div>
      <p className="block">Template content (required)</p>
      {error && (
        <p id={fieldErrorId("content")} className="text-red-700">
          {error}
        </p>
      )}
      {/* The editor is remounted when the type changes, because the placeholders on offer depend on it. */}
      <TemplateEditor
        key={kind}
        kind={kind || "master_lease"}
        content={watch("content") as Record<string, unknown>}
        id={fieldId("content")}
        describedBy={error ? fieldErrorId("content") : undefined}
        onChange={(doc) => setValue("content", doc, { shouldDirty: true })}
      />
    </div>
  );
}

function TemplateForm({ template, onChanged }: { template?: TemplateRecord; onChanged: (t: TemplateRecord) => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const form = useAppForm(createTemplateSchema, { name: template?.name ?? "", kind: template?.kind ?? "", content: template?.content ?? EMPTY_DOC } as never);
  return (
    <AppForm
      form={form}
      thing="Template"
      submitLabel="Save template"
      onReload={() => void queryClient.invalidateQueries({ queryKey: ["template", template?.id] })}
      save={async (values) => {
        let saved: TemplateRecord;
        try {
          saved = await saveTemplate(values, template && { id: template.id, version: template.version });
        } catch (err) {
          if (err instanceof StaleTemplateError) throw new VersionConflictError();
          if (err instanceof MissingTemplateError) throw new FormMessageError("This template no longer exists. Go to the Templates page to see the latest list.");
          if (err instanceof UnauthenticatedError) {
            void queryClient.invalidateQueries({ queryKey: ["me"] });
            throw new FormMessageError("Your session has ended. Sign in again to continue.");
          }
          throw err;
        }
        await queryClient.invalidateQueries({ queryKey: ["templates"] });
        if (template) onChanged(saved);
        else navigate(`/templates/${saved.id}`, { replace: true, state: { saved: "Template saved." } });
      }}
    >
      <TextFieldInput name="name" label="Template name" required />
      {template ? (
        <p>
          Template type: {TEMPLATE_KIND_LABELS[template.kind]}
        </p>
      ) : (
        <SelectInput name="kind" label="Template type" options={KIND_OPTIONS} required />
      )}
      <ContentField template={template} />
    </AppForm>
  );
}

/** Archive / Restore / Delete for a saved template. */
function TemplateActions({ template, onChanged }: { template: TemplateRecord; onChanged: (t: TemplateRecord | null) => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState("");
  const [confirming, setConfirming] = useState(false);
  async function run(action: "archive" | "restore" | "delete") {
    setMessage("");
    try {
      await templateAction(action, template);
      await queryClient.invalidateQueries({ queryKey: ["templates"] });
      if (action === "delete") {
        queryClient.removeQueries({ queryKey: ["template", template.id] });
        navigate("/templates", { state: { saved: "Template deleted." } });
        return;
      }
      onChanged(null);
      setMessage(action === "archive" ? "Template archived." : "Template restored.");
    } catch (err) {
      setMessage(
        err instanceof TemplateRefusedError ? err.message
        : err instanceof FieldErrorsError ? Object.values(err.fields)[0] ?? UNEXPECTED_MESSAGE
        : err instanceof StaleTemplateError ? "This template was changed by someone else. Reload the page and try again."
        : err instanceof MissingTemplateError ? "This template no longer exists. Go to the Templates page to see the latest list."
        : UNEXPECTED_MESSAGE,
      );
    }
  }
  return (
    <div className="mt-6 flex flex-wrap items-center gap-2">
      <ReasonButton onPress={() => void run(template.archivedAt ? "restore" : "archive")}>{template.archivedAt ? "Restore template" : "Archive template"}</ReasonButton>
      <ReasonButton onPress={() => setConfirming(true)} unavailableReason={template.hasDocuments ? IN_USE_REASON : undefined}>
        Delete template
      </ReasonButton>
      <p role="status" className={message ? "w-full" : "sr-only"}>
        {message}
      </p>
      <ConfirmDialog isOpen={confirming} onOpenChange={setConfirming} title="Delete this template?" confirmLabel="Delete template" onConfirm={() => void run("delete")}>
        <p>{`“${template.name}” will be removed for good.`}</p>
      </ConfirmDialog>
    </div>
  );
}

/** /templates/new and /templates/:id (§11.20). */
export function TemplateEditorPage() {
  const { id } = useParams();
  const canWrite = useCanWrite();
  const queryClient = useQueryClient();
  const flash = (useLocation().state as { saved?: string } | null)?.saved ?? "";
  const template = useQuery({ queryKey: ["template", id], queryFn: () => fetchTemplate(id ?? ""), enabled: !!id, gcTime: 0 });
  const refresh = (saved: TemplateRecord | null) => {
    if (saved) queryClient.setQueryData(["template", id], saved);
    else void queryClient.invalidateQueries({ queryKey: ["template", id] });
  };
  if (!id) {
    return (
      <Page title="New template">
        <div className="max-w-3xl">
          <TemplateForm onChanged={refresh} />
        </div>
      </Page>
    );
  }
  return (
    <Page title="Template details">
      <div className="max-w-3xl">
        <p role="status" className={flash ? "mb-2 text-green-800" : "sr-only"}>
          {flash}
        </p>
        {template.isPending && <p role="status">Loading…</p>}
        {template.isError && <p role="alert">{template.error instanceof MissingTemplateError ? "Template not found." : UNEXPECTED_MESSAGE}</p>}
        {template.data && canWrite && (
          <>
            <TemplateForm template={template.data} onChanged={refresh} />
            <TemplateActions template={template.data} onChanged={refresh} />
          </>
        )}
        {template.data && !canWrite && <ReadOnlyTemplate template={template.data} />}
      </div>
    </Page>
  );
}

function ReadOnlyTemplate({ template }: { template: TemplateRecord }) {
  return (
    <div className="space-y-4">
      <p>Template name: {template.name}</p>
      <p>Template type: {TEMPLATE_KIND_LABELS[template.kind]}</p>
      <TemplateEditor kind={template.kind} content={template.content} readOnly onChange={() => undefined} />
    </div>
  );
}

