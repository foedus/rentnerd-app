import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb } from "../db/client";
import { seedComplianceCatalog, syncPropertyCompliance, syncTypeOnAllProperties } from "./compliance-items";

const url = "postgres://rentnerd:rentnerd@localhost:5432/rentnerd_test";
const { pool, db } = createDb(url);
const TODAY = "2026-10-15";

beforeAll(() => {
  execFileSync("npm", ["run", "build"], { stdio: "pipe" });
  execFileSync("node", ["dist/migrate.js"], { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
});
beforeEach(async () => {
  await pool.query("truncate owner, property, unit, compliance_item_type cascade");
});
afterAll(() => pool.end());

const one = async (sql: string, args: unknown[] = []) => (await pool.query(sql, args)).rows[0];
async function makeProperty(inNyc = true) {
  const o = await one(`insert into owner (name, owner_type, address_line1, city, state, zip) values ('O','LLC','1 A St','NYC','NY','10001') returning id`);
  return (await one(`insert into property (name, street, city, state, zip, owner_id, in_nyc) values ('P','1 A St','NYC','NY','10001',$1,$2) returning id`, [o.id, inNyc])).id as string;
}
const addUnit = (propertyId: string, label: string, use: string) => one(`insert into unit (property_id, label, use) values ($1,$2,$3) returning id`, [propertyId, label, use]);
const sync = (propertyId: string) => db.transaction((tx) => syncPropertyCompliance(tx, propertyId, TODAY));
type ItemState = { applicable: boolean; due: string | null };
const itemMap = async (propertyId: string): Promise<Record<string, ItemState>> =>
  Object.fromEntries((await pool.query(`select t.name, i.applicable, i.next_due_date::text as due from property_compliance_item i join compliance_item_type t on t.id = i.type_id where i.property_id = $1`, [propertyId])).rows.map((r): [string, ItemState] => [r.name, { applicable: r.applicable, due: r.due }]));

const items = itemMap;

describe("seedComplianceCatalog", () => {
  it("inserts the nine seeded types, only the missing ones on later runs, and never overwrites edits", async () => {
    expect(await seedComplianceCatalog(db)).toEqual({ inserted: 9 });
    await pool.query(`update compliance_item_type set description = 'mine', due_day = 2 where name = 'HPD Property Registration'`);
    await pool.query(`delete from compliance_item_type where name = 'Boiler Inspection'`);
    expect(await seedComplianceCatalog(db)).toEqual({ inserted: 1 });
    expect(await one(`select count(*)::int as n from compliance_item_type where is_seeded`)).toEqual({ n: 9 });
    expect(await one(`select description, due_day, due_month from compliance_item_type where name = 'HPD Property Registration'`)).toEqual({ description: "mine", due_day: 2, due_month: 9 });
  });
  it("is safe to run twice at once", async () => {
    await Promise.all([seedComplianceCatalog(db), seedComplianceCatalog(db)]);
    expect(await one(`select count(*)::int as n from compliance_item_type`)).toEqual({ n: 9 });
  });
  it("creates the items for existing properties", async () => {
    const p = await makeProperty();
    await seedComplianceCatalog(db);
    expect(Object.keys(await items(p))).toHaveLength(9);
  });
});

describe("syncPropertyCompliance (§6.14)", () => {
  it("creates every item as Not applicable for a property with no units", async () => {
    await seedComplianceCatalog(db);
    const p = await makeProperty();
    await sync(p);
    const rows = Object.values(await items(p));
    expect(rows).toHaveLength(9);
    expect(rows.every((r) => !r.applicable && r.due === null)).toBe(true);
  });
  it("applies by unit use and NYC flag, and schedules annual dates only", async () => {
    await seedComplianceCatalog(db);
    const p = await makeProperty();
    await addUnit(p, "1R", "Residential");
    await sync(p);
    const rows = await items(p);
    expect(rows["HPD Property Registration"]).toEqual({ applicable: true, due: "2027-09-01" });
    expect(rows["Bed Bug Annual Filing"]).toEqual({ applicable: true, due: "2026-12-31" });
    expect(rows["Boiler Inspection"]).toEqual({ applicable: true, due: null });
    expect(rows["Smoke and CO Detector Check"]).toEqual({ applicable: true, due: null });
    expect(rows["Storefront Registry Filing"]).toEqual({ applicable: false, due: null });
  });
  it("recomputes when a unit is added or archived or restored, and when the NYC flag changes", async () => {
    await seedComplianceCatalog(db);
    const p = await makeProperty();
    await addUnit(p, "1R", "Residential");
    await sync(p);
    const shop = await addUnit(p, "Shop", "Commercial");
    await sync(p);
    expect((await items(p))["Storefront Registry Filing"]).toEqual({ applicable: true, due: "2027-06-01" });
    await pool.query(`update unit set archived_at = now() where id = $1`, [shop.id]);
    await sync(p);
    expect((await items(p))["Storefront Registry Filing"]?.applicable).toBe(false);
    await pool.query(`update unit set archived_at = null where id = $1`, [shop.id]);
    await sync(p);
    expect((await items(p))["Storefront Registry Filing"]?.applicable).toBe(true);
    await pool.query(`update property set in_nyc = false where id = $1`, [p]);
    await sync(p);
    expect(await one(`select i.version from property_compliance_item i join compliance_item_type t on t.id = i.type_id where i.property_id = $1 and t.name = 'Boiler Inspection'`, [p])).toEqual({ version: 2 });
    const rows = await items(p);
    expect(rows["Boiler Inspection"]?.applicable).toBe(false);
    expect(rows["Smoke and CO Detector Check"]?.applicable).toBe(true);
  });
  it("keeps an editor's choice and an existing due date", async () => {
    await seedComplianceCatalog(db);
    const p = await makeProperty();
    await sync(p);
    await pool.query(`update property_compliance_item set applicable = true, applicable_set_by_user = true where property_id = $1`, [p]);
    await addUnit(p, "1R", "Residential");
    await sync(p);
    expect(Object.values(await items(p)).every((r) => r.applicable)).toBe(true);
    await pool.query(`update property_compliance_item set applicable_set_by_user = false, applicable = false, next_due_date = '2030-01-01' where property_id = $1`, [p]);
    await sync(p);
    expect((await items(p))["Window Guard Annual Notice"]).toEqual({ applicable: true, due: "2030-01-01" });
  });
  it("skips archived types", async () => {
    await seedComplianceCatalog(db);
    await pool.query(`update compliance_item_type set archived_at = now() where name = 'Boiler Inspection'`);
    const p = await makeProperty();
    await sync(p);
    expect(Object.keys(await items(p))).not.toContain("Boiler Inspection");
  });
});

describe("syncTypeOnAllProperties", () => {
  it("adds the new type to every property: applicable with units, Not applicable without", async () => {
    const withUnits = await makeProperty();
    await addUnit(withUnits, "1R", "Residential");
    const o = await one(`select id from owner`);
    const empty = (await one(`insert into property (name, street, city, state, zip, owner_id) values ('Q','2 A St','NYC','NY','10001',$1) returning id`, [o.id])).id as string;
    const t = await one(`insert into compliance_item_type (name, applies_to, schedule_type, interval_months) values ('Elevator inspection','All properties','interval',12) returning id`);
    await db.transaction((tx) => syncTypeOnAllProperties(tx, t.id, TODAY));
    await db.transaction((tx) => syncTypeOnAllProperties(tx, t.id, TODAY));
    expect((await items(withUnits))["Elevator inspection"]).toEqual({ applicable: true, due: null });
    expect((await items(empty))["Elevator inspection"]).toEqual({ applicable: false, due: null });
  });
});
