import { z } from "zod";
import { COMPLIANCE_STATUSES } from "./compliance";
import { COMPLIANCE_APPLIES_TO } from "./compliance-rules";
import { isValidYmd, todayNy } from "./dates";
import { listQuerySchema } from "./schemas";

const SCHEDULE_TYPES = ["annual_date", "interval", "one_time"] as const;
const VERSION = z.number().int().min(1, "version is required");
const date = (message = "Enter a valid date.") => z.string({ error: message }).refine(isValidYmd, message);
/** A real calendar date in a sensible range, so typos like 0001-01-01 or 9999-12-31 are refused. */
const sensibleDate = (message = "Enter a valid date.") => date(message).refine((v) => v >= "2000-01-01" && v <= "2100-12-31", "Enter a date between 2000 and 2100.");
const optionalText = (max: number) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), z.string().trim().max(max, `Use ${max} characters or fewer.`).nullable());
/** Blank gives null; whole numbers written as text (from a select) are accepted. */
const intField = (message: string) =>
  z.preprocess((v) => (v === "" ? null : typeof v === "string" && /^\d{1,6}$/.test(v.trim()) ? Number(v) : v), z.number({ error: message }).int(message).nullable());

/** §6.13 fields before the cross-field schedule rules. */
const typeFields = z.object({
  name: z.string({ error: "Enter the item type name." }).trim().min(1, "Enter the item type name.").max(200, "Use 200 characters or fewer."),
  description: optionalText(2000).optional(),
  appliesTo: z.enum(COMPLIANCE_APPLIES_TO, { error: "Choose who this applies to." }),
  nycOnly: z.boolean({ error: "Choose Yes or No." }),
  scheduleType: z.enum(SCHEDULE_TYPES, { error: "Choose a schedule." }),
  dueMonth: intField("Choose a month and day.").optional(),
  dueDay: intField("Choose a month and day.").optional(),
  intervalMonths: intField("Enter a whole number of months from 1 to 120.").optional(),
});

export type ComplianceTypeFields = z.infer<typeof typeFields>;
type Schedule = Pick<ComplianceTypeFields, "scheduleType" | "dueMonth" | "dueDay" | "intervalMonths">;

/** Drops the fields that don't belong to the chosen schedule so the stored row satisfies the table's check. */
export function normalizeSchedule<T extends Schedule>(t: T): T & { dueMonth: number | null; dueDay: number | null; intervalMonths: number | null } {
  const annual = t.scheduleType === "annual_date";
  return { ...t, dueMonth: annual ? (t.dueMonth ?? null) : null, dueDay: annual ? (t.dueDay ?? null) : null, intervalMonths: t.scheduleType === "interval" ? (t.intervalMonths ?? null) : null };
}

/** The schedule must be complete for its type; Feb 29 is not allowed as a yearly date (§6.13). */
export function scheduleProblems(t: Schedule): Record<string, string> {
  if (t.scheduleType === "annual_date") {
    const { dueMonth: m, dueDay: d } = t;
    const ok = m != null && d != null && m >= 1 && m <= 12 && isValidYmd(`2027-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
    if (ok) return {};
    // One message when nothing was chosen; otherwise point at the part that is missing or wrong.
    return m == null && d == null ? { dueMonth: "Choose a month and day." } : { dueMonth: "Choose a month and day.", dueDay: "Choose a month and day." };
  }
  if (t.scheduleType === "interval") {
    const n = t.intervalMonths;
    return n != null && n >= 1 && n <= 120 ? {} : { intervalMonths: "Enter a whole number of months from 1 to 120." };
  }
  return {};
}

const withScheduleRules = <S extends z.ZodType<Schedule>>(schema: S) =>
  schema.superRefine((t, ctx) => {
    for (const [key, message] of Object.entries(scheduleProblems(t))) ctx.addIssue({ code: "custom", path: [key], message });
  });

export const createComplianceTypeSchema = withScheduleRules(typeFields);
/** PATCH: any subset; the server validates the merged schedule with `scheduleProblems`. */
export const updateComplianceTypeSchema = typeFields.partial().extend({ version: VERSION });

export const complianceTypeListQuerySchema = listQuerySchema.extend({ archived: z.enum(["true", "false"]).default("false") });

/** `status` accepts one status or a comma-separated list, e.g. "Overdue,Due soon,Upcoming". */
export const complianceItemListQuerySchema = listQuerySchema.extend({
  propertyId: z.uuid({ error: "Choose a valid property." }).optional(),
  responsibleUserId: z.uuid({ error: "Choose a valid landlord." }).optional(),
  status: z
    .string()
    .transform((s) => s.split(",").map((x) => x.trim()).filter(Boolean))
    .pipe(z.array(z.enum(COMPLIANCE_STATUSES, { error: "Choose a valid status." })).min(1))
    .optional(),
});

export const updateComplianceItemSchema = z.object({
  applicable: z.boolean({ error: "Choose Yes or No." }).optional(),
  nextDueDate: z.preprocess((v) => (v === "" ? null : v), sensibleDate().nullable()).optional(),
  notes: optionalText(2000).optional(),
  version: VERSION,
});

/** Mark done (§9.3). `nextDueDate` omitted = leave the item's date as it is; null = clear it. */
export const createComplianceCompletionSchema = z.object({
  completedOn: sensibleDate("Enter the date it was completed.").refine((v) => v <= todayNy(), "The completion date can't be in the future."),
  notes: optionalText(2000).optional(),
  nextDueDate: z.preprocess((v) => (v === "" ? null : v), sensibleDate().nullable()).optional(),
  version: VERSION.optional(),
}).superRefine((v, ctx) => {
  if (v.nextDueDate && v.completedOn && v.nextDueDate < v.completedOn) ctx.addIssue({ code: "custom", path: ["nextDueDate"], message: "Next due date can't be before the completion date." });
});
