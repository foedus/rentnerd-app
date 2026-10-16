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
  await pool.query('truncate "user", audit_log cascade');
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
