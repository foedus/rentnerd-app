import type { Role } from "../shared/routes";
import type { UserRow } from "../shared/users";

export interface Me {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: string;
}

export class UnauthenticatedError extends Error {}
export class TooManyRequestsError extends Error {}

export async function fetchMe(): Promise<Me> {
  const res = await fetch("/api/me", { headers: { accept: "application/json" } });
  if (res.status === 401) throw new UnauthenticatedError("Not signed in");
  if (res.status === 429) throw new TooManyRequestsError("Too many attempts. Try again in a few minutes.");
  if (!res.ok) throw new Error("Something went wrong. Please try again.");
  return (await res.json()) as Me;
}

export async function signOut(): Promise<void> {
  const res = await fetch("/api/auth/sign-out", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  if (!res.ok) throw new Error("Something went wrong. Please try again.");
}

export class SignInError extends Error {}

/** Signs in with email and password. 429 and every refusal get their §11.1 wording; nothing else is revealed. */
export async function signIn(email: string, password: string): Promise<void> {
  const res = await fetch("/api/auth/sign-in/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (res.ok) return;
  if (res.status === 429) throw new SignInError("Too many attempts. Try again in a few minutes.");
  throw new SignInError("Incorrect email or password.");
}

export const RESET_SENT = "If an account exists for that email, we've sent a reset link.";
export const INVALID_RESET = "This reset link is invalid or has expired.";
export const TOO_MANY = "Too many attempts. Try again in a few minutes.";

/** Asks for a reset email. The answer never says whether an account exists; only a 429 is reported. */
export async function requestPasswordReset(email: string): Promise<void> {
  const res = await fetch("/api/auth/request-password-reset", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (res.status === 429) throw new TooManyRequestsError(TOO_MANY);
  if (!res.ok && res.status >= 500) throw new Error("Something went wrong. Please try again.");
}

export class InvalidResetLinkError extends Error {}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
  const res = await fetch("/api/auth/reset-password", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token, newPassword }),
  });
  if (res.ok) return;
  if (res.status === 429) throw new TooManyRequestsError(TOO_MANY);
  if (res.status !== 400 && res.status !== 404) throw new Error("Something went wrong. Please try again.");
  throw new InvalidResetLinkError(INVALID_RESET);
}

export const INVALID_INVITE = "This invitation is invalid or has expired. Ask the administrator to send a new one.";

export class InvalidInvitationError extends Error {}

export interface InvitationInfo {
  email: string;
  name: string;
}

export async function lookupInvitation(token: string): Promise<InvitationInfo> {
  const res = await fetch(`/api/invitations/lookup?token=${encodeURIComponent(token)}`, { headers: { accept: "application/json" } });
  if (res.ok) return (await res.json()) as InvitationInfo;
  if (res.status === 429) throw new TooManyRequestsError(TOO_MANY);
  if (res.status >= 500) throw new Error("Something went wrong. Please try again.");
  throw new InvalidInvitationError(INVALID_INVITE);
}

/** Accepts the invitation; the server signs the new user in (session cookie). */
export async function acceptInvitation(token: string, name: string, password: string): Promise<void> {
  const res = await fetch("/api/invitations/accept", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token, name, password }),
  });
  if (res.ok) return;
  if (res.status === 429) throw new TooManyRequestsError(TOO_MANY);
  if (res.status >= 500) throw new Error("Something went wrong. Please try again.");
  throw new InvalidInvitationError(INVALID_INVITE);
}

export const DUPLICATE_USER = "A user with this email already exists.";
export class DuplicateUserError extends Error {}

export interface UsersPage {
  data: UserRow[];
  page: number;
  pageSize: number;
  total: number;
}

export async function fetchUsers(page: number): Promise<UsersPage> {
  const res = await fetch(`/api/users?page=${page}`, { headers: { accept: "application/json" } });
  if (res.status === 429) throw new TooManyRequestsError(TOO_MANY);
  if (!res.ok) throw new Error("Something went wrong. Please try again.");
  return (await res.json()) as UsersPage;
}

export async function inviteLandlord(name: string, email: string): Promise<void> {
  const res = await fetch("/api/invitations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, email }),
  });
  if (res.ok) return;
  if (res.status === 409) throw new DuplicateUserError(DUPLICATE_USER);
  if (res.status === 429) throw new TooManyRequestsError(TOO_MANY);
  throw new Error("Something went wrong. Please try again.");
}
