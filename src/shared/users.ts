export type UserRole = "admin" | "landlord" | "smoke";
export type UserStatus = "invited" | "active" | "deactivated";
export type InvitationState = "valid" | "expired" | "revoked" | "accepted";

export interface UserRow {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  lastSignInAt: string | null;
  invitation: { id: string; state: InvitationState } | null;
}

const roleLabels: Record<UserRole, string> = { admin: "Admin", landlord: "Landlord", smoke: "Smoke test (read-only)" };

export const roleLabel = (role: UserRole): string => roleLabels[role];

/** The Status column of the Users table (SPEC §11.23). An invited user with no live invitation shows why. */
export function userStatusLabel(u: Pick<UserRow, "status" | "invitation">): string {
  if (u.status === "active") return "Active";
  if (u.status === "deactivated") return "Deactivated";
  if (u.invitation?.state === "expired") return "Invitation expired";
  if (u.invitation?.state === "revoked") return "Invitation revoked";
  return "Invited";
}

export type RowAction = "resend" | "revoke" | "deactivate" | "reactivate";

/** The row actions of the Users table (SPEC §11.23). The Admin and Smoke rows have none. */
export function rowActions(u: Pick<UserRow, "role" | "status" | "invitation">): RowAction[] {
  if (u.role !== "landlord") return [];
  if (u.status === "active") return ["deactivate"];
  if (u.status === "deactivated") return ["reactivate"];
  if (!u.invitation) return [];
  return u.invitation.state === "valid" ? ["resend", "revoke"] : ["resend"];
}
