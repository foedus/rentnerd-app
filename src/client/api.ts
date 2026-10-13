import type { Role } from "../shared/routes";

export interface Me {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: string;
}

export class UnauthenticatedError extends Error {}

export async function fetchMe(): Promise<Me> {
  const res = await fetch("/api/me", { headers: { accept: "application/json" } });
  if (res.status === 401) throw new UnauthenticatedError("Not signed in");
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
