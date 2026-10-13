/** Mailpit API client (http://localhost:8025, SPEC.md §15.5). */
import { MAILPIT_URL } from './env';

export type Address = { Name: string; Address: string };
export type MailSummary = { ID: string; Subject: string; To: Address[]; From: Address; Created: string };
export type Mail = MailSummary & { Text: string; HTML: string };
export type MailFilter = { to?: string; subject?: string | RegExp; body?: string | RegExp };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function clearMail() {
  await fetch(`${MAILPIT_URL}/api/v1/messages`, { method: 'DELETE' });
}

export async function listMail(): Promise<MailSummary[]> {
  const res = await fetch(`${MAILPIT_URL}/api/v1/messages?limit=1000`);
  const body = (await res.json()) as { messages: MailSummary[] };
  return body.messages ?? [];
}

export async function getMail(id: string): Promise<Mail> {
  const res = await fetch(`${MAILPIT_URL}/api/v1/message/${id}`);
  return (await res.json()) as Mail;
}

function matches(value: string, m: string | RegExp) {
  return typeof m === 'string' ? value === m : m.test(value);
}

/** Full messages matching the filter, oldest first. */
export async function findMail(f: MailFilter = {}): Promise<Mail[]> {
  const summaries = (await listMail()).filter(
    (m) =>
      (!f.to || m.To.some((t) => t.Address.toLowerCase() === f.to!.toLowerCase())) &&
      (!f.subject || matches(m.Subject, f.subject)),
  );
  // The single-message endpoint has no `Created` (Mailpit's receive time); keep it from the list summary.
  const full = await Promise.all(summaries.map(async (m) => ({ ...(await getMail(m.ID)), Created: m.Created })));
  return full
    .filter((m) => !f.body || matches(m.Text, f.body) || matches(m.HTML, f.body))
    .sort((a, b) => a.Created.localeCompare(b.Created));
}

/** Waits until at least `count` matching messages exist and returns them. */
export async function waitForMail(f: MailFilter, opts: { count?: number; timeout?: number } = {}): Promise<Mail[]> {
  const count = opts.count ?? 1;
  const deadline = Date.now() + (opts.timeout ?? 60_000);
  let found: Mail[] = [];
  while (Date.now() < deadline) {
    found = await findMail(f);
    if (found.length >= count) return found;
    await sleep(500);
  }
  throw new Error(`Expected ${count} email(s) matching ${describe(f)}, found ${found.length}. All: ${JSON.stringify((await listMail()).map((m) => [m.To.map((t) => t.Address), m.Subject]))}`);
}

/** Waits `ms` for background jobs, then returns how many messages match. */
export async function countMailAfter(f: MailFilter, ms = 8_000): Promise<number> {
  await sleep(ms);
  return (await findMail(f)).length;
}

function describe(f: MailFilter) {
  return JSON.stringify({ to: f.to, subject: String(f.subject ?? ''), body: String(f.body ?? '') });
}

/** Absolute links in the message (HTML hrefs and plain-text URLs). */
export function linksIn(m: Mail): string[] {
  const urls = new Set<string>();
  for (const src of [m.HTML ?? '', m.Text ?? '']) {
    for (const match of src.matchAll(/https?:\/\/[^\s"'<>)\]]+/g)) urls.add(match[0].replace(/&amp;/g, '&'));
  }
  return [...urls];
}

export function linkContaining(m: Mail, part: string): string {
  const link = linksIn(m).find((u) => u.includes(part));
  if (!link) throw new Error(`No link containing ${part} in email "${m.Subject}": ${linksIn(m).join(', ')}`);
  return link;
}

export function tokenFrom(url: string): string {
  const t = new URL(url).searchParams.get('token');
  if (!t) throw new Error(`No token in ${url}`);
  return t;
}

/** Plain text of the message, from the text part (falling back to stripped HTML). */
export function textOf(m: Mail): string {
  return m.Text || m.HTML.replace(/<[^>]+>/g, ' ');
}
