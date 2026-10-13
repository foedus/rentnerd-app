import { zodResolver } from "@hookform/resolvers/zod";
import { createContext, useContext, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Button } from "react-aria-components";
import {
  FormProvider,
  useForm,
  useFormContext,
  type DefaultValues,
  type FieldErrors,
  type FieldValues,
  type UseFormReturn,
} from "react-hook-form";
import type { z } from "zod";
import {
  CONFLICT_MESSAGE,
  fieldErrorId,
  fieldId,
  fieldLabel,
  PROBLEM_TITLE,
  savedMessage,
  UNEXPECTED_MESSAGE,
} from "../../shared/form-messages";
import { TooManyRequestsError } from "../api";

const SAVED_EVENT = "appform-saved";

/** Throw from a save function when the API answers 409 (version mismatch, D-10). */
export class VersionConflictError extends Error {}

/** Throw from a save function to show this exact text instead of the generic unexpected-error message. */
export class FormMessageError extends Error {}

type Status = { kind: "idle" } | { kind: "saved"; thing: string; message?: string } | { kind: "conflict" } | { kind: "error"; message: string };

interface FormKit {
  status: Status;
}
const KitContext = createContext<FormKit>({ status: { kind: "idle" } });

/** Form state validated by the same Zod schema the API uses. Errors show after the first submit. */
export function useAppForm<S extends z.ZodType<FieldValues, FieldValues>>(schema: S, defaultValues?: DefaultValues<z.input<S>>) {
  return useForm<z.input<S>, unknown, z.output<S>>({
    resolver: zodResolver(schema as never) as never,
    defaultValues,
    shouldFocusError: false,
  });
}

interface FlatError {
  path: string;
  message: string;
}

export function flattenErrors(errors: FieldErrors, prefix = ""): FlatError[] {
  const out: FlatError[] = [];
  for (const [key, value] of Object.entries(errors)) {
    if (!value || typeof value !== "object") continue;
    const path = prefix ? `${prefix}.${key}` : key;
    const message = (value as { message?: unknown }).message;
    if (typeof message === "string" && message) out.push({ path, message });
    else out.push(...flattenErrors(value as FieldErrors, path));
  }
  return out;
}

/** "There is a problem" summary; takes focus after each failed submit and links to every field with an error. */
export function ErrorSummary() {
  const {
    formState: { errors, submitCount },
  } = useFormContext();
  const ref = useRef<HTMLDivElement>(null);
  const list = flattenErrors(errors);
  const shown = submitCount > 0 && list.length > 0;
  useEffect(() => {
    if (shown) ref.current?.focus();
  }, [submitCount, shown]);
  if (!shown) return null;
  return (
    <div ref={ref} tabIndex={-1} role="alert" className="rounded border border-red-700 p-3 text-red-700">
      <h2 className="font-semibold">{PROBLEM_TITLE}</h2>
      <ul>
        {list.map((e) => (
          <li key={e.path}>
            <a
              href={`#${fieldId(e.path)}`}
              className="underline"
              onClick={(ev) => {
                ev.preventDefault();
                document.getElementById(fieldId(e.path))?.focus();
              }}
            >
              {e.message}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Messages({ onReload }: { onReload?: () => void }) {
  const { status } = useContext(KitContext);
  const errorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (status.kind === "error" || status.kind === "conflict") errorRef.current?.focus();
  }, [status]);
  return (
    <>
      {/* Always rendered so assistive technology sees the text being inserted into an existing live region. */}
      <div role="status" aria-live="polite" className={status.kind === "saved" ? "text-green-800" : "sr-only"}>
        {status.kind === "saved" ? status.message ?? savedMessage(status.thing) : ""}
      </div>
      <div role="alert" tabIndex={-1} ref={errorRef} className="text-red-700">
        {status.kind === "error" && status.message}
        {status.kind === "conflict" && (
          <>
            <p>{CONFLICT_MESSAGE}</p>
            <Button
              onPress={() => (onReload ? onReload() : window.location.reload())}
              className="mt-2 min-h-6 rounded border border-red-700 px-3 py-1"
            >
              Reload
            </Button>
          </>
        )}
      </div>
    </>
  );
}

interface AppFormProps<V extends FieldValues, O> {
  form: UseFormReturn<V, unknown, O>;
  /** What was saved, e.g. "Owner" gives "Owner saved." Return normally to show it. */
  thing: string;
  /** Replaces "{thing} saved." for actions that aren't saves, e.g. "Password changed." */
  successMessage?: string;
  /** Throw VersionConflictError on 409; any other error shows the unexpected-error message. */
  save: (values: O) => Promise<void>;
  onReload?: () => void;
  children: ReactNode;
  submitLabel: string;
  /** Rendered next to the submit button, e.g. a Cancel button. */
  secondary?: ReactNode;
}

/** `<form>` wrapper: validation, error summary, saved/conflict/unexpected messages and a submit button. */
export function AppForm<V extends FieldValues, O>({ form, thing, successMessage, save, onReload, children, submitLabel, secondary }: AppFormProps<V, O>) {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [busy, setBusy] = useState(false);
  const submitButton = useRef<HTMLButtonElement>(null);
  const formId = useId();
  // When another form on the page reports a save, this form's own "saved" message is out of date.
  useEffect(() => {
    const onOtherSaved = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== formId) setStatus((s) => (s.kind === "saved" ? { kind: "idle" } : s));
    };
    window.addEventListener(SAVED_EVENT, onOtherSaved);
    return () => window.removeEventListener(SAVED_EVENT, onOtherSaved);
  }, [formId]);
  // A "saved" message is out of date as soon as the person edits again.
  useEffect(() => {
    const sub = form.watch(() => setStatus((s) => (s.kind === "saved" ? { kind: "idle" } : s)));
    return () => sub.unsubscribe();
  }, [form]);
  // The button is disabled while sending, which drops focus; put it back unless an error message took it.
  useEffect(() => {
    if (!busy && status.kind === "saved" && (document.activeElement === document.body || !document.activeElement)) {
      submitButton.current?.focus();
    }
  }, [busy, status]);
  const submit = form.handleSubmit(async (values) => {
    setBusy(true);
    setStatus({ kind: "idle" });
    try {
      await save(values);
      window.dispatchEvent(new CustomEvent(SAVED_EVENT, { detail: formId }));
      setStatus({ kind: "saved", thing, message: successMessage });
    } catch (err) {
      if (err instanceof VersionConflictError) setStatus({ kind: "conflict" });
      else if (err instanceof FormMessageError) setStatus({ kind: "error", message: err.message });
      else setStatus({ kind: "error", message: err instanceof TooManyRequestsError ? err.message : UNEXPECTED_MESSAGE });
    } finally {
      setBusy(false);
    }
  });
  return (
    <FormProvider {...(form as unknown as UseFormReturn<FieldValues>)}>
      <KitContext.Provider value={{ status }}>
        <form
          noValidate
          onSubmit={(e: FormEvent<HTMLFormElement>) => {
            void submit(e);
          }}
          className="space-y-4"
        >
          <ErrorSummary />
          {children}
          <Messages onReload={onReload} />
          <div className="flex gap-2">
            <Button ref={submitButton} type="submit" isDisabled={busy} className="min-h-6 rounded bg-slate-900 px-4 py-1 text-white">
              {submitLabel}
            </Button>
            {secondary}
          </div>
        </form>
      </KitContext.Provider>
    </FormProvider>
  );
}

interface TextFieldProps {
  name: string;
  label: string;
  required?: boolean;
  type?: "text" | "email" | "password" | "date" | "number" | "tel";
  autoComplete?: string;
  hint?: string;
}

/** Labelled input; "(required)" is added to the label and the error is linked with aria-describedby. */
export function TextFieldInput({ name, label, required = false, type = "text", autoComplete, hint }: TextFieldProps) {
  const {
    register,
    getFieldState,
    formState,
  } = useFormContext();
  const error = getFieldState(name, formState).error?.message;
  const hintId = `${fieldId(name)}-hint`;
  const describedBy = [error ? fieldErrorId(name) : "", hint ? hintId : ""].filter(Boolean).join(" ") || undefined;
  return (
    <div>
      <label htmlFor={fieldId(name)} className="block">
        {fieldLabel(label, required)}
      </label>
      {hint && (
        <p id={hintId} className="text-sm text-slate-700">
          {hint}
        </p>
      )}
      {error && (
        <p id={fieldErrorId(name)} className="text-red-700">
          {error}
        </p>
      )}
      <input
        id={fieldId(name)}
        type={type}
        autoComplete={autoComplete}
        aria-required={required || undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className="mt-1 block min-h-6 w-full rounded border px-3 py-1"
        {...register(name)}
      />
    </div>
  );
}

interface SelectFieldProps {
  name: string;
  label: string;
  options: readonly string[];
  required?: boolean;
}

/** Labelled native select with an empty first choice; errors are linked like TextFieldInput. */
export function SelectInput({ name, label, options, required = false }: SelectFieldProps) {
  const { register, getFieldState, formState } = useFormContext();
  const error = getFieldState(name, formState).error?.message;
  return (
    <div>
      <label htmlFor={fieldId(name)} className="block">
        {fieldLabel(label, required)}
      </label>
      {error && (
        <p id={fieldErrorId(name)} className="text-red-700">
          {error}
        </p>
      )}
      <select
        id={fieldId(name)}
        aria-required={required || undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? fieldErrorId(name) : undefined}
        className="mt-1 block min-h-6 w-full rounded border px-3 py-1"
        {...register(name)}
      >
        <option value="">Select…</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </div>
  );
}
