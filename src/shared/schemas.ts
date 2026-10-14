import { z } from "zod";
import { isValidYmd, todayNy } from "./dates";

export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;

export const BLANK_PASSWORD = "Password can't be only spaces.";
export const notBlank = (v: string) => v.trim().length > 0;

const name = z.string().trim().min(1, "Enter your name.").max(200, "Use 200 characters or fewer.");

export const acceptInvitationSchema = z.object({
  token: z.string().min(1).max(200),
  name,
  password: z
    .string()
    .min(PASSWORD_MIN, `Use at least ${PASSWORD_MIN} characters.`)
    .max(PASSWORD_MAX, `Use ${PASSWORD_MAX} characters or fewer.`)
    .refine(notBlank, BLANK_PASSWORD),
});

export const lookupInvitationSchema = z.object({ token: z.string().min(1).max(200) });

export const updateMeSchema = z.object({ name });

export const inviteLandlordSchema = z.object({
  name: z.string().trim().min(1, "Enter a name.").max(200, "Use 200 characters or fewer."),
  email: z.string().trim().toLowerCase().max(254, "Use 254 characters or fewer.").pipe(z.email("Enter a valid email address.")),
});

export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

/** Reset-password form (§11.3, AC-AUTH-08): the same rules as Account settings. */
export const newPasswordSchema = z
  .object({
    newPassword: z
      .string()
      .min(PASSWORD_MIN, `Password must be at least ${PASSWORD_MIN} characters.`)
      .max(PASSWORD_MAX, `Password must be ${PASSWORD_MAX} characters or fewer.`)
      .refine(notBlank, BLANK_PASSWORD),
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, { path: ["confirmPassword"], message: "Passwords don't match." });

/** Change-password form in Account settings (§11.25): the reset rules plus the current password. */
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password."),
    newPassword: newPasswordSchema.shape.newPassword,
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, { path: ["confirmPassword"], message: "Passwords don't match." })
  .refine((v) => v.newPassword !== v.currentPassword, {
    path: ["newPassword"],
    message: "New password must be different from your current password.",
  });

/** Accept-invitation form (§11.4): a name plus the same password rules as the reset form. */
export const acceptInviteFormSchema = z
  .object({
    name,
    password: z
      .string()
      .min(PASSWORD_MIN, `Password must be at least ${PASSWORD_MIN} characters.`)
      .max(PASSWORD_MAX, `Password must be ${PASSWORD_MAX} characters or fewer.`)
      .refine(notBlank, BLANK_PASSWORD),
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, { path: ["confirmPassword"], message: "Passwords don't match." });

export const OWNER_TYPES = ["LLC", "Corporation", "Partnership", "Trust", "Individual", "Other"] as const;

const required = (message: string, max = 200) => z.string({ error: message }).trim().min(1, message).max(max, `Use ${max} characters or fewer.`);
const optionalText = (max = 200) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), z.string().trim().max(max, `Use ${max} characters or fewer.`).nullable());

/** §6.3 owner fields. Optional text may be omitted, null or blank (stored as null). */
export const ownerFieldsSchema = z.object({
  name: required("Enter the owner name."),
  ownerType: z.enum(OWNER_TYPES, "Select an owner type."),
  addressLine1: required("Enter the mailing address."),
  addressLine2: optionalText(),
  city: required("Enter the city."),
  state: z.string({ error: "Enter a 2-letter state code." }).trim().toUpperCase().regex(/^[A-Z]{2}$/, "Enter a 2-letter state code."),
  zip: z.string({ error: "Enter a 5 or 9 digit ZIP code." }).trim().regex(/^(\d{5}|\d{9})$/, "Enter a 5 or 9 digit ZIP code."),
  email: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.string().trim().toLowerCase().max(254, "Use 254 characters or fewer.").pipe(z.email("Enter a valid email address.")).nullable(),
  ),
  phone: optionalText(50),
  signatoryName: optionalText(),
  signatoryTitle: optionalText(),
  notes: optionalText(5000),
});

export const createOwnerSchema = ownerFieldsSchema.partial({
  addressLine2: true, email: true, phone: true, signatoryName: true, signatoryTitle: true, notes: true,
});

/** PATCH: any subset of fields plus the `version` being edited (D-10). */
export const updateOwnerSchema = ownerFieldsSchema.partial().extend({ version: z.number().int().min(1, "version is required") });

/** Actions (archive, restore) may carry the version being acted on. */
export const versionSchema = z.object({ version: z.number().int().min(1, "version must be a positive whole number").optional() });

export const ownerListQuerySchema = listQuerySchema.extend({
  sort: z.enum(["name", "ownerType", "city", "createdAt"]).default("name"),
  order: z.enum(["asc", "desc"]).default("asc"),
  q: z.string().trim().max(200).optional(),
  archived: z.enum(["true", "false"]).default("false"),
});

const optionalNullable = <T extends z.ZodType>(schema: T) => z.preprocess((v) => (v === "" ? null : v), schema.nullable());

/** §6.4 property fields. `yearBuilt` may not be later than the current year (New York calendar). */
export const propertyFieldsSchema = z.object({
  name: required("Enter the property name."),
  street: required("Enter the street address."),
  city: required("Enter the city."),
  state: z.string({ error: "Enter a 2-letter state code." }).trim().toUpperCase().regex(/^[A-Z]{2}$/, "Enter a 2-letter state code."),
  zip: z.string({ error: "Enter a 5 or 9 digit ZIP code." }).trim().regex(/^(\d{5}|\d{9})$/, "Enter a 5 or 9 digit ZIP code."),
  inNyc: z.boolean({ error: "Choose yes or no." }),
  bbl: optionalNullable(z.string().trim().regex(/^\d{10}$/, "Enter the 10 digits of the Borough-Block-Lot number.")),
  yearBuilt: optionalNullable(
    z.number({ error: "Enter a year." }).int("Enter a year.").min(1700, "Enter a year from 1700 on.").refine((y) => y <= Number(todayNy().slice(0, 4)), "The year can't be in the future."),
  ),
  ownerId: z.string({ error: "Choose an owner." }).uuid("Choose an owner."),
  responsibleUserIds: z
    .array(z.string().uuid("Choose at least one responsible landlord."), { error: "Choose at least one responsible landlord." })
    .min(1, "Choose at least one responsible landlord.")
    .max(100)
    .refine((ids) => new Set(ids).size === ids.length, "Each landlord can only be chosen once."),
  purchasePriceCents: optionalNullable(z.number({ error: "Enter an amount." }).int("Enter an amount in whole cents.").min(0, "The amount can't be negative.").max(Number.MAX_SAFE_INTEGER)),
  purchaseDate: optionalNullable(z.string().refine(isValidYmd, "Enter a valid date.")),
  notes: optionalText(5000),
});

/** `inNyc` defaults to true; responsible landlords default to the creator (filled in by the route). */
export const createPropertySchema = propertyFieldsSchema
  .extend({ inNyc: propertyFieldsSchema.shape.inNyc.default(true), responsibleUserIds: propertyFieldsSchema.shape.responsibleUserIds.optional() })
  .partial({ bbl: true, yearBuilt: true, purchasePriceCents: true, purchaseDate: true, notes: true });

export const UNIT_USES = ["Residential", "Commercial"] as const;

/** `singleUnitUse` (Add only, §11.8): also creates the unit "Entire property" with that use. */
export const createPropertyWithUnitSchema = createPropertySchema.extend({ singleUnitUse: z.enum(UNIT_USES, "Choose Residential or Commercial.").optional() });

export const updatePropertySchema = propertyFieldsSchema.partial().extend({ version: z.number().int().min(1, "version is required") });

export const propertyListQuerySchema = listQuerySchema.extend({
  sort: z.enum(["name", "city", "createdAt"]).default("name"),
  order: z.enum(["asc", "desc"]).default("asc"),
  q: z.string().trim().max(200).optional(),
  archived: z.enum(["true", "false"]).default("false"),
});

export type PropertyType = "Residential" | "Commercial" | "Mixed";
/** Derived property type from the uses of its non-archived units; "—" when it has none (§6.4). */
export function propertyType(uses: readonly ("Residential" | "Commercial")[]): PropertyType | "—" {
  const residential = uses.includes("Residential");
  const commercial = uses.includes("Commercial");
  if (residential && commercial) return "Mixed";
  return residential ? "Residential" : commercial ? "Commercial" : "—";
}

/** §6.7 unit fields. `use` is fixed at creation: PATCH refuses a different value (422). */
export const unitFieldsSchema = z.object({
  label: required("Enter the unit label."),
  use: z.enum(UNIT_USES, "Choose Residential or Commercial."),
  bedrooms: optionalNullable(z.number({ error: "Enter a whole number." }).int("Enter a whole number.").min(0, "Enter a number from 0 to 20.").max(20, "Enter a number from 0 to 20.")),
  bathrooms: optionalNullable(
    z.number({ error: "Enter a number." }).min(0, "Enter a number from 0 to 99.9.").max(99.9, "Enter a number from 0 to 99.9.").refine((n) => Math.abs(n * 10 - Math.round(n * 10)) < 1e-9, "Use at most one decimal place."),
  ),
  squareFeet: optionalNullable(z.number({ error: "Enter a whole number." }).int("Enter a whole number.").min(1, "Enter a number above 0.").max(10_000_000, "Enter a smaller number.")),
  ownerOverrideId: optionalNullable(z.string().uuid("Choose an owner.")),
  notes: optionalText(5000),
});

export const createUnitSchema = unitFieldsSchema.partial({ bedrooms: true, bathrooms: true, squareFeet: true, ownerOverrideId: true, notes: true });
export const updateUnitSchema = unitFieldsSchema.partial().extend({ version: z.number().int().min(1, "version is required") });

export const unitListQuerySchema = listQuerySchema.extend({
  sort: z.enum(["label", "use", "createdAt"]).default("label"),
  order: z.enum(["asc", "desc"]).default("asc"),
  archived: z.enum(["true", "false"]).default("false"),
});

export const VALUE_KINDS = ["market_estimate", "assessed"] as const;
export type ValueKind = (typeof VALUE_KINDS)[number];
export const VALUE_KIND_LABELS: Record<ValueKind, string> = { market_estimate: "Market estimate", assessed: "Assessed value" };

/** §6.5 property value fields; `kind` takes the code (API) and the form maps the label to it. */
export const propertyValueFieldsSchema = z.object({
  valueDate: z.string({ error: "Enter a valid date." }).refine(isValidYmd, "Enter a valid date."),
  kind: z.enum(VALUE_KINDS, "Choose a value type."),
  amountCents: z.number({ error: "Enter an amount." }).int("Enter an amount in whole cents.").min(1, "Enter an amount above 0.").max(1_000_000_000_000, "Enter a smaller amount."),
  source: optionalText(),
});
export const createPropertyValueSchema = propertyValueFieldsSchema.partial({ source: true });
export const updatePropertyValueSchema = propertyValueFieldsSchema.partial().extend({ version: z.number().int().min(1, "version is required") });

/** §6.6 property tax fields: one annual amount per tax year. */
export const propertyTaxFieldsSchema = z.object({
  taxYear: z.number({ error: "Enter a tax year from 1990 to 2100." }).int("Enter a tax year from 1990 to 2100.").min(1990, "Enter a tax year from 1990 to 2100.").max(2100, "Enter a tax year from 1990 to 2100."),
  amountCents: z.number({ error: "Enter an amount." }).int("Enter an amount in whole cents.").min(0, "The amount can't be negative.").max(1_000_000_000_000, "Enter a smaller amount."),
});
export const createPropertyTaxSchema = propertyTaxFieldsSchema;
export const updatePropertyTaxSchema = propertyTaxFieldsSchema.partial().extend({ version: z.number().int().min(1, "version is required") });

export const TENANT_TYPES = ["Individual", "Business"] as const;
export type TenantType = (typeof TENANT_TYPES)[number];

const tenantNameFields = {
  firstName: optionalText(),
  lastName: optionalText(),
  businessName: optionalText(),
  contactPerson: optionalText(),
};
const tenantOtherFields = {
  email: ownerFieldsSchema.shape.email,
  phone: optionalText(50),
  notes: optionalText(5000),
};

/** §6.8: Individuals need first and last name; Businesses need a business name and contact person. */
export function tenantRuleIssues(t: {
  tenantType: TenantType;
  firstName?: string | null;
  lastName?: string | null;
  businessName?: string | null;
  contactPerson?: string | null;
}): Record<string, string> {
  const missing = (v?: string | null) => !v || v.trim() === "";
  const out: Record<string, string> = {};
  if (t.tenantType === "Individual") {
    if (missing(t.firstName)) out.firstName = "Enter a first name.";
    if (missing(t.lastName)) out.lastName = "Enter a last name.";
  } else {
    if (missing(t.businessName)) out.businessName = "Enter a business name.";
    if (missing(t.contactPerson)) out.contactPerson = "Enter a contact person.";
  }
  return out;
}

/** Name fields that don't apply to the tenant's type are stored as null. */
export function normalizeTenantNames<T extends { tenantType: TenantType }>(t: T): T {
  return t.tenantType === "Individual"
    ? { ...t, businessName: null, contactPerson: null }
    : { ...t, firstName: null, lastName: null };
}

export const createTenantSchema = z
  .object({ tenantType: z.enum(TENANT_TYPES, "Choose Individual or Business."), ...tenantNameFields, ...tenantOtherFields })
  .partial({ firstName: true, lastName: true, businessName: true, contactPerson: true, email: true, phone: true, notes: true })
  .superRefine((t, ctx) => {
    for (const [path, message] of Object.entries(tenantRuleIssues(t))) ctx.addIssue({ code: "custom", path: [path], message });
  });

/** PATCH: any subset plus `version`; the merged record is re-checked against the type rules by the route. */
export const updateTenantSchema = z
  .object({ tenantType: z.enum(TENANT_TYPES, "Choose Individual or Business."), ...tenantNameFields, ...tenantOtherFields })
  .partial()
  .extend({ version: z.number().int().min(1, "version is required") });

export const tenantListQuerySchema = listQuerySchema.extend({
  sort: z.enum(["name", "email", "createdAt"]).default("name"),
  order: z.enum(["asc", "desc"]).default("asc"),
  q: z.string().trim().max(200).optional(),
  archived: z.enum(["true", "false"]).default("false"),
});

export const INCREASE_TYPES = ["none", "percent", "schedule"] as const;
export type IncreaseType = (typeof INCREASE_TYPES)[number];
export const END_REASONS = ["Tenant moved out", "Not renewed", "Terminated", "Tenant broke lease", "Replaced by new lease", "Other"] as const;
export type EndReason = (typeof END_REASONS)[number];

const ymd = z.string({ error: "Enter a valid date." }).refine(isValidYmd, "Enter a valid date.");
const MAX_CENTS = 1_000_000_000_000;
const money = (message = "Enter an amount.") =>
  z.number({ error: message }).int("Enter an amount in whole cents.").min(1, "Enter an amount above 0.").max(MAX_CENTS, "Enter a smaller amount.");
const optionalMoney = optionalNullable(
  z.number({ error: "Enter an amount." }).int("Enter an amount in whole cents.").min(0, "The amount can't be negative.").max(MAX_CENTS, "Enter a smaller amount."),
);
const percent = (max: number, message: string) =>
  z
    .number({ error: message })
    .gt(0, message)
    .max(max, message)
    .refine((n) => Math.abs(n * 10_000 - Math.round(n * 10_000)) < 1e-6, "Use at most 4 decimal places.");

export const rentStepSchema = z.object({ effectiveDate: ymd, amountCents: money() });
export const tenantRefSchema = z.object({ tenantId: z.string({ error: "Choose a tenant." }).uuid("Choose a tenant."), isPrimary: z.boolean({ error: "Choose the primary tenant." }) });

/** Terms an extension may change as well as the master lease (§6.9, §6.10); pre-filled from the previous term. */
const termFields = {
  securityDepositCents: optionalMoney.optional(),
  rentDueDay: z.number({ error: "Enter a whole number from 1 to 28." }).int("Enter a whole number from 1 to 28.").min(1, "Enter a whole number from 1 to 28.").max(28, "Enter a whole number from 1 to 28.").default(1),
  lateFeeCents: optionalMoney.optional(),
  lateFeeGraceDays: optionalNullable(z.number({ error: "Enter a whole number from 0 to 31." }).int("Enter a whole number from 0 to 31.").min(0, "Enter a whole number from 0 to 31.").max(31, "Enter a whole number from 0 to 31.")).optional(),
  pets: optionalText().optional(),
  parking: optionalText().optional(),
  parkingChargeCents: optionalMoney.optional(),
  childrenReside: optionalNullable(z.boolean({ error: "Choose Yes or No." })).optional(),
  breakClause: optionalText(5000).optional(),
  otherTerms: optionalText(5000).optional(),
  baseTaxYear: optionalNullable(z.number({ error: "Enter a tax year from 1990 to 2100." }).int("Enter a tax year from 1990 to 2100.").min(1990, "Enter a tax year from 1990 to 2100.").max(2100, "Enter a tax year from 1990 to 2100.")).optional(),
  taxSharePercent: optionalNullable(percent(100, "Enter a percentage above 0 and up to 100.")).optional(),
};
const rentFields = {
  startDate: ymd,
  endDate: ymd,
  baseRentCents: money("Enter the monthly rent."),
  increaseType: z.enum(INCREASE_TYPES, "Choose how rent increases.").default("none"),
  increasePercent: optionalNullable(percent(50, "Enter a percentage above 0 and up to 50.")).optional(),
  rentSteps: z.array(rentStepSchema).max(100, "Use 100 rent steps or fewer.").default([]),
};

export const leaseFieldsSchema = z.object({
  unitId: z.string({ error: "Choose a unit." }).uuid("Choose a unit."),
  tenants: z.array(tenantRefSchema, { error: "Add at least one tenant." }).max(20, "Use 20 tenants or fewer."),
  ...rentFields,
  ...termFields,
  monthToMonth: z.boolean().default(false),
  monthToMonthRentCents: optionalNullable(money()).optional(),
  moveOutDate: optionalNullable(ymd).optional(),
  endReason: optionalNullable(z.enum(END_REASONS, "Choose a reason.")).optional(),
});

export const extensionFieldsSchema = z.object({
  tenants: z.array(tenantRefSchema, { error: "Add at least one tenant." }).max(20, "Use 20 tenants or fewer."),
  ...rentFields,
  ...termFields,
  notes: optionalText(5000).optional(),
});

export interface LeaseTermInput {
  startDate: string;
  endDate: string;
  increaseType: IncreaseType;
  increasePercent?: number | null;
  rentSteps: readonly { effectiveDate: string; amountCents: number }[];
  tenants: readonly { tenantId: string; isPrimary: boolean }[];
  baseTaxYear?: number | null;
  taxSharePercent?: number | null;
  childrenReside?: boolean | null;
}

/** Field-level cross rules shared by leases and extensions (§6.9, §6.10); `use` is the unit's use. */
export function termRuleIssues(t: LeaseTermInput, use: "Residential" | "Commercial"): Record<string, string> {
  const out: Record<string, string> = {};
  if (t.endDate <= t.startDate) out.endDate = "The end date must be after the start date.";
  if (t.increaseType === "percent" && t.increasePercent == null) out.increasePercent = "Enter the annual increase.";
  if (t.increaseType === "schedule") {
    const dates = t.rentSteps.map((s) => s.effectiveDate);
    if (dates.length === 0) out.rentSteps = "Add at least one rent step.";
    else if (dates.some((d) => d <= t.startDate || d >= t.endDate)) out.rentSteps = "Rent step dates must fall within the term, after its start.";
    else if (dates.some((d, i) => i > 0 && d <= dates[i - 1]!)) out.rentSteps = "Rent step dates must be in increasing order.";
  }
  if (t.tenants.length === 0) out.tenants = "Add at least one tenant.";
  else if (t.tenants.filter((x) => x.isPrimary).length !== 1) out.tenants = "Choose exactly one primary tenant.";
  else if (new Set(t.tenants.map((x) => x.tenantId)).size !== t.tenants.length) out.tenants = "Each tenant can be added once.";
  if (use === "Residential") {
    if (t.childrenReside == null) out.childrenReside = "Choose Yes or No.";
    if (t.baseTaxYear != null || t.taxSharePercent != null) out.baseTaxYear = "Tax terms apply to commercial units only.";
  } else {
    if (t.childrenReside != null) out.childrenReside = "This applies to residential units only.";
    if (t.baseTaxYear != null && t.taxSharePercent == null) out.taxSharePercent = "Enter the tenant's share of the tax increase.";
    if (t.baseTaxYear == null && t.taxSharePercent != null) out.baseTaxYear = "Choose a base tax year.";
  }
  return out;
}

/** Lease-only rules: a move-out date needs a reason (the database enforces the pair). */
export function leaseRuleIssues(l: LeaseTermInput & { moveOutDate?: string | null; endReason?: string | null }, use: "Residential" | "Commercial"): Record<string, string> {
  const out = termRuleIssues(l, use);
  if (l.moveOutDate && !l.endReason) out.endReason = "Choose a reason.";
  if (!l.moveOutDate && l.endReason) out.moveOutDate = "Enter the move-out date.";
  return out;
}
