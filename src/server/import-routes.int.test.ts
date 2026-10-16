import { execFileSync } from "node:child_process";
import ExcelJS from "exceljs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb } from "../db/client";
import { IMPORT_COLUMNS, IMPORT_SHEETS } from "../shared/import-template";
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
  await pool.query('truncate "user", audit_log, import_run cascade');
});
afterAll(() => pool.end());

async function signedIn(email: string, role: "admin" | "landlord" | "smoke") {
  const ctx = await auth.$context;
  const [u] = (await pool.query(`insert into "user" (name, email, role, status, email_verified) values ($2,$1,$3,'active',true) returning id`, [email, `Name of ${email}`, role])).rows;
  await pool.query(`insert into account (user_id, provider_id, account_id, password) values ($1::uuid,'credential',$1::text,$2)`, [u.id, await ctx.password.hash(PASSWORD)]);
  const res = await app.request("/api/auth/sign-in/email", { method: "POST", headers: { "content-type": "application/json", origin: env.APP_URL }, body: JSON.stringify({ email, password: PASSWORD }) });
  return res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}

describe("GET /api/import/template", () => {
  it("needs a session", async () => {
    expect((await app.request("/api/import/template")).status).toBe(401);
  });

  it.each(["admin", "landlord", "smoke"] as const)("gives %s the workbook with every sheet and its headings", async (role) => {
    const cookie = await signedIn(`${role}@example.com`, role);
    const res = await app.request("/api/import/template", { headers: { cookie } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(res.headers.get("content-disposition")).toContain('filename="rentnerd-import-template.xlsx"');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await res.arrayBuffer()) as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Instructions", ...IMPORT_SHEETS]);
    for (const name of IMPORT_SHEETS) {
      const headings: string[] = [];
      wb.getWorksheet(name)?.getRow(1).eachCell((c) => headings.push(String(c.value)));
      expect(headings).toEqual(IMPORT_COLUMNS[name].map((c) => c.header));
    }
  });
});

describe("POST /api/import/validate", () => {
  const upload = (cookie: string | undefined, bytes: Uint8Array | Buffer, name = "portfolio.xlsx") => {
    const body = new FormData();
    body.append("file", new File([new Uint8Array(bytes)], name));
    return app.request("/api/import/validate", { method: "POST", headers: { ...(cookie ? { cookie } : {}), origin: env.APP_URL }, body });
  };
  const template = async (cookie: string) => Buffer.from(await (await app.request("/api/import/template", { headers: { cookie } })).arrayBuffer());
  const withRows = async (cookie: string, rows: Record<string, Record<string, ExcelJS.CellValue>>) => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await template(cookie)) as unknown as ArrayBuffer);
    for (const [sheet, values] of Object.entries(rows)) {
      const ws = wb.getWorksheet(sheet) as ExcelJS.Worksheet;
      const cols = new Map<string, number>();
      ws.getRow(1).eachCell((c, i) => cols.set(String(c.value), i));
      for (const [h, v] of Object.entries(values)) ws.getRow(2).getCell(cols.get(h) as number).value = v;
    }
    return Buffer.from(await wb.xlsx.writeBuffer());
  };
  const tenant = { "Tenant key": "T1", "Tenant type": "Individual", "First name": "Ann", "Last name": "Lee" };

  it("needs a session and refuses the smoke user", async () => {
    expect((await upload(undefined, Buffer.from("x"))).status).toBe(401);
    const smoke = await signedIn("smoke@example.com", "smoke");
    expect((await upload(smoke, await template(smoke))).status).toBe(403);
  });

  it("stores a validated run with the file and counts for a clean workbook", async () => {
    const cookie = await signedIn("admin@example.com", "admin");
    const res = await upload(cookie, await withRows(cookie, { Tenants: tenant }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ errors: [], counts: { Owners: 0, Properties: 0, Units: 0, Tenants: 1, Leases: 0 } });
    const [run] = (await pool.query("select status, file_name, length(file) as size, counts from import_run where id = $1", [body.importRunId])).rows;
    expect(run).toMatchObject({ status: "validated", file_name: "portfolio.xlsx" });
    expect(Number(run.size)).toBeGreaterThan(1000);
  });

  it("lists problems by sheet, row and column and keeps no file", async () => {
    const cookie = await signedIn("admin@example.com", "admin");
    const res = await upload(cookie, await withRows(cookie, { Tenants: { ...tenant, Email: "nope" } }));
    const body = await res.json();
    expect(body.errors).toEqual([{ sheet: "Tenants", row: 2, column: "Email", problem: "Enter a valid email address." }]);
    const [run] = (await pool.query("select status, file from import_run where id = $1", [body.importRunId])).rows;
    expect(run).toEqual({ status: "failed", file: null });
  });

  it("turns away a file that is not .xlsx and one over 5 MB", async () => {
    const cookie = await signedIn("admin@example.com", "admin");
    const text = await upload(cookie, Buffer.from("hello"), "notes.txt");
    expect(text.status).toBe(422);
    expect((await text.json()).error.message).toBe("Choose an .xlsx file.");
    const big = await upload(cookie, Buffer.alloc(5 * 1024 * 1024 + 1, 65));
    expect(big.status).toBe(422);
    expect((await big.json()).error.message).toBe("The file must be 5 MB or smaller.");
    expect((await pool.query("select count(*) from import_run")).rows[0].count).toBe("0");
  });

  it("turns away the blank template and stores no run", async () => {
    const cookie = await signedIn("admin@example.com", "admin");
    const res = await upload(cookie, await template(cookie));
    expect(res.status).toBe(422);
    expect((await res.json()).error.message).toBe("The file has no rows to import.");
    expect((await pool.query("select count(*) from import_run")).rows[0].count).toBe("0");
  });

  it("answers a request without a file", async () => {
    const cookie = await signedIn("admin@example.com", "admin");
    const res = await app.request("/api/import/validate", { method: "POST", headers: { cookie, origin: env.APP_URL }, body: new FormData() });
    expect(res.status).toBe(422);
  });

  it("allows 10 checks per user per hour, then 429", async () => {
    const cookie = await signedIn("limit@example.com", "landlord");
    const bytes = Buffer.from("x");
    for (let i = 0; i < 10; i++) expect((await upload(cookie, bytes, "a.txt")).status).toBe(422);
    const res = await upload(cookie, bytes, "a.txt");
    expect(res.status).toBe(429);
    expect((await res.json()).error.code).toBe("RATE_LIMITED");
    const other = await signedIn("other@example.com", "landlord");
    expect((await upload(other, bytes, "a.txt")).status).toBe(422);
  });
});
