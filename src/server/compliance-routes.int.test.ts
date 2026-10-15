import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb } from "../db/client";
import { createApp } from "./app";
import { createAuth } from "./auth";
import { seedComplianceCatalog, syncPropertyCompliance } from "./compliance-items";

const url = "postgres://rentnerd:rentnerd@localhost:5432/rentnerd_test";
const { pool, db } = createDb(url);
const env = { AUTH_SECRET: "integration-test-secret-0123456789abcdef0123456789", APP_URL: "http://localhost:8080" };
const auth = createAuth(db, env);
const PASSWORD = "Correct-horse-1234";
const app = createApp(pool, "dist/client", auth, { testRoutesEnabled: false }, env.APP_URL, db, async () => undefined);
const UUID = "00000000-0000-4000-8000-000000000000";

beforeAll(() => {
  execFileSync("npm", ["run", "build"], { stdio: "pipe" });
  execFileSync("node", ["dist/migrate.js"], { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
});
beforeEach(async () => {
  await pool.query('truncate "user", owner, property, unit, compliance_item_type, audit_log cascade');
  await seedComplianceCatalog(db);
});
afterAll(() => pool.end());

async function makeUser(email: string, role: "admin" | "landlord" | "smoke") {
  const ctx = await auth.$context;
  const [u] = (await pool.query(`insert into "user" (name, email, role, status, email_verified) values ($2,$1,$3,'active',true) returning id`, [email, `Name of ${email}`, role])).rows;
  await pool.query(`insert into account (user_id, provider_id, account_id, password) values ($1::uuid,'credential',$1::text,$2)`, [u.id, await ctx.password.hash(PASSWORD)]);
  const res = await app.request("/api/auth/sign-in/email", { method: "POST", headers: { "content-type": "application/json", origin: env.APP_URL }, body: JSON.stringify({ email, password: PASSWORD }) });
  return { id: u.id as string, cookie: res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ") };
}
const call = (cookie: string, method: string, path: string, body?: unknown) =>
  app.request(path, { method, headers: { cookie, origin: env.APP_URL, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const one = async (sql: string, args: unknown[] = []) => (await pool.query(sql, args)).rows[0];

async function makeProperty(name: string, opts: { responsible?: string[]; use?: string | null; inNyc?: boolean } = {}) {
  const o = (await pool.query(`select id from owner limit 1`)).rows[0] ?? (await one(`insert into owner (name, owner_type, address_line1, city, state, zip) values ('O','LLC','1 A St','NYC','NY','10001') returning id`));
  const p = await one(`insert into property (name, street, city, state, zip, owner_id, in_nyc) values ($1,'1 A St','NYC','NY','10001',$2,$3) returning id`, [name, o.id, opts.inNyc ?? true]);
  for (const u of opts.responsible ?? []) await pool.query(`insert into property_responsible (property_id, user_id) values ($1,$2)`, [p.id, u]);
  if (opts.use !== null) await pool.query(`insert into unit (property_id, label, use) values ($1,'1',$2)`, [p.id, opts.use ?? "Residential"]);
  await db.transaction((tx) => syncPropertyCompliance(tx, p.id));
  return p.id as string;
}
type Item = { id: string; version: number; status: string; applicable: boolean; nextDueDate: string | null; lastCompletedOn: string | null; type: { name: string }; propertyName: string; responsible: { id: string }[] };
const itemsOf = async (cookie: string, propertyId: string) => ((await (await call(cookie, "GET", `/api/properties/${propertyId}/compliance`)).json()) as { data: Item[] }).data;
const named = (items: Item[], name: string) => items.find((i) => i.type.name === name) as Item;

const annual = { name: "Elevator inspection", appliesTo: "All properties", nycOnly: false, scheduleType: "interval", intervalMonths: 12 };
const auditCount = async (action: string) => (await one(`select count(*)::int as n from audit_log where action = $1`, [action])).n as number;

describe("compliance item types", () => {
  it("lists the seeded catalog, paginated, and hides archived types unless asked", async () => {
    const { cookie } = await makeUser("a@x.com", "admin");
    const res = await call(cookie, "GET", "/api/compliance/types");
    const body = (await res.json()) as { data: { name: string; hasCompletions: boolean; isSeeded: boolean }[]; total: number };
    expect(res.status).toBe(200);
    expect(body.total).toBe(9);
    expect(body.data.every((t) => t.isSeeded && !t.hasCompletions)).toBe(true);
    await pool.query(`update compliance_item_type set archived_at = now() where name = 'Boiler Inspection'`);
    expect(((await (await call(cookie, "GET", "/api/compliance/types")).json()) as { total: number }).total).toBe(8);
    expect(((await (await call(cookie, "GET", "/api/compliance/types?archived=true")).json()) as { total: number }).total).toBe(9);
    expect(((await (await call(cookie, "GET", "/api/compliance/types?pageSize=2&page=2")).json()) as { data: unknown[] }).data).toHaveLength(2);
  });

  it("creates a type and adds it to every property: applicable for those with units, not for those without (AC-CMP-08)", async () => {
    const { cookie } = await makeUser("a@x.com", "admin");
    const withUnit = await makeProperty("Has units");
    const empty = await makeProperty("No units", { use: null });
    const res = await call(cookie, "POST", "/api/compliance/types", annual);
    expect(res.status).toBe(201);
    expect(named(await itemsOf(cookie, withUnit), "Elevator inspection")).toMatchObject({ applicable: true, status: "Not scheduled" });
    expect(named(await itemsOf(cookie, empty), "Elevator inspection")).toMatchObject({ applicable: false, status: "Not applicable" });
    expect(await auditCount("create")).toBe(1);
  });

  it("validates the schedule and refuses a duplicate name, ignoring case", async () => {
    const { cookie } = await makeUser("a@x.com", "admin");
    const bad = await call(cookie, "POST", "/api/compliance/types", { ...annual, scheduleType: "annual_date", intervalMonths: undefined });
    expect(bad.status).toBe(422);
    expect(((await bad.json()) as { error: { fields: Record<string, string> } }).error.fields.dueMonth).toBe("Choose a month and day.");
    expect((await call(cookie, "POST", "/api/compliance/types", { ...annual, name: "boiler inspection" })).status).toBe(409);
    expect((await call(cookie, "POST", "/api/compliance/types", { ...annual, name: "Fresh" })).status).toBe(201);
  });

  it("edits with a version, skips no-op edits and refuses stale or incomplete ones", async () => {
    const { cookie } = await makeUser("a@x.com", "admin");
    const t = (await (await call(cookie, "POST", "/api/compliance/types", annual)).json()) as { id: string; version: number };
    const ok = await call(cookie, "PATCH", `/api/compliance/types/${t.id}`, { description: "Yearly", version: t.version });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ description: "Yearly", version: t.version + 1 });
    const same = await call(cookie, "PATCH", `/api/compliance/types/${t.id}`, { description: "Yearly", version: t.version + 1 });
    expect(((await same.json()) as { version: number }).version).toBe(t.version + 1);
    expect(await auditCount("update")).toBe(1);
    expect((await call(cookie, "PATCH", `/api/compliance/types/${t.id}`, { description: "x", version: t.version })).status).toBe(409);
    const incomplete = await call(cookie, "PATCH", `/api/compliance/types/${t.id}`, { scheduleType: "annual_date", version: t.version + 1 });
    expect(incomplete.status).toBe(422);
    const switched = await call(cookie, "PATCH", `/api/compliance/types/${t.id}`, { scheduleType: "annual_date", dueMonth: 3, dueDay: 4, version: t.version + 1 });
    expect(await switched.json()).toMatchObject({ scheduleType: "annual_date", dueMonth: 3, dueDay: 4, intervalMonths: null });
    expect((await call(cookie, "PATCH", `/api/compliance/types/${UUID}`, { description: "x", version: 1 })).status).toBe(404);
    expect((await call(cookie, "PATCH", `/api/compliance/types/${t.id}`, { name: "Boiler Inspection", version: t.version + 2 })).status).toBe(409);
  });

  it("recomputes applicability when who the type applies to changes, keeping an editor's choice", async () => {
    const { cookie } = await makeUser("a@x.com", "admin");
    const p = await makeProperty("Residential only");
    const a = await makeUser("b@x.com", "landlord");
    const t = (await (await call(cookie, "POST", "/api/compliance/types", { ...annual, appliesTo: "Properties with commercial units" })).json()) as { id: string; version: number };
    expect(named(await itemsOf(cookie, p), "Elevator inspection").applicable).toBe(false);
    await call(a.cookie, "PATCH", `/api/compliance/types/${t.id}`, { appliesTo: "All properties", version: t.version });
    expect(named(await itemsOf(cookie, p), "Elevator inspection").applicable).toBe(true);
    const item = named(await itemsOf(cookie, p), "Elevator inspection");
    await call(cookie, "PATCH", `/api/compliance/items/${item.id}`, { applicable: false, version: item.version });
    await call(cookie, "PATCH", `/api/compliance/types/${t.id}`, { nycOnly: true, version: t.version + 1 });
    await call(cookie, "PATCH", `/api/compliance/types/${t.id}`, { nycOnly: false, version: t.version + 2 });
    expect(named(await itemsOf(cookie, p), "Elevator inspection").applicable).toBe(false);
  });

  it("archives and restores, hiding the type's items while archived", async () => {
    const { cookie } = await makeUser("a@x.com", "admin");
    const p = await makeProperty("P");
    const id = (await one(`select id from compliance_item_type where name = 'Boiler Inspection'`)).id;
    expect((await call(cookie, "POST", `/api/compliance/types/${id}/restore`)).status).toBe(409);
    const archived = await call(cookie, "POST", `/api/compliance/types/${id}/archive`);
    expect(archived.status).toBe(200);
    expect(((await archived.json()) as { archivedAt: string | null }).archivedAt).not.toBeNull();
    expect((await call(cookie, "POST", `/api/compliance/types/${id}/archive`)).status).toBe(409);
    expect((await itemsOf(cookie, p)).map((i) => i.type.name)).not.toContain("Boiler Inspection");
    const hidden = (await one(`select i.id, i.version from property_compliance_item i where i.type_id = $1`, [id])) as { id: string; version: number };
    expect((await call(cookie, "PATCH", `/api/compliance/items/${hidden.id}`, { notes: "x", version: hidden.version })).status).toBe(404);
    expect((await call(cookie, "POST", `/api/compliance/items/${hidden.id}/completions`, { completedOn: "2026-01-02" })).status).toBe(404);
    expect((await one(`select version from property_compliance_item where id = $1`, [hidden.id])).version).toBe(hidden.version);
    expect((await call(cookie, "POST", `/api/compliance/types/${id}/restore`, { version: 1 })).status).toBe(409);
    const restored = await call(cookie, "POST", `/api/compliance/types/${id}/restore`);
    expect(((await restored.json()) as { archivedAt: string | null }).archivedAt).toBeNull();
    expect((await itemsOf(cookie, p)).map((i) => i.type.name)).toContain("Boiler Inspection");
    expect(await auditCount("archive")).toBe(1);
    expect(await auditCount("restore")).toBe(1);
  });

  it("deletes a completion-free type with its items, but refuses one with completions (AC-CMP-14)", async () => {
    const { cookie } = await makeUser("a@x.com", "admin");
    const p = await makeProperty("P");
    const free = (await (await call(cookie, "POST", "/api/compliance/types", annual)).json()) as { id: string };
    expect((await call(cookie, "DELETE", `/api/compliance/types/${free.id}`)).status).toBe(204);
    expect((await itemsOf(cookie, p)).map((i) => i.type.name)).not.toContain("Elevator inspection");
    expect(await one(`select count(*)::int as n from property`)).toEqual({ n: 1 });
    expect((await call(cookie, "DELETE", `/api/compliance/types/${free.id}`)).status).toBe(404);

    const boiler = named(await itemsOf(cookie, p), "Smoke and CO Detector Check");
    await call(cookie, "POST", `/api/compliance/items/${boiler.id}/completions`, { completedOn: "2026-01-02" });
    const typeId = (await one(`select id from compliance_item_type where name = 'Smoke and CO Detector Check'`)).id;
    const refused = await call(cookie, "DELETE", `/api/compliance/types/${typeId}`);
    expect(refused.status).toBe(409);
    expect(((await (await call(cookie, "GET", "/api/compliance/types")).json()) as { data: { id: string; hasCompletions: boolean }[] }).data.find((t) => t.id === typeId)?.hasCompletions).toBe(true);
    expect((await itemsOf(cookie, p)).map((i) => i.type.name)).toContain("Smoke and CO Detector Check");
  });
});

describe("compliance items", () => {
  it("shows a property's items with status, schedule and responsible landlords", async () => {
    const { cookie, id } = await makeUser("a@x.com", "admin");
    const p = await makeProperty("P", { responsible: [id] });
    const items = await itemsOf(cookie, p);
    expect(items).toHaveLength(9);
    expect(named(items, "HPD Property Registration")).toMatchObject({ applicable: true, version: 1, lastCompletedOn: null, responsible: [{ id }], propertyName: "P" });
    expect(named(items, "Smoke and CO Detector Check")).toMatchObject({ status: "Not scheduled", nextDueDate: null });
    expect(named(items, "Storefront Registry Filing")).toMatchObject({ applicable: false, status: "Not applicable" });
    expect((await call(cookie, "GET", `/api/properties/${UUID}/compliance`)).status).toBe(404);
    expect((await call(cookie, "GET", "/api/properties/nope/compliance")).status).toBe(404);
  });

  it("filters the list by property, status and responsible landlord (AC-CMP-10) and skips archived properties", async () => {
    const { cookie, id: adminId } = await makeUser("a@x.com", "admin");
    const other = await makeUser("b@x.com", "landlord");
    const mine = await makeProperty("Mine", { responsible: [adminId] });
    const theirs = await makeProperty("Theirs", { responsible: [other.id] });
    await pool.query(`update property_compliance_item set next_due_date = '2000-01-01' where property_id = $1`, [mine]);
    const list = async (qs: string) => (await (await call(cookie, "GET", `/api/compliance/items${qs}`)).json()) as { data: Item[]; total: number };

    expect((await list(`?responsibleUserId=${other.id}`)).data.every((i) => i.propertyName === "Theirs")).toBe(true);
    expect((await list(`?propertyId=${mine}`)).total).toBe(9);
    const overdue = await list("?status=Overdue");
    expect(overdue.total).toBe(8);
    expect(overdue.data.every((i) => i.propertyName === "Mine" && i.status === "Overdue")).toBe(true);
    expect((await list("?status=Overdue&status=Upcoming")).data.every((i) => ["Overdue", "Upcoming"].includes(i.status))).toBe(true);
    expect((await list("?status[]=Overdue")).total).toBe(8);
    const mixed = await list(`?propertyId=${theirs}&status=Not scheduled,Upcoming,Due soon`);
    expect(mixed.data.every((i) => ["Not scheduled", "Upcoming", "Due soon"].includes(i.status))).toBe(true);
    expect((await list("?pageSize=5&page=2&status=Overdue")).data).toHaveLength(3);
    expect((await call(cookie, "GET", "/api/compliance/items?status=Late")).status).toBe(422);

    await pool.query(`update property set archived_at = now() where id = $1`, [mine]);
    expect((await list(`?propertyId=${mine}`)).total).toBe(0);
  });

  it("switches an item off and on, keeps the choice, and hides it from the default statuses (AC-CMP-04, AC-CMP-11)", async () => {
    const { cookie } = await makeUser("a@x.com", "admin");
    const p = await makeProperty("P");
    const hpd = named(await itemsOf(cookie, p), "HPD Property Registration");
    const off = await call(cookie, "PATCH", `/api/compliance/items/${hpd.id}`, { applicable: false, version: hpd.version });
    expect(await off.json()).toMatchObject({ applicable: false, status: "Not applicable", version: hpd.version + 1 });
    const due = (await (await call(cookie, "GET", `/api/compliance/items?propertyId=${p}&status=Overdue,Due soon,Upcoming`)).json()) as { data: Item[] };
    expect(due.data.map((i) => i.type.name)).not.toContain("HPD Property Registration");
    await pool.query(`insert into unit (property_id, label, use) values ($1,'2','Residential')`, [p]);
    await db.transaction((tx) => syncPropertyCompliance(tx, p));
    expect(named(await itemsOf(cookie, p), "HPD Property Registration").applicable).toBe(false);
    const on = named(await itemsOf(cookie, p), "HPD Property Registration");
    const back = await call(cookie, "PATCH", `/api/compliance/items/${on.id}`, { applicable: true, nextDueDate: null, version: on.version });
    expect(((await back.json()) as Item).applicable).toBe(true);
  });

  it("gives an annual item its date when switched back on without one, and sets a date and notes", async () => {
    const { cookie } = await makeUser("a@x.com", "admin");
    const p = await makeProperty("P", { use: null });
    const hpd = named(await itemsOf(cookie, p), "HPD Property Registration");
    expect(hpd.nextDueDate).toBeNull();
    const on = await call(cookie, "PATCH", `/api/compliance/items/${hpd.id}`, { applicable: true, version: hpd.version });
    const switched = (await on.json()) as Item;
    expect(switched.nextDueDate).toMatch(/^\d{4}-09-01$/);
    const set = await call(cookie, "PATCH", `/api/compliance/items/${hpd.id}`, { nextDueDate: "2099-05-06", notes: "  Filed online ", version: switched.version });
    expect(await set.json()).toMatchObject({ nextDueDate: "2099-05-06", notes: "Filed online", status: "Upcoming" });
    expect(await auditCount("update")).toBe(2);
  });

  it("refuses stale and invalid item edits, and writes nothing for a no-op", async () => {
    const { cookie } = await makeUser("a@x.com", "admin");
    const p = await makeProperty("P");
    const hpd = named(await itemsOf(cookie, p), "HPD Property Registration");
    expect((await call(cookie, "PATCH", `/api/compliance/items/${hpd.id}`, { notes: "x", version: hpd.version + 5 })).status).toBe(409);
    expect((await call(cookie, "PATCH", `/api/compliance/items/${hpd.id}`, { notes: "x" })).status).toBe(422);
    expect((await call(cookie, "PATCH", `/api/compliance/items/${hpd.id}`, { nextDueDate: "2026-13-01", version: hpd.version })).status).toBe(422);
    expect((await call(cookie, "PATCH", `/api/compliance/items/${UUID}`, { notes: "x", version: 1 })).status).toBe(404);
    const noop = await call(cookie, "PATCH", `/api/compliance/items/${hpd.id}`, { notes: null, version: hpd.version });
    expect(((await noop.json()) as Item).version).toBe(hpd.version);
    expect(await auditCount("update")).toBe(0);
  });

  it("records completions, moves the due date, lists and deletes them (AC-CMP-05, AC-CMP-15)", async () => {
    const { cookie, id } = await makeUser("a@x.com", "admin");
    const p = await makeProperty("P");
    const bed = named(await itemsOf(cookie, p), "Bed Bug Annual Filing");
    const done = await call(cookie, "POST", `/api/compliance/items/${bed.id}/completions`, { completedOn: "2026-09-15", notes: "Filed", nextDueDate: "2027-12-31", version: bed.version });
    expect(done.status).toBe(201);
    expect(await done.json()).toMatchObject({ completedOn: "2026-09-15", notes: "Filed", completedById: id, completedByName: "Name of a@x.com" });
    expect(named(await itemsOf(cookie, p), "Bed Bug Annual Filing")).toMatchObject({ nextDueDate: "2027-12-31", lastCompletedOn: "2026-09-15", version: bed.version + 1 });
    expect(await auditCount("compliance_complete")).toBe(1);

    await call(cookie, "POST", `/api/compliance/items/${bed.id}/completions`, { completedOn: "2025-12-20" });
    const history = (await (await call(cookie, "GET", `/api/compliance/items/${bed.id}/completions`)).json()) as { data: { id: string; completedOn: string }[]; total: number };
    expect(history.data.map((h) => h.completedOn)).toEqual(["2026-09-15", "2025-12-20"]);
    expect(history.total).toBe(2);
    // Omitting nextDueDate leaves the date alone.
    expect(named(await itemsOf(cookie, p), "Bed Bug Annual Filing").nextDueDate).toBe("2027-12-31");

    expect((await call(cookie, "DELETE", `/api/compliance/completions/${history.data[0]?.id}`)).status).toBe(204);
    expect(((await (await call(cookie, "GET", `/api/compliance/items/${bed.id}/completions`)).json()) as { total: number }).total).toBe(1);
    expect((await call(cookie, "DELETE", `/api/compliance/completions/${history.data[0]?.id}`)).status).toBe(404);
  });

  it("shows a one-time item with a completion and no next date as Completed", async () => {
    const { cookie } = await makeUser("a@x.com", "admin");
    const p = await makeProperty("P");
    const t = (await (await call(cookie, "POST", "/api/compliance/types", { name: "Once", appliesTo: "All properties", nycOnly: false, scheduleType: "one_time" })).json()) as { id: string };
    expect(t.id).toBeTruthy();
    const item = named(await itemsOf(cookie, p), "Once");
    await call(cookie, "POST", `/api/compliance/items/${item.id}/completions`, { completedOn: "2026-01-02", nextDueDate: null });
    expect(named(await itemsOf(cookie, p), "Once")).toMatchObject({ status: "Completed", lastCompletedOn: "2026-01-02" });
  });

  it("refuses a stale or invalid completion and an unknown item", async () => {
    const { cookie } = await makeUser("a@x.com", "admin");
    const p = await makeProperty("P");
    const bed = named(await itemsOf(cookie, p), "Bed Bug Annual Filing");
    expect((await call(cookie, "POST", `/api/compliance/items/${bed.id}/completions`, { completedOn: "2026-09-15", version: bed.version + 3 })).status).toBe(409);
    expect((await call(cookie, "POST", `/api/compliance/items/${bed.id}/completions`, { completedOn: "soon" })).status).toBe(422);
    expect((await call(cookie, "POST", `/api/compliance/items/${bed.id}/completions`, { completedOn: "2099-01-01" })).status).toBe(422);
    expect((await call(cookie, "POST", `/api/compliance/items/${UUID}/completions`, { completedOn: "2026-09-15" })).status).toBe(404);
    expect((await call(cookie, "GET", `/api/compliance/items/${UUID}/completions`)).status).toBe(404);
    expect(await one(`select count(*)::int as n from compliance_completion`)).toEqual({ n: 0 });
  });
});

describe("authorization", () => {
  it("lets landlords write, the Smoke user read only, and signed-out callers nothing", async () => {
    const landlord = await makeUser("l@x.com", "landlord");
    const smoke = await makeUser("s@x.com", "smoke");
    const p = await makeProperty("P");
    const item = named(await itemsOf(smoke.cookie, p), "HPD Property Registration");
    expect((await call(landlord.cookie, "POST", "/api/compliance/types", annual)).status).toBe(201);
    expect((await call(smoke.cookie, "GET", "/api/compliance/types")).status).toBe(200);
    expect((await call(smoke.cookie, "GET", "/api/compliance/items")).status).toBe(200);
    for (const [method, path, body] of [
      ["POST", "/api/compliance/types", { ...annual, name: "Other" }],
      ["PATCH", `/api/compliance/types/${UUID}`, { name: "x", version: 1 }],
      ["POST", `/api/compliance/types/${UUID}/archive`, undefined],
      ["POST", `/api/compliance/types/${UUID}/restore`, undefined],
      ["DELETE", `/api/compliance/types/${UUID}`, undefined],
      ["PATCH", `/api/compliance/items/${item.id}`, { notes: "x", version: item.version }],
      ["POST", `/api/compliance/items/${item.id}/completions`, { completedOn: "2026-01-02" }],
      ["DELETE", `/api/compliance/completions/${UUID}`, undefined],
    ] as const) {
      expect((await call(smoke.cookie, method, path, body)).status, `${method} ${path}`).toBe(403);
    }
    for (const path of ["/api/compliance/types", "/api/compliance/items", `/api/properties/${p}/compliance`, `/api/compliance/items/${item.id}/completions`]) {
      expect((await call("", "GET", path)).status, path).toBe(401);
    }
    const noOrigin = await app.request("/api/compliance/types", { method: "POST", headers: { cookie: landlord.cookie, "content-type": "application/json" }, body: JSON.stringify({ ...annual, name: "Y" }) });
    expect(noOrigin.status).toBe(403);
  });
});
