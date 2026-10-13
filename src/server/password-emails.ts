import type { EmailContent } from "../shared/email-layout";
import type { EnqueueEmail } from "../worker/email";
import { RateLimiter } from "./rate-limit";

export const RESET_SUBJECT = "Reset your RentNerd password";
export const PASSWORD_CHANGED_SUBJECT = "Your RentNerd password was changed";
export const RESET_TOKEN_TTL_SECONDS = 60 * 60;

const base = (appUrl: string) => appUrl.replace(/\/$/, "");

/** The §10.2 email. */
export function resetEmail(token: string, appUrl: string): EmailContent {
  return {
    heading: RESET_SUBJECT,
    paragraphs: ["This link expires in 1 hour. If you didn't ask for this, ignore this email; your password won't change."],
    action: { label: "Reset password", url: `${base(appUrl)}/reset-password?token=${encodeURIComponent(token)}` },
  };
}

/** The §10.4 email; `at` is shown in Eastern time. */
export function passwordChangedEmail(at: Date, appUrl: string): EmailContent {
  const when = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    dateStyle: "long",
    timeStyle: "short",
  }).format(at);
  return {
    heading: PASSWORD_CHANGED_SUBJECT,
    paragraphs: [`Your password was changed on ${when} ET. If this wasn't you, reset your password now.`],
    action: { label: "Reset your password", url: `${base(appUrl)}/forgot-password` },
  };
}

export interface PasswordMail {
  enqueue: (email: EnqueueEmail) => Promise<unknown>;
  appUrl: string;
  /** At most 3 reset emails per address per hour (§16). */
  perEmail?: RateLimiter;
}

interface MailUser {
  email: string;
  status?: unknown;
  emailVerified: boolean;
}

/** Sends the reset email only to active, verified users (invited and deactivated people get nothing) and within the hourly limit. */
export async function sendResetEmail(mail: PasswordMail, user: MailUser, token: string): Promise<boolean> {
  if (user.status !== "active" || !user.emailVerified) return false;
  const limiter = (mail.perEmail ??= new RateLimiter(3, 60 * 60_000));
  if (!limiter.take(user.email.toLowerCase())) return false;
  await mail.enqueue({ to: user.email, template: "password-reset", subject: RESET_SUBJECT, content: resetEmail(token, mail.appUrl) });
  return true;
}

export async function sendPasswordChangedEmail(mail: PasswordMail, user: MailUser): Promise<void> {
  await mail.enqueue({
    to: user.email,
    template: "password-changed",
    subject: PASSWORD_CHANGED_SUBJECT,
    content: passwordChangedEmail(new Date(), mail.appUrl),
  });
}
