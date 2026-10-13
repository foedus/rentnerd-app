import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb } from "../db/client";
import { createApp } from "./app";
import { createAuth } from "./auth";

const url = "postgres://rentnerd:rentnerd@localhost:5432/rentnerd_test";
const { pool, db } = createDb(url);
const env = { AUTH_SECRET: "integration-test-secret-0123456789abcdef0123456789", APP_URL: "http://localhost:8080" };
const auth = createAuth(db, env);
const PASSWORD = "Correct-horse-1234";
const app = createApp(pool, "dist/client", auth, { testRoutesEnabled: false }, env.APP_URL, db, async () => undefined);

beforeAll(() => {
  execFileSync("npm", ["run", "build"], { stdio: "pipe" });
  execFileSync("node", ["dist/migrate.js"], { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
});
beforeEach(async () => {
  await pool.query('truncate "user", owner, property, unit, audit_log cascade');
});
afterAll(() => pool.end());

async function makeUser(email: string, role: "admin" | "landlord" | "smoke", status: "active" | "deactivated" | "invited" = "active") {
  const ctx = await auth.$context;
  const [u] = (await pool.query(`insert into "user" (name, email, role, status, email_verified) values ($2,$1,$3,$4,true) returning id`, [email, `Name of ${email}`, role, status])).rows;
  await pool.query(`insert into account (user_id, provider_id, account_id, password) values ($1::uuid,'credential',$1::text,$2)`, [u.id, await ctx.password.hash(PASSWORD)]);
  const res = await app.request("/api/auth/sign-in/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: env.APP_URL },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  return { id: u.id as string, cookie: res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ") };
}
const call = (cookie: string, method: string, path: string, body?: unknown) =>
  app.request(path, { method, headers: { cookie, origin: env.APP_URL, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

async function newOwner(cookie: string) {
  const res = await call(cookie, "POST", "/api/owners", { name: "Acme LLC", ownerType: "LLC", addressLine1: "1 A St", city: "Brooklyn", state: "NY", zip: "11201" });
  return (await res.json()) as { id: string };
}
const base = (ownerId: string, extra: Record<string, unknown> = {}) => ({ name: "412 Court St", street: "412 Court St", city: "Brooklyn", state: "ny", zip: "11231", ownerId, ...extra });
type Prop = { id: string; version: number; name: string; inNyc: boolean; state: string; propertyType: string; responsibleUserIds: string[]; responsible: { id: string; email: string }[]; owner: { name: string } };
async function create(cookie: string, ownerId: string, extra: Record<string, unknown> = {}) {
  const res = await call(cookie, "POST", "/api/properties", base(ownerId, extra));
  expect(res.status).toBe(201);
  return (await res.json()) as Prop;
}

describe("properties API", () => {
  it("needs a session; the Smoke user can read but not write", async () => {
    expect((await app.request("/api/properties")).status).toBe(401);
    expect((await app.request("/api/people")).status).toBe(401);
    const admin = await makeUser("admin@example.com", "admin");
    const o = await newOwner(admin.cookie);
    const smoke = await makeUser("smoke@example.com", "smoke");
    expect((await call(smoke.cookie, "GET", "/api/properties")).status).toBe(200);
    expect((await call(smoke.cookie, "POST", "/api/properties", base(o.id))).status).toBe(403);
  });

  it("creates a property defaulting to inNyc and to the creator as responsible, and audits it", async () => {
    const lou = await makeUser("lou@example.com", "landlord");
    const o = await newOwner(lou.cookie);
    const p = await create(lou.cookie, o.id, { purchasePriceCents: 70000000, bbl: "" });
    expect(p).toMatchObject({ state: "NY", inNyc: true, version: 1, propertyType: "—", responsibleUserIds: [lou.id], owner: { name: "Acme LLC" }, purchasePriceCents: 70000000, bbl: null });
    const { rows } = await pool.query("select action, entity_type, entity_id from audit_log where entity_type = 'property'");
    expect(rows).toEqual([{ action: "create", entity_type: "property", entity_id: p.id }]);
  });

  it("returns 422 per-field messages, including a missing name (AC-API-02)", async () => {
    const admin = await makeUser("admin@example.com", "admin");
    const o = await newOwner(admin.cookie);
    const noName: Record<string, unknown> = base(o.id, { inNyc: true, responsibleUserIds: [admin.id] });
    delete noName.name;
    const res = await call(admin.cookie, "POST", "/api/properties", noName);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.fields.name).toBeTruthy();
    const bad = await call(admin.cookie, "POST", "/api/properties", base(o.id, { bbl: "123", yearBuilt: 1500, purchasePriceCents: -1, responsibleUserIds: [], purchaseDate: "2020-02-31" }));
    expect(Object.keys((await bad.json()).error.fields).sort()).toEqual(["bbl", "purchaseDate", "purchasePriceCents", "responsibleUserIds", "yearBuilt"]);
    const future = await call(admin.cookie, "POST", "/api/properties", base(o.id, { yearBuilt: 2999 }));
    expect(future.status).toBe(422);
  });

  it("rejects a missing, unknown or archived owner", async () => {
    const admin = await makeUser("admin@example.com", "admin");
    const o = await newOwner(admin.cookie);
    for (const ownerId of [crypto.randomUUID(), "nope"]) {
      const res = await call(admin.cookie, "POST", "/api/properties", base(ownerId));
      expect(res.status).toBe(422);
      expect((await res.json()).error.fields.ownerId).toBeTruthy();
    }
    await call(admin.cookie, "POST", `/api/owners/${o.id}/archive`, {});
    expect((await call(admin.cookie, "POST", "/api/properties", base(o.id))).status).toBe(422);
  });

  it("names must be unique among non-archived properties, ignoring case", async () => {
    const admin = await makeUser("admin@example.com", "admin");
    const o = await newOwner(admin.cookie);
    const first = await create(admin.cookie, o.id);
    const dup = await call(admin.cookie, "POST", "/api/properties", base(o.id, { name: "412 COURT st" }));
    expect(dup.status).toBe(409);
    expect((await dup.json()).error.fields.name).toBe("A property with this name already exists.");
    const other = await create(admin.cookie, o.id, { name: "Other" });
    const rename = await call(admin.cookie, "PATCH", `/api/properties/${other.id}`, { name: "412 Court St", version: 1 });
    expect(rename.status).toBe(409);
    expect((await call(admin.cookie, "PATCH", `/api/properties/${first.id}`, { name: "412 court st", version: 1 })).status).toBe(200);
    // Archived properties free their name.
    await pool.query("update property set archived_at = now() where id = $1", [first.id]);
    expect((await call(admin.cookie, "POST", "/api/properties", base(o.id))).status).toBe(201);
  });

  it("responsible landlords must be active Admin/Landlord users; the Smoke user gives 422 (AC-EML-14)", async () => {
    const admin = await makeUser("admin@example.com", "admin");
    const lou = await makeUser("lou@example.com", "landlord");
    const smoke = await makeUser("smoke@example.com", "smoke");
    const gone = await makeUser("gone@example.com", "landlord", "deactivated");
    const invited = await makeUser("inv@example.com", "landlord", "invited");
    const o = await newOwner(admin.cookie);
    const p = await create(admin.cookie, o.id, { responsibleUserIds: [admin.id, lou.id] });
    expect(p.responsibleUserIds.sort()).toEqual([admin.id, lou.id].sort());
    for (const bad of [smoke.id, gone.id, invited.id, crypto.randomUUID()]) {
      const res = await call(admin.cookie, "PATCH", `/api/properties/${p.id}`, { responsibleUserIds: [bad], version: 1 });
      expect(res.status).toBe(422);
      expect((await res.json()).error.fields.responsibleUserIds).toBeTruthy();
      expect((await call(admin.cookie, "POST", "/api/properties", base(o.id, { name: `X${bad}`, responsibleUserIds: [bad] }))).status).toBe(422);
    }
    const ok = await call(admin.cookie, "PATCH", `/api/properties/${p.id}`, { responsibleUserIds: [lou.id], version: 1 });
    expect(((await ok.json()) as Prop).responsibleUserIds).toEqual([lou.id]);
  });

  it("PATCH bumps the version, records before→after, and a stale or missing version is refused", async () => {
    const admin = await makeUser("admin@example.com", "admin");
    const lou = await makeUser("lou@example.com", "landlord");
    const o = await newOwner(admin.cookie);
    const p = await create(admin.cookie, o.id);
    const ok = await call(admin.cookie, "PATCH", `/api/properties/${p.id}`, { city: "Queens", responsibleUserIds: [admin.id, lou.id], purchasePriceCents: 100000, version: 1 });
    expect(await ok.json()).toMatchObject({ city: "Queens", version: 2, name: p.name });
    const stale = await call(admin.cookie, "PATCH", `/api/properties/${p.id}`, { city: "Bronx", version: 1 });
    expect(stale.status).toBe(409);
    expect((await stale.json()).error.code).toBe("CONFLICT");
    expect((await call(admin.cookie, "PATCH", `/api/properties/${p.id}`, { city: "Bronx" })).status).toBe(422);
    const { rows } = await pool.query("select changes from audit_log where action = 'update'");
    expect(rows[0].changes).toMatchObject({ City: ["Brooklyn", "Queens"], "Purchase price": [null, "$1,000.00"] });
    expect(Object.keys(rows[0].changes)).toContain("Responsible landlords");
  });

  it("returns 404 NOT_FOUND for an unknown or malformed id (AC-API-05)", async () => {
    const admin = await makeUser("admin@example.com", "admin");
    for (const id of [crypto.randomUUID(), "nope"]) {
      for (const [method, body] of [["GET", undefined], ["PATCH", { city: "X", version: 1 }]] as const) {
        const res = await call(admin.cookie, method, `/api/properties/${id}`, body);
        expect(res.status, `${method} ${id}`).toBe(404);
        expect((await res.json()).error.code).toBe("NOT_FOUND");
      }
    }
  });

  it("lists with search, sort, paging and the archived filter", async () => {
    const admin = await makeUser("admin@example.com", "admin");
    const o = await newOwner(admin.cookie);
    for (const [name, street] of [["Bravo", "2 Pine St"], ["Alpha", "1 Oak Ave"], ["Charlie", "3 Pine St"]]) await create(admin.cookie, o.id, { name, street });
    await pool.query("update property set archived_at = now() where name = 'Charlie'");
    const names = async (qs: string) => ((await (await call(admin.cookie, "GET", `/api/properties${qs}`)).json()) as { data: Prop[] }).data.map((p) => p.name);
    expect(await names("")).toEqual(["Alpha", "Bravo"]);
    expect(await names("?archived=true&order=desc")).toEqual(["Charlie", "Bravo", "Alpha"]);
    expect(await names("?q=pine")).toEqual(["Bravo"]);
    expect(await names("?q=%25")).toEqual([]);
    const page = await (await call(admin.cookie, "GET", "/api/properties?page=2&pageSize=1")).json();
    expect(page).toMatchObject({ page: 2, pageSize: 1, total: 2, data: [{ name: "Bravo" }] });
    expect((await call(admin.cookie, "GET", "/api/properties?pageSize=201")).status).toBe(422);
  });

  it("GET /api/people lists only active Admin/Landlord users with id, name and email", async () => {
    const admin = await makeUser("admin@example.com", "admin");
    await makeUser("lou@example.com", "landlord");
    await makeUser("smoke@example.com", "smoke");
    await makeUser("gone@example.com", "landlord", "deactivated");
    await makeUser("inv@example.com", "landlord", "invited");
    const lou = await makeUser("lou2@example.com", "landlord");
    const res = await call(lou.cookie, "GET", "/api/people");
    const people = (await res.json()) as { id: string; name: string; email: string }[];
    expect(people.map((p) => p.email).sort()).toEqual(["admin@example.com", "lou2@example.com", "lou@example.com"]);
    expect(Object.keys(people[0] as object).sort()).toEqual(["email", "id", "name"]);
    expect(people.find((p) => p.id === admin.id)?.name).toBeTruthy();
  });
});
