import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button, FieldError, Input, Label, TextField } from "react-aria-components";
import { useNavigate, useSearchParams } from "react-router";
import { acceptInvitation, INVALID_INVITE, InvalidInvitationError, lookupInvitation, TooManyRequestsError } from "../api";
import { Page } from "../components/Page";
import { acceptInviteFormSchema } from "../../shared/schemas";

type Field = "name" | "password" | "confirmPassword";
const anchors: Record<Field, string> = { name: "invite-name", password: "invite-password", confirmPassword: "invite-confirm" };

export function AcceptInvite() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const token = params.get("token") ?? "";
  const lookup = useQuery({
    queryKey: ["invitation", token],
    queryFn: () => lookupInvitation(token),
    enabled: token !== "",
    retry: false,
    gcTime: 0,
  });
  const [used, setUsed] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<Field, string>>>({});
  const [busy, setBusy] = useState(false);
  const summaryRef = useRef<HTMLDivElement>(null);
  const invalidRef = useRef<HTMLParagraphElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const problems = Object.keys(fieldErrors).length;
  const invalid = token === "" || used || lookup.error instanceof InvalidInvitationError;
  useEffect(() => {
    if (problems > 0) summaryRef.current?.focus();
  }, [problems, fieldErrors]);
  // The submit button is disabled while sending, which drops focus; put it on the message when the request fails.
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);
  useEffect(() => {
    if (invalid) invalidRef.current?.focus();
  }, [invalid]);

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const values = {
      name: String(form.get("name") ?? ""),
      password: String(form.get("password") ?? ""),
      confirmPassword: String(form.get("confirmPassword") ?? ""),
    };
    const parsed = acceptInviteFormSchema.safeParse(values);
    if (!parsed.success) {
      const next: typeof fieldErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as Field;
        next[key] ??= issue.message;
      }
      setFieldErrors(next);
      return;
    }
    setFieldErrors({});
    setBusy(true);
    setError("");
    try {
      await acceptInvitation(token, parsed.data.name, values.password);
    } catch (err) {
      if (err instanceof InvalidInvitationError) setUsed(true);
      else setError(err instanceof TooManyRequestsError ? err.message : "Something went wrong. Please try again.");
      setBusy(false);
      return;
    }
    queryClient.clear();
    navigate("/", { replace: true });
  };

  const input = "mt-1 block w-full min-h-6 rounded border px-3 py-1";
  return (
    <main className="mx-auto max-w-sm p-4">
      <Page title="Accept invitation">
        {invalid ? (
          <p role="alert" tabIndex={-1} ref={invalidRef}>{INVALID_INVITE}</p>
        ) : lookup.error ? (
          <p role="alert">{lookup.error.message}</p>
        ) : !lookup.data ? (
          <p role="status">Loading…</p>
        ) : (
          <form onSubmit={onSubmit} noValidate className="space-y-4">
            <p>You&apos;re joining RentNerd as {lookup.data.email}.</p>
            {problems > 0 && (
              <div ref={summaryRef} tabIndex={-1} role="alert" className="rounded border border-red-700 p-3 text-red-700">
                <h2 className="font-semibold">There is a problem</h2>
                <ul>
                  {(Object.keys(anchors) as Field[]).map(
                    (f) => fieldErrors[f] && (
                      <li key={f}><a href={`#${anchors[f]}`} className="underline">{fieldErrors[f]}</a></li>
                    ),
                  )}
                </ul>
              </div>
            )}
            <TextField name="name" defaultValue={lookup.data.name} autoComplete="name" isInvalid={!!fieldErrors.name} className="block">
              <Label>Your name (required)</Label>
              <Input id={anchors.name} className={input} />
              <FieldError>{fieldErrors.name}</FieldError>
            </TextField>
            <TextField name="password" type="password" autoComplete="new-password" isInvalid={!!fieldErrors.password} className="block">
              <Label>Password (required)</Label>
              <Input id={anchors.password} className={input} />
              <FieldError>{fieldErrors.password}</FieldError>
            </TextField>
            <TextField name="confirmPassword" type="password" autoComplete="new-password" isInvalid={!!fieldErrors.confirmPassword} className="block">
              <Label>Confirm password (required)</Label>
              <Input id={anchors.confirmPassword} className={input} />
              <FieldError>{fieldErrors.confirmPassword}</FieldError>
            </TextField>
            <div role="alert" tabIndex={-1} ref={errorRef} className="text-red-700">{error}</div>
            <Button type="submit" isDisabled={busy} className="min-h-6 rounded bg-slate-900 px-4 py-1 text-white">
              Create account
            </Button>
          </form>
        )}
      </Page>
    </main>
  );
}
