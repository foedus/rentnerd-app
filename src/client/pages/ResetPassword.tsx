import { useState, type FormEvent } from "react";
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
            <p role="alert">{INVALID_RESET}</p>
            <p className="mt-4">
              <Link to="/forgot-password" className="inline-block min-h-6 underline">
                Request a new link
              </Link>
            </p>
          </>
        ) : (
          <form onSubmit={onSubmit} noValidate className="space-y-4">
            <TextField name="newPassword" type="password" autoComplete="new-password" isInvalid={!!fieldErrors.newPassword} className="block">
              <Label>New password (required)</Label>
              <Input className={input} />
              <FieldError>{fieldErrors.newPassword}</FieldError>
            </TextField>
            <TextField name="confirmPassword" type="password" autoComplete="new-password" isInvalid={!!fieldErrors.confirmPassword} className="block">
              <Label>Confirm new password (required)</Label>
              <Input className={input} />
              <FieldError>{fieldErrors.confirmPassword}</FieldError>
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
