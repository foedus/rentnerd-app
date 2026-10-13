import { useState, type FormEvent } from "react";
import { Button, Input, Label, TextField } from "react-aria-components";
import { Link } from "react-router";
import { RESET_SENT, requestPasswordReset } from "../api";
import { Page } from "../components/Page";

const INVALID_EMAIL = "Enter a valid email address.";

export function ForgotPassword() {
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const email = String(new FormData(e.currentTarget).get("email") ?? "").trim();
    setError("");
    setMessage("");
    if (!/^\S+@\S+$/.test(email)) {
      setError(INVALID_EMAIL);
      e.currentTarget.querySelector("input")?.focus();
      return;
    }
    setBusy(true);
    try {
      await requestPasswordReset(email);
      setMessage(RESET_SENT);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    }
    setBusy(false);
  };

  const input = "mt-1 block w-full min-h-6 rounded border px-3 py-1";
  return (
    <main className="mx-auto max-w-sm p-4">
      <Page title="Forgot password">
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          <TextField name="email" type="email" autoComplete="username" isRequired validationBehavior="aria" isInvalid={error === INVALID_EMAIL} className="block">
            <Label>Email (required)</Label>
            <Input className={input} />
          </TextField>
          <div role="status">{message}</div>
          <div role="alert" className="text-red-700">{error}</div>
          <Button type="submit" isDisabled={busy} className="min-h-6 rounded bg-slate-900 px-4 py-1 text-white">
            Send reset link
          </Button>
        </form>
        <p className="mt-4">
          <Link to="/login" className="inline-block min-h-6 underline">
            Back to sign in
          </Link>
        </p>
      </Page>
    </main>
  );
}
