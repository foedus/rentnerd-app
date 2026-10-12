/**
 * HTTP API client (SPEC.md §14). Sends the app's Origin on every request, as
 * the browser would (§14.1 rejects state-changing requests without it).
 */
import { request, type APIRequestContext } from '@playwright/test';
import { ADMIN, APP_URL, PASSWORD, SMOKE } from './env';

export type Res = { status: number; body: any; headers: Record<string, string> };

export class Api {
  constructor(public ctx: APIRequestContext) {}

  static async anon(): Promise<Api> {
    return new Api(await request.newContext({ baseURL: APP_URL, extraHTTPHeaders: { Origin: APP_URL } }));
  }

  static async signedIn(email: string, password: string): Promise<Api> {
    const api = await Api.anon();
    const r = await api.call('POST', '/api/auth/sign-in/email', { email, password });
    if (r.status !== 200) throw new Error(`Sign-in failed for ${email}: ${r.status} ${JSON.stringify(r.body)}`);
    return api;
  }

  async call(method: string, path: string, data?: unknown): Promise<Res> {
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
