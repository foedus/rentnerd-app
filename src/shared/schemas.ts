import { z } from "zod";

export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;

const name = z.string().trim().min(1, "Enter your name.").max(200, "Use 200 characters or fewer.");

export const acceptInvitationSchema = z.object({
  token: z.string().min(1).max(200),
  name,
  password: z
    .string()
    .min(PASSWORD_MIN, `Use at least ${PASSWORD_MIN} characters.`)
    .max(PASSWORD_MAX, `Use ${PASSWORD_MAX} characters or fewer.`),
});

export const lookupInvitationSchema = z.object({ token: z.string().min(1).max(200) });

export const updateMeSchema = z.object({ name });

export const inviteLandlordSchema = z.object({
  name,
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
      .max(PASSWORD_MAX, `Password must be ${PASSWORD_MAX} characters or fewer.`),
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, { path: ["confirmPassword"], message: "Passwords don't match." });

/** Accept-invitation form (§11.4): a name plus the same password rules as the reset form. */
export const acceptInviteFormSchema = z
  .object({
    name,
    password: z
      .string()
      .min(PASSWORD_MIN, `Password must be at least ${PASSWORD_MIN} characters.`)
      .max(PASSWORD_MAX, `Password must be ${PASSWORD_MAX} characters or fewer.`),
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, { path: ["confirmPassword"], message: "Passwords don't match." });
