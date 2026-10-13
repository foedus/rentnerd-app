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
