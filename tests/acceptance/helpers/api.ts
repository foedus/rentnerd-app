/**
 * HTTP API client (SPEC.md §14). Sends the app's Origin on every request, as
 * the browser would (§14.1 rejects state-changing requests without it).
 */
import { request, type APIRequestContext, type BrowserContext } from '@playwright/test';
import { ADMIN, APP_URL, PASSWORD, SMOKE } from './env';

/*
 * Sessions expire after 7 days of *app* time (D-08, D-25), so moving the test
 * clock forward ends sessions that were opened before the move. The helpers
 * therefore track the app clock and sign in again (as a user would) whenever a
 * session may have expired: API clients lazily before their next request,
 * browser contexts signed in with ui.signIn() as soon as the clock moves.
 */
const clock = { iso: null as number | null, setAt: 0 };
/** Current app time in ms, as last set through the test clock helpers. */
export function appNow(): number {
  return clock.iso === null ? Date.now() : clock.iso + (Date.now() - clock.setAt);
}
export function noteClock(iso: string | null) {
  clock.iso = iso === null ? null : Date.parse(iso);
  clock.setAt = Date.now();
}
/** Re-sign-in when the app clock has moved more than this past the sign-in (sessions last 7 days). */
const RENEW_AFTER_MS = 6 * 24 * 3600 * 1000;
const stale = (at: number) => appNow() > at + RENEW_AFTER_MS;

type Login = { email: string; password: string; at: number };
const browserLogins = new Map<BrowserContext, Login>();

export function rememberBrowserLogin(ctx: BrowserContext, email: string, password: string) {
  browserLogins.set(ctx, { email, password, at: appNow() });
}

/** Forgets every remembered browser sign-in (after a reset the accounts are gone). */
export function forgetBrowserLogins() {
  browserLogins.clear();
}

/** Signs remembered browser contexts in again if the clock move may have expired their session. */
export async function renewBrowserSessions() {
  for (const [ctx, login] of [...browserLogins]) {
    if (!stale(login.at)) continue;
    try {
      const r = await ctx.request.post(`${APP_URL}/api/auth/sign-in/email`, {
        data: { email: login.email, password: login.password },
        headers: { Origin: APP_URL },
      });
      if (r.status() === 200) login.at = appNow();
      else {
        // Diagnostics only: the context is left signed out, as before, but say why.
        console.warn(`[renewBrowserSessions] sign-in again for ${login.email} refused: ${r.status()} ${await r.text().catch(() => '')}`);
        browserLogins.delete(ctx);
      }
    } catch {
      browserLogins.delete(ctx); // context already closed
    }
  }
}

export type Res = { status: number; body: any; headers: Record<string, string> };

export class Api {
  private login?: Login;

  constructor(public ctx: APIRequestContext) {}

  static async anon(): Promise<Api> {
    return new Api(await request.newContext({ baseURL: APP_URL, extraHTTPHeaders: { Origin: APP_URL } }));
  }

  static async signedIn(email: string, password: string): Promise<Api> {
    const api = await Api.anon();
    const r = await api.call('POST', '/api/auth/sign-in/email', { email, password });
    if (r.status !== 200) throw new Error(`Sign-in failed for ${email}: ${r.status} ${JSON.stringify(r.body)}`);
    api.login = { email, password, at: appNow() };
    return api;
  }

  async call(method: string, path: string, data?: unknown): Promise<Res> {
    if (this.login && stale(this.login.at) && !path.startsWith('/api/auth/')) {
      const { email, password } = this.login;
      const r = await this.ctx.fetch('/api/auth/sign-in/email', { method: 'POST', data: { email, password } });
      this.login = r.status() === 200 ? { email, password, at: appNow() } : undefined;
    }
    const res = await this.ctx.fetch(path, { method, data: data === undefined ? undefined : (data as any) });
    const text = await res.text();
    let body: any = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      /* not JSON */
    }
    return { status: res.status(), body, headers: res.headers() };
  }

  get(path: string) {
    return this.call('GET', path);
  }
  post(path: string, data: unknown = {}) {
    return this.call('POST', path, data);
  }
  patch(path: string, data: unknown) {
    return this.call('PATCH', path, data);
  }
  del(path: string) {
    return this.call('DELETE', path);
  }

  /** Like call(), but throws unless the response is 2xx, and returns the record. */
  async ok(method: string, path: string, data?: unknown): Promise<any> {
    const r = await this.call(method, path, data);
    if (r.status < 200 || r.status >= 300) {
      throw new Error(`${method} ${path} -> ${r.status}: ${JSON.stringify(r.body)}\nrequest: ${JSON.stringify(data)}`);
    }
    return unwrap(r.body);
  }

  /** GET a paginated list (§14.1) and return its data array, up to 200 rows. */
  async list(path: string): Promise<any[]> {
    const sep = path.includes('?') ? '&' : '?';
    const body = await this.ok('GET', `${path}${sep}pageSize=200`);
    return Array.isArray(body) ? body : body.data;
  }

  async me(): Promise<{ id: string; name: string; email: string }> {
    return await this.ok('GET', '/api/me');
  }

  async cookieHeader(): Promise<string> {
    const state = await this.ctx.storageState();
    return state.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  }

  async dispose() {
    await this.ctx.dispose();
  }
}

/** Single-record responses are the record itself; tolerate a `{data: record}` wrapper too. */
export function unwrap(body: any) {
  if (body && typeof body === 'object' && !Array.isArray(body) && !('id' in body) && body.data && !Array.isArray(body.data)) {
    return body.data;
  }
  return body;
}

export const asAdmin = () => Api.signedIn(ADMIN.email, ADMIN.password);
export const asSmoke = () => Api.signedIn(SMOKE.email, SMOKE.password);
export const asUser = (email: string, password = PASSWORD) => Api.signedIn(email, password);

/** Raw sign-in attempt; returns the HTTP status. */
export async function trySignIn(email: string, password: string): Promise<number> {
  const api = await Api.anon();
  const r = await api.post('/api/auth/sign-in/email', { email, password });
  await api.dispose();
  return r.status;
}
