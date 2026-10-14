import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb } from "./client";

const url = "postgres://rentnerd:rentnerd@localhost:5432/rentnerd_test";
const { pool } = createDb(url);

beforeAll(() => {
  execFileSync("npm", ["run", "build"], { stdio: "pipe" });
  execFileSync("node", ["dist/migrate.js"], { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
});
beforeEach(async () => {
  await pool.query("truncate owner, property, unit, tenant, lease cascade");
});
afterAll(() => pool.end());

async function id(sql: string, args: unknown[] = []): Promise<string> {
  return (await pool.query(sql, args)).rows[0].id;
}
async function fixtures() {
  const owner = await id(`insert into owner (name, owner_type, address_line1, city, state, zip) values ('O','LLC','1 A St','NYC','NY','10001') returning id`);
  const property = await id(`insert into property (name, street, city, state, zip, owner_id) values ('P','1 A St','NYC','NY','10001',$1) returning id`, [owner]);
  const unit = await id(`insert into unit (property_id, label, use) values ($1,'1R','Residential') returning id`, [property]);
  const tenant = await id(`insert into tenant (tenant_type, first_name, last_name) values ('Individual','Ann','Lee') returning id`);
  const tenant2 = await id(`insert into tenant (tenant_type, first_name, last_name) values ('Individual','Bo','Diaz') returning id`);
  return { unit, tenant, tenant2 };
}
const insertLease = (unit: string, extra = "") =>
  pool.query(`insert into lease (unit_id, start_date, end_date, base_rent_cents ${extra ? ", " + extra.split("=")[0] : ""}) values ($1,'2026-01-01','2026-12-31',250000 ${extra ? ", " + extra.split("=")[1] : ""}) returning id, version, increase_type, rent_due_day, month_to_month`, [unit]);

describe("lease tables (SPEC §6.9, §6.10, D-31)", () => {
  it("creates a lease with defaults", async () => {
    const { unit } = await fixtures();
    const { rows } = await insertLease(unit);
    expect(rows[0]).toMatchObject({ version: 1, increase_type: "none", rent_due_day: 1, month_to_month: false });
  });
  it("rejects an end date that is not after the start, zero rent, and a due day outside 1-28", async () => {
    const { unit } = await fixtures();
    await expect(pool.query(`insert into lease (unit_id, start_date, end_date, base_rent_cents) values ($1,'2026-01-01','2026-01-01',1)`, [unit])).rejects.toThrow(/lease_dates_check/);
    await expect(pool.query(`insert into lease (unit_id, start_date, end_date, base_rent_cents) values ($1,'2026-01-01','2026-02-01',0)`, [unit])).rejects.toThrow(/lease_rent_check/);
    await expect(insertLease(unit, "rent_due_day=29")).rejects.toThrow(/lease_due_day_check/);
  });
  it("requires a move-out date and an end reason together", async () => {
    const { unit } = await fixtures();
    await expect(insertLease(unit, "move_out_date='2026-05-01'")).rejects.toThrow(/lease_end_reason_check/);
    await expect(insertLease(unit, "end_reason='Other'")).rejects.toThrow(/lease_end_reason_check/);
    await expect(pool.query(`insert into lease (unit_id, start_date, end_date, base_rent_cents, move_out_date, end_reason) values ($1,'2026-01-01','2026-12-31',1,'2027-03-01','Terminated')`, [unit])).resolves.toBeTruthy();
  });
  it("allows exactly one primary tenant per lease and per extension", async () => {
    const { unit, tenant, tenant2 } = await fixtures();
    const lease = (await insertLease(unit)).rows[0].id;
    await pool.query(`insert into lease_tenant values ($1,$2,true)`, [lease, tenant]);
    await pool.query(`insert into lease_tenant values ($1,$2,false)`, [lease, tenant2]);
    await expect(pool.query(`update lease_tenant set is_primary = true where tenant_id = $1`, [tenant2])).rejects.toThrow(/lease_tenant_one_primary_idx/);
    await expect(pool.query(`insert into lease_tenant values ($1,$2,false)`, [lease, tenant])).rejects.toThrow(/lease_tenant_lease_id_tenant_id_pk/);
    const ext = await id(`insert into lease_extension (lease_id, start_date, end_date, base_rent_cents) values ($1,'2027-01-01','2027-12-31',260000) returning id`, [lease]);
    await pool.query(`insert into extension_tenant values ($1,$2,true)`, [ext, tenant]);
    await expect(pool.query(`insert into extension_tenant values ($1,$2,true)`, [ext, tenant2])).rejects.toThrow(/extension_tenant_one_primary_idx/);
  });
  it("rent steps belong to exactly one of a lease or an extension", async () => {
    const { unit } = await fixtures();
    const lease = (await insertLease(unit)).rows[0].id;
    const ext = await id(`insert into lease_extension (lease_id, start_date, end_date, base_rent_cents) values ($1,'2027-01-01','2027-12-31',260000) returning id`, [lease]);
    await pool.query(`insert into rent_step (lease_id, effective_date, amount_cents) values ($1,'2026-07-01',260000)`, [lease]);
    await pool.query(`insert into rent_step (extension_id, effective_date, amount_cents) values ($1,'2027-07-01',270000)`, [ext]);
    await expect(pool.query(`insert into rent_step (effective_date, amount_cents) values ('2026-07-01',1)`)).rejects.toThrow(/rent_step_owner_check/);
    await expect(pool.query(`insert into rent_step (lease_id, extension_id, effective_date, amount_cents) values ($1,$2,'2026-07-01',1)`, [lease, ext])).rejects.toThrow(/rent_step_owner_check/);
  });
  it("keeps one revision per version number", async () => {
    const { unit } = await fixtures();
    const lease = (await insertLease(unit)).rows[0].id;
    const add = (n: number) => pool.query(`insert into lease_revision (lease_id, version_number, snapshot, summary) values ($1,$2,'{}','Lease created')`, [lease, n]);
    await add(1);
    await expect(add(1)).rejects.toThrow(/lease_revision_lease_version_unique/);
    await add(2);
  });
  it("deleting a lease deletes its tenants, extensions, rent steps and revisions", async () => {
    const { unit, tenant } = await fixtures();
    const lease = (await insertLease(unit)).rows[0].id;
    const ext = await id(`insert into lease_extension (lease_id, start_date, end_date, base_rent_cents) values ($1,'2027-01-01','2027-12-31',1) returning id`, [lease]);
    await pool.query(`insert into lease_tenant values ($1,$2,true)`, [lease, tenant]);
    await pool.query(`insert into extension_tenant values ($1,$2,true)`, [ext, tenant]);
    await pool.query(`insert into rent_step (extension_id, effective_date, amount_cents) values ($1,'2027-07-01',2)`, [ext]);
    await pool.query(`insert into lease_revision (lease_id, version_number, snapshot, summary) values ($1,1,'{}','x')`, [lease]);
    await pool.query(`delete from lease where id = $1`, [lease]);
    for (const t of ["lease_tenant", "lease_extension", "extension_tenant", "rent_step", "lease_revision"]) {
      expect((await pool.query(`select count(*)::int as n from ${t}`)).rows[0].n).toBe(0);
    }
  });
  it("a unit or tenant on a lease cannot be deleted from under it", async () => {
    const { unit, tenant } = await fixtures();
    const lease = (await insertLease(unit)).rows[0].id;
    await pool.query(`insert into lease_tenant values ($1,$2,true)`, [lease, tenant]);
    await expect(pool.query(`delete from unit where id = $1`, [unit])).rejects.toThrow();
    await expect(pool.query(`delete from tenant where id = $1`, [tenant])).rejects.toThrow();
  });
});
