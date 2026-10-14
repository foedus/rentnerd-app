/** Step 1 of the New lease wizard (SPEC §11.12): who is on the lease and who is the primary contact. */
export interface WizardTenantRow {
  /** Stable key for the row; the primary contact is chosen by key. */
  key: string;
  /** Set for an existing tenant; new tenants are only created when the lease is saved. */
  tenantId?: string;
  name: string;
}

export const NO_TENANTS_MESSAGE = "Add at least one tenant.";
export const NO_PRIMARY_MESSAGE = "Choose a primary contact.";

/** The message to show when the tenants step can't move on, or null when it can. */
export function tenantStepIssue(rows: readonly WizardTenantRow[], primaryKey: string | null): string | null {
  if (rows.length === 0) return NO_TENANTS_MESSAGE;
  if (!primaryKey || !rows.some((r) => r.key === primaryKey)) return NO_PRIMARY_MESSAGE;
  return null;
}
