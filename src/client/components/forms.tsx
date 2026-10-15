import { zodResolver } from "@hookform/resolvers/zod";
import { createContext, useContext, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Button } from "react-aria-components";
import {
  Controller,
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
import { FieldErrorsError, TooManyRequestsError } from "../api";
import { parseMoneyToCents } from "../../shared/format";
import { MoneyInput } from "./ui";

const SAVED_EVENT = "appform-saved";

/** "1,200" and "1,200.5" read as 1200 and 1200.5; anything else (e.g. "1,5") is left for the schema to refuse. */
export const withoutThousandsCommas = (v: string) => (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(v) ? v.replaceAll(",", "") : v);

/** Throw from a save function when the API answers 409 (version mismatch, D-10). */
export class VersionConflictError extends Error {}

/** Throw from a save function to show this exact text instead of the generic unexpected-error message. */
export class FormMessageError extends Error {}

type Status = { kind: "idle" } | { kind: "saved"; thing: string; message?: string } | { kind: "conflict" } | { kind: "error"; message: string };

interface FormKit {
  status: Status;
}
/** Prefix for field ids, so a form in a dialog doesn't repeat the ids of the page behind it. */
const IdPrefixContext = createContext("");
function useIds() {
  const prefix = useContext(IdPrefixContext);
  return { id: (name: string) => prefix + fieldId(name), err: (name: string) => prefix + fieldErrorId(name) };
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
  const ids = useIds();
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
              href={`#${ids.id(e.path)}`}
              className="underline"
              onClick={(ev) => {
                ev.preventDefault();
                document.getElementById(ids.id(e.path))?.focus();
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
              onPress={() => {
                if (!onReload) return window.location.reload();
                onReload();
                // The reloaded form replaces this one (and the button with it); put focus on its first field.
                setTimeout(() => {
                  if (document.activeElement === document.body) document.querySelector<HTMLElement>("form input, form select, form textarea")?.focus();
                }, 300);
              }}
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
  /** Prepended to field ids when the form sits in a dialog over another form. */
  idPrefix?: string;
}

/** `<form>` wrapper: validation, error summary, saved/conflict/unexpected messages and a submit button. */
export function AppForm<V extends FieldValues, O>({ form, thing, successMessage, save, onReload, children, submitLabel, secondary, idPrefix = "" }: AppFormProps<V, O>) {
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
      else if (err instanceof FieldErrorsError) {
        for (const [name, message] of Object.entries(err.fields)) form.setError(name as never, { message });
        setStatus({ kind: "idle" });
      } else if (err instanceof FormMessageError) setStatus({ kind: "error", message: err.message });
      else setStatus({ kind: "error", message: err instanceof TooManyRequestsError ? err.message : UNEXPECTED_MESSAGE });
    } finally {
      setBusy(false);
    }
  });
  return (
    <FormProvider {...(form as unknown as UseFormReturn<FieldValues>)}>
      <IdPrefixContext.Provider value={idPrefix}>
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
      </IdPrefixContext.Provider>
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
  /** Blank gives null and anything else a number (non-numbers reach the schema as NaN and get its message). */
  numeric?: boolean;
  /** With `numeric`: ask for a keyboard that has a decimal point. */
  decimal?: boolean;
}

/** Labelled input; "(required)" is added to the label and the error is linked with aria-describedby. */
export function TextFieldInput({ name, label, required = false, type = "text", autoComplete, hint, numeric = false, decimal = false }: TextFieldProps) {
  const ids = useIds();
  const {
    register,
    getFieldState,
    formState,
  } = useFormContext();
  const error = getFieldState(name, formState).error?.message;
  const hintId = `${ids.id(name)}-hint`;
  const describedBy = [error ? ids.err(name) : "", hint ? hintId : ""].filter(Boolean).join(" ") || undefined;
  return (
    <div>
      <label htmlFor={ids.id(name)} className="block">
        {fieldLabel(label, required)}
      </label>
      {hint && (
        <p id={hintId} className="text-sm text-slate-700">
          {hint}
        </p>
      )}
      {error && (
        <p id={ids.err(name)} className="text-red-700">
          {error}
        </p>
      )}
      <input
        id={ids.id(name)}
        type={type}
        autoComplete={autoComplete}
        aria-required={required || undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className="mt-1 block min-h-6 w-full rounded border px-3 py-1"
        inputMode={numeric ? (decimal ? "decimal" : "numeric") : undefined}
        {...register(name, numeric ? { setValueAs: (v: unknown) => (v === null || v === undefined || String(v).trim() === "" ? null : Number(withoutThousandsCommas(String(v).trim()))) } : undefined)}
      />
    </div>
  );
}

interface SelectFieldProps {
  name: string;
  label: string;
  options: readonly (string | { value: string; label: string })[];
  required?: boolean;
  /** Text of the empty first choice. */
  emptyLabel?: string;
}

/** Labelled native select with an empty first choice; errors are linked like TextFieldInput. */
export function SelectInput({ name, label, options, required = false, emptyLabel = "Select…" }: SelectFieldProps) {
  const ids = useIds();
  const { register, getFieldState, formState } = useFormContext();
  const error = getFieldState(name, formState).error?.message;
  return (
    <div>
      <label htmlFor={ids.id(name)} className="block">
        {fieldLabel(label, required)}
      </label>
      {error && (
        <p id={ids.err(name)} className="text-red-700">
          {error}
        </p>
      )}
      <select
        id={ids.id(name)}
        aria-required={required || undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? ids.err(name) : undefined}
        className="mt-1 block min-h-6 w-full rounded border px-3 py-1"
        {...register(name)}
      >
        <option value="">{emptyLabel}</option>
        {options.map((o) => {
          const { value, label: text } = typeof o === "string" ? { value: o, label: o } : o;
          return (
            <option key={value} value={value}>
              {text}
            </option>
          );
        })}
      </select>
    </div>
  );
}

interface CheckboxProps {
  name: string;
  label: string;
  onChange?: (checked: boolean) => void;
}

/** Labelled checkbox bound to a boolean form value. */
export function CheckboxInput({ name, label, onChange }: CheckboxProps) {
  const ids = useIds();
  const { register } = useFormContext();
  return (
    <label className="flex min-h-6 items-center gap-2">
      <input id={ids.id(name)} type="checkbox" {...register(name, { onChange: (e: { target: HTMLInputElement }) => onChange?.(e.target.checked) })} />
      {label}
    </label>
  );
}

interface ChoiceGroupProps {
  name: string;
  legend: string;
  choices: readonly { id: string; label: string }[];
  required?: boolean;
}

/** Group of checkboxes bound to an array of ids; the error is linked to the group. */
export function CheckboxGroupInput({ name, legend, choices, required = false }: ChoiceGroupProps) {
  const ids = useIds();
  const { control, getFieldState, formState } = useFormContext();
  const error = getFieldState(name, formState).error?.message;
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => {
        const chosen: string[] = field.value ?? [];
        return (
          <fieldset
            id={ids.id(name)}
            tabIndex={-1}
            aria-required={required || undefined}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? ids.err(name) : undefined}
            className="space-y-1"
          >
            <legend>{fieldLabel(legend, required)}</legend>
            {error && (
              <p id={ids.err(name)} className="text-red-700">
                {error}
              </p>
            )}
            {choices.map((c) => (
              <label key={c.id} className="flex min-h-6 items-center gap-2">
                <input
                  type="checkbox"
                  checked={chosen.includes(c.id)}
                  onChange={(e) => field.onChange(e.target.checked ? [...chosen, c.id] : chosen.filter((x) => x !== c.id))}
                />
                {c.label}
              </label>
            ))}
          </fieldset>
        );
      }}
    />
  );
}

interface RadioGroupProps {
  name: string;
  legend: string;
  options: readonly string[];
  required?: boolean;
}

/** Group of radio buttons bound to a string value; the error is linked to the group. */
export function RadioGroupInput({ name, legend, options, required = false }: RadioGroupProps) {
  const ids = useIds();
  const { register, getFieldState, formState } = useFormContext();
  const error = getFieldState(name, formState).error?.message;
  return (
    <fieldset
      id={ids.id(name)}
      role="radiogroup"
      tabIndex={-1}
      aria-required={required || undefined}
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? ids.err(name) : undefined}
      className="space-y-1"
    >
      <legend>{fieldLabel(legend, required)}</legend>
      {error && (
        <p id={ids.err(name)} className="text-red-700">
          {error}
        </p>
      )}
      {options.map((o) => (
        <label key={o} className="flex min-h-6 items-center gap-2">
          <input type="radio" value={o} {...register(name)} />
          {o}
        </label>
      ))}
    </fieldset>
  );
}

/** Money field bound to integer cents (null when empty). */
export function MoneyFieldInput({ name, label, required = false }: { name: string; label: string; required?: boolean }) {
  const ids = useIds();
  const { control, getFieldState, formState } = useFormContext();
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <MoneyInput
          id={ids.id(name)}
          label={label}
          required={required}
          value={typeof field.value === "number" ? field.value : null}
          onChange={field.onChange}
          // Text that isn't an amount goes on as NaN so the schema can say so, instead of looking like an empty field.
          onTextChange={(text) => {
            if (text.trim() === "") return;
            // A leading minus goes on as a negative amount so the schema can say so; other text that isn't an amount is NaN.
            const negative = /^\s*-/.test(text) ? parseMoneyToCents(text.replace(/^\s*-\s*/, "")) : null;
            if (negative !== null) field.onChange(-negative);
            else if (parseMoneyToCents(text) === null) field.onChange(Number.NaN);
          }}
          error={getFieldState(name, formState).error?.message}
        />
      )}
    />
  );
}
