import { z } from "zod";

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
