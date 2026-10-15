import { describe, expect, it } from "vitest";
import { complianceItemListQuerySchema, createComplianceCompletionSchema, createComplianceTypeSchema, normalizeSchedule, scheduleProblems, updateComplianceItemSchema } from "./compliance-schemas";

const base = { name: "Elevator inspection", appliesTo: "All properties", nycOnly: false } as const;
const fieldsOf = (input: unknown) => {
  const r = createComplianceTypeSchema.safeParse(input);
  return r.success ? {} : Object.fromEntries(r.error.issues.map((i) => [i.path.join("."), i.message]));
};

describe("createComplianceTypeSchema", () => {
  it("accepts each schedule type", () => {
    expect(createComplianceTypeSchema.safeParse({ ...base, scheduleType: "annual_date", dueMonth: 9, dueDay: 1 }).success).toBe(true);
    expect(createComplianceTypeSchema.safeParse({ ...base, scheduleType: "interval", intervalMonths: 12 }).success).toBe(true);
    expect(createComplianceTypeSchema.safeParse({ ...base, scheduleType: "one_time" }).success).toBe(true);
  });
  it("asks for a month and day for a yearly schedule (AC-CMP-09)", () => {
    expect(fieldsOf({ ...base, scheduleType: "annual_date" })).toEqual({ dueMonth: "Choose a month and day." });
    expect(fieldsOf({ ...base, scheduleType: "annual_date", dueMonth: 9, dueDay: "" })).toEqual({ dueDay: "Choose a month and day." });
    expect(fieldsOf({ ...base, scheduleType: "annual_date", dueDay: 15 })).toEqual({ dueMonth: "Choose a month and day." });
    expect(fieldsOf({ ...base, scheduleType: "annual_date", dueMonth: 2, dueDay: 30 })).toEqual({ dueDay: "That day doesn't exist in this month. Choose another day." });
    expect(fieldsOf({ ...base, scheduleType: "annual_date", dueMonth: 2, dueDay: 29 })).toEqual({ dueDay: "Feb 29 isn't allowed. Choose another day." });
  });
  it("refuses impossible dates and Feb 29", () => {
    expect(scheduleProblems({ scheduleType: "annual_date", dueMonth: 2, dueDay: 29, intervalMonths: null })).toHaveProperty("dueDay");
    expect(scheduleProblems({ scheduleType: "annual_date", dueMonth: 4, dueDay: 31, intervalMonths: null })).toHaveProperty("dueDay");
    expect(scheduleProblems({ scheduleType: "annual_date", dueMonth: 13, dueDay: 1, intervalMonths: null })).toHaveProperty("dueMonth");
  });
  it("needs 1 to 120 months for an interval", () => {
    for (const n of [0, 121, 1.5, undefined]) expect(fieldsOf({ ...base, scheduleType: "interval", intervalMonths: n })).toHaveProperty("intervalMonths");
    expect(fieldsOf({ ...base, scheduleType: "interval", intervalMonths: 120 })).toEqual({});
  });
  it("requires a name, a known audience and a schedule", () => {
    expect(fieldsOf({ ...base, name: "  ", scheduleType: "one_time" })).toHaveProperty("name");
    expect(fieldsOf({ ...base, appliesTo: "Nobody", scheduleType: "one_time" })).toHaveProperty("appliesTo");
    expect(fieldsOf({ ...base, scheduleType: "weekly" })).toHaveProperty("scheduleType");
  });
  it("drops the fields of the other schedules", () => {
    expect(normalizeSchedule({ scheduleType: "interval", dueMonth: 3, dueDay: 4, intervalMonths: 6 })).toMatchObject({ dueMonth: null, dueDay: null, intervalMonths: 6 });
    expect(normalizeSchedule({ scheduleType: "one_time", dueMonth: 3, dueDay: 4, intervalMonths: 6 })).toMatchObject({ dueMonth: null, dueDay: null, intervalMonths: null });
  });
});

describe("item schemas", () => {
  it("splits and checks the status filter", () => {
    expect(complianceItemListQuerySchema.parse({ status: "Overdue,Due soon" }).status).toEqual(["Overdue", "Due soon"]);
    expect(complianceItemListQuerySchema.safeParse({ status: "Late" }).success).toBe(false);
    expect(complianceItemListQuerySchema.safeParse({ propertyId: "nope" }).success).toBe(false);
  });
  it("needs the version to update an item and treats a blank date as none", () => {
    expect(updateComplianceItemSchema.safeParse({ applicable: false }).success).toBe(false);
    expect(updateComplianceItemSchema.parse({ nextDueDate: "", version: 1 }).nextDueDate).toBeNull();
    expect(updateComplianceItemSchema.safeParse({ nextDueDate: "2026-02-30", version: 1 }).success).toBe(false);
  });
  it("checks the completion date", () => {
    expect(createComplianceCompletionSchema.safeParse({ completedOn: "2026-10-12" }).success).toBe(true);
    expect(createComplianceCompletionSchema.safeParse({ completedOn: "12/10/2026" }).success).toBe(false);
    expect(createComplianceCompletionSchema.parse({ completedOn: "2026-10-12", nextDueDate: null }).nextDueDate).toBeNull();
  });
  it("refuses dates outside 2000–2100 and a next due date before the completion", () => {
    const f = (v: object) => { const r = createComplianceCompletionSchema.safeParse(v); return r.success ? {} : Object.fromEntries(r.error.issues.map((x) => [x.path.join("."), x.message])); };
    expect(f({ completedOn: "0001-01-01" })).toHaveProperty("completedOn");
    expect(f({ completedOn: "9999-12-31" })).toHaveProperty("completedOn");
    expect(f({ completedOn: "2099-01-01" })).toEqual({ completedOn: "The completion date can't be in the future." });
    expect(f({ completedOn: "2026-09-15", nextDueDate: "2026-09-01" })).toEqual({ nextDueDate: "Next due date can't be before the completion date." });
    expect(f({ completedOn: "2026-09-15", nextDueDate: "2026-09-15" })).toEqual({});
    expect(updateComplianceItemSchema.safeParse({ nextDueDate: "0001-01-01", version: 1 }).success).toBe(false);
  });
});

describe("numbers written as text", () => {
  it("accepts a month and day chosen from a select", () => {
    const r = createComplianceTypeSchema.safeParse({ name: "X", appliesTo: "All properties", nycOnly: false, scheduleType: "annual_date", dueMonth: "9", dueDay: 1 });
    expect(r.success).toBe(true);
  });
});
