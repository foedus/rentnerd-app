import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button, FieldError, Input, Label, TextField } from "react-aria-components";
import { Link, useNavigate, useSearchParams } from "react-router";
import { INVALID_RESET, InvalidResetLinkError, resetPassword } from "../api";
import { Page } from "../components/Page";
import { newPasswordSchema } from "../../shared/schemas";

export function ResetPassword() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get("token") ?? "";
  const [invalid, setInvalid] = useState(token === "");
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ newPassword?: string; confirmPassword?: string }>({});
  const [busy, setBusy] = useState(false);
  const summaryRef = useRef<HTMLDivElement>(null);
  const invalidRef = useRef<HTMLParagraphElement>(null);
  const problems = Object.keys(fieldErrors).length;
  // After a failed submit focus moves to the summary; when the link turns out to be bad it moves to the message (AC-A11Y-05).
  useEffect(() => {
    if (problems > 0) summaryRef.current?.focus();
  }, [problems, fieldErrors]);
  useEffect(() => {
    if (invalid) invalidRef.current?.focus();
  }, [invalid]);

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const values = { newPassword: String(form.get("newPassword") ?? ""), confirmPassword: String(form.get("confirmPassword") ?? "") };
    const parsed = newPasswordSchema.safeParse(values);
    if (!parsed.success) {
      const next: typeof fieldErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] === "confirmPassword" ? "confirmPassword" : "newPassword";
        next[key] ??= issue.message;
      }
      setFieldErrors(next);
      return;
    }
    setFieldErrors({});
    setBusy(true);
    setError("");
    try {
      await resetPassword(token, values.newPassword);
    } catch (err) {
      if (err instanceof InvalidResetLinkError) setInvalid(true);
      else setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setBusy(false);
      return;
    }
    navigate("/login", { replace: true, state: { notice: "Your password has been reset. Please sign in." } });
  };

  const input = "mt-1 block w-full min-h-6 rounded border px-3 py-1";
  return (
    <main className="mx-auto max-w-sm p-4">
      <Page title="Reset password">
        {invalid ? (
          <>
            <p role="alert" tabIndex={-1} ref={invalidRef}>{INVALID_RESET}</p>
            <p className="mt-4">
              <Link to="/forgot-password" className="inline-block min-h-6 underline">
                Request a new link
              </Link>
            </p>
          </>
        ) : (
          <form onSubmit={onSubmit} noValidate className="space-y-4">
            {problems > 0 && (
              <div ref={summaryRef} tabIndex={-1} role="alert" className="rounded border border-red-700 p-3 text-red-700">
                <h2 className="font-semibold">There is a problem</h2>
                <ul>
                  {fieldErrors.newPassword && (
                    <li><a href="#new-password" className="underline">{fieldErrors.newPassword}</a></li>
                  )}
                  {fieldErrors.confirmPassword && (
                    <li><a href="#confirm-password" className="underline">{fieldErrors.confirmPassword}</a></li>
                  )}
                </ul>
              </div>
            )}
            <TextField name="newPassword" type="password" autoComplete="new-password" isInvalid={!!fieldErrors.newPassword} className="block">
              <Label>New password (required)</Label>
              <Input id="new-password" className={input} />
              <FieldError className="text-red-700">{fieldErrors.newPassword}</FieldError>
            </TextField>
            <TextField name="confirmPassword" type="password" autoComplete="new-password" isInvalid={!!fieldErrors.confirmPassword} className="block">
              <Label>Confirm new password (required)</Label>
              <Input id="confirm-password" className={input} />
              <FieldError className="text-red-700">{fieldErrors.confirmPassword}</FieldError>
            </TextField>
            <div role="alert" className="text-red-700">{error}</div>
            <Button type="submit" isDisabled={busy} className="min-h-6 rounded bg-slate-900 px-4 py-1 text-white">
              Reset password
            </Button>
          </form>
        )}
      </Page>
    </main>
  );
}
