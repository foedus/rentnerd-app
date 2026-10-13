import type { Db } from "../db/client";
import { auditLog } from "../db/schema";
import { currentIp } from "./request-context";

type AuditEntry = typeof auditLog.$inferInsert;
export type AuditAction = NonNullable<AuditEntry["action"]>;
export type AuditChanges = Record<string, [string | null, string | null]>;

/** Anything that looks like a credential is never written to the log (D-27, AC-AUD-05). */
const SECRET_FIELD = /password|hash|token|secret|session|cookie/i;

/** Human-readable `{label: [before, after]}` for the fields whose value differs; `null` shows as "—". */
export function diffChanges(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  labels: Record<string, string>,
  format: (value: unknown) => string = (v) => String(v),
): AuditChanges {
  const out: AuditChanges = {};
  for (const [key, label] of Object.entries(labels)) {
    if (SECRET_FIELD.test(key) || SECRET_FIELD.test(label)) continue;
    const [b, a] = [before[key], after[key]];
    if (b === a) continue;
    out[label] = [b == null ? null : format(b), a == null ? null : format(a)];
  }
  return out;
}

/** "Name: Ann → Ann Lee" lines for the Activity log's "Show changes". */
export const describeChanges = (changes: AuditChanges): string[] =>
  Object.entries(changes).map(([label, [b, a]]) => `${label}: ${b ?? "—"} → ${a ?? "—"}`);

const withoutSecrets = (changes: AuditChanges): AuditChanges =>
  Object.fromEntries(Object.entries(changes).filter(([label]) => !SECRET_FIELD.test(label)));

/**
 * Appends one audit row. Pass the transaction of the change itself so both commit or roll back together (D-27).
 * `ip` defaults to the current request's client address.
 */
export async function writeAudit(
  tx: Pick<Db, "insert">,
  entry: Omit<AuditEntry, "id" | "at" | "changes"> & { changes?: AuditChanges },
): Promise<void> {
  const { changes, ...rest } = entry;
  await tx.insert(auditLog).values({
    ip: currentIp(),
    ...rest,
    at: new Date(),
    changes: changes && Object.keys(changes).length > 0 ? withoutSecrets(changes) : null,
  });
}
