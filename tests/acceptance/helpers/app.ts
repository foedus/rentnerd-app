/**
 * Test-only routes (SPEC.md D-25, §14.2) and app lifecycle.
 *
 * Contract used here (documented for the app in CLAUDE.md):
 *  - Test routes need no session; they exist only when test routes are enabled.
 *  - POST /api/test/clock {"now": "<ISO timestamp>"} sets the app clock; {"now": null} clears it.
 *  - POST /api/test/reset empties all app data (a fresh install). The tests then
 *    restart web and worker so the normal startup seeding (§15.1) runs.
 */
import type { Page } from '@playwright/test';
import { Api, asAdmin, forgetBrowserLogins, noteClock, renewBrowserSessions } from './api';
import { ADMIN, PASSWORD } from './env';
import { clearMail, linkContaining, tokenFrom, waitForMail } from './mailpit';
import { isHealthy, restartApp, startApp, type EnvOverrides } from './processes';

async function testRoute(path: string, data: unknown = {}) {
  const api = await Api.anon();
  const r = await api.post(path, data);
  await api.dispose();
  if (r.status < 200 || r.status >= 300) throw new Error(`POST ${path} -> ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
}

/** Noon in New York on the given date is 16:00 or 17:00 UTC; 16:00Z is the same NY date all year. */
export const nyNoon = (date: string) => `${date}T16:00:00.000Z`;

/** Sets the app clock (and the page's JavaScript clock, if given) to noon New York time on `date`. */
export async function setToday(date: string, ...pages: Page[]) {
  await setNow(nyNoon(date), ...pages);
}

/** Moves the app clock; browser sessions that may have expired by app time are renewed (see api.ts). */
export async function setNow(iso: string, ...pages: Page[]) {
  await testRoute('/api/test/clock', { now: iso });
  noteClock(iso);
  for (const p of pages) await p.clock.setFixedTime(new Date(iso));
  await renewBrowserSessions();
}

export async function clearClock() {
  await testRoute('/api/test/clock', { now: null });
  noteClock(null);
  await renewBrowserSessions();
}

export const runDailyDigest = () => testRoute('/api/test/jobs/daily-digest');
export const runBackup = () => testRoute('/api/test/jobs/backup');
export const runCleanup = () => testRoute('/api/test/jobs/cleanup');
export const failNextPdf = () => testRoute('/api/test/fail-next-pdf');
export const failNextEmail = () => testRoute('/api/test/fail-next-email');

/** Adds `days` to a YYYY-MM-DD date. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Fresh install: clears the test clock (so no earlier test's date leaks into
 * this one), clears Mailpit, resets the database, restarts web and worker
 * (startup seeding runs: admin invitation, smoke user, compliance catalog).
 * Unless `bootstrap` is false, the Admin then accepts the invitation.
 */
export async function freshApp(opts: { bootstrap?: boolean; env?: EnvOverrides } = {}) {
  if (!(await isHealthy())) await startApp();
  forgetBrowserLogins();
  await clearClock();
  await clearMail();
  await testRoute('/api/test/reset');
  await restartApp(opts.env ?? {});
  if (opts.bootstrap !== false) await bootstrapAdmin();
}

export async function bootstrapAdmin() {
  const [mail] = await waitForMail({ to: ADMIN.email, subject: "You're invited to RentNerd" });
  const token = tokenFrom(linkContaining(mail, '/accept-invite'));
  await acceptInvitation(token, ADMIN.name, ADMIN.password);
}

export async function acceptInvitation(token: string, name: string, password = PASSWORD) {
  const api = await Api.anon();
  const r = await api.post('/api/invitations/accept', { token, name, password });
  await api.dispose();
  if (r.status < 200 || r.status >= 300) throw new Error(`Accepting invitation failed: ${r.status} ${JSON.stringify(r.body)}`);
}

export type User = { id: string; name: string; email: string; password: string };

/** Admin invites a landlord through the API; the landlord accepts through the API. */
export async function createLandlord(name: string, email?: string, opts: { accept?: boolean } = {}): Promise<User> {
  const mailbox = (email ?? `${name.toLowerCase().replace(/[^a-z]+/g, '.')}.${Math.random().toString(36).slice(2, 7)}@example.com`).toLowerCase();
  const admin = await asAdmin();
  await admin.ok('POST', '/api/invitations', { name, email: mailbox });
  const users = await admin.list('/api/users');
  await admin.dispose();
  const user = users.find((u: any) => u.email === mailbox);
  if (opts.accept !== false) {
    const [mail] = await waitForMail({ to: mailbox, subject: "You're invited to RentNerd" });
    await acceptInvitation(tokenFrom(linkContaining(mail, '/accept-invite')), name);
  }
  return { id: user.id, name, email: mailbox, password: PASSWORD };
}

export async function userIdByEmail(email: string): Promise<string> {
  const admin = await asAdmin();
  const users = await admin.list('/api/users');
  await admin.dispose();
  const u = users.find((x: any) => x.email === email.toLowerCase());
  if (!u) throw new Error(`No user ${email}`);
  return u.id;
}
