import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Button, FieldError, Input, Label, TextField } from "react-aria-components";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router";
import { fetchMe, signIn, SignInError } from "../api";
import { Page } from "../components/Page";

/** Only same-site paths are accepted after sign-in, so a crafted link can't send people to another site. */
export function safeNext(next: string | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\") || [...next].some((ch) => ch.charCodeAt(0) < 32)) return "/";
  if (/^\/login\/?([?#]|$)/.test(next)) return "/";
  return next;
}

export function Login() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const { data: me, error: meError } = useQuery({ queryKey: ["me"], queryFn: fetchMe });
  // Someone who is already signed in has no use for the form.
  if (me && !meError && !busy) return <Navigate to={safeNext(params.get("next"))} replace />;

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      await signIn(String(form.get("email") ?? "").trim(), String(form.get("password") ?? ""));
    } catch (err) {
      setError(err instanceof SignInError ? err.message : "Something went wrong. Please try again.");
      setBusy(false);
      return;
    }
    queryClient.clear();
    navigate(safeNext(params.get("next")), { replace: true });
  };

  const input = "mt-1 block w-full min-h-6 rounded border px-3 py-1";
  return (
    <main className="mx-auto max-w-sm p-4">
      <Page title="Sign in">
        <form onSubmit={onSubmit} className="space-y-4">
          <TextField name="email" type="email" autoComplete="username" isRequired className="block">
            <Label>Email (required)</Label>
            <Input className={input} />
            <FieldError />
          </TextField>
          <TextField name="password" type="password" autoComplete="current-password" isRequired className="block">
            <Label>Password (required)</Label>
            <Input className={input} />
            <FieldError />
          </TextField>
          <div role="alert" className="text-red-700">{error}</div>
          <Button type="submit" isDisabled={busy} className="min-h-6 rounded bg-slate-900 px-4 py-1 text-white">
            Sign in
          </Button>
        </form>
        <p className="mt-4">
          <Link to="/forgot-password" className="inline-block min-h-6 underline">
            Forgot password?
          </Link>
        </p>
      </Page>
    </main>
  );
}
