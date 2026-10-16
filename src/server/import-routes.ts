import ExcelJS from "exceljs";
import type { Context, Hono } from "hono";
import type { Db } from "../db/client";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { importRun, property, user } from "../db/schema";
import { apiError } from "./api-guard";
import { checkImportFile, IMPORT_MAX_BYTES, NOT_XLSX, rejectUpload, TOO_BIG } from "./import-file";
import type { ImportExisting } from "../shared/import-links";
import { RateLimiter } from "./rate-limit";
import { IMPORT_COLUMNS, IMPORT_INSTRUCTIONS, IMPORT_SHEETS, IMPORT_TEMPLATE_FILENAME } from "../shared/import-template";

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** The blank import workbook (§11.22): an Instructions sheet and one sheet per record type with its column headings. */
export async function buildImportTemplate(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const info = wb.addWorksheet("Instructions");
  info.getColumn(1).width = 34;
  info.getColumn(2).width = 40;
  info.getColumn(3).width = 70;
  IMPORT_INSTRUCTIONS.forEach((line, i) => {
    info.addRow([line]).getCell(1).font = { bold: i === 0 };
  });
  for (const name of IMPORT_SHEETS) {
    info.addRow([]);
    info.addRow([name]).font = { bold: true };
    const head = info.addRow(["Column", "Required?", "Format"]);
    head.font = { bold: true };
    for (const c of IMPORT_COLUMNS[name]) info.addRow([c.header, c.rule, c.format ?? ""]);
  }
  for (const name of IMPORT_SHEETS) {
    const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
    ws.columns = IMPORT_COLUMNS[name].map((c) => ({ header: c.header, key: c.header, width: Math.max(16, c.header.length + 4) }));
    ws.getRow(1).font = { bold: true };
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** What the file is checked against: non-archived property names and active Admin/Landlord emails (§6.4, §11.22). */
async function loadExisting(db: Db): Promise<ImportExisting> {
  const [props, people] = await Promise.all([
    db.select({ name: property.name }).from(property).where(isNull(property.archivedAt)),
    db.select({ email: user.email }).from(user).where(and(inArray(user.role, ["admin", "landlord"]), eq(user.status, "active"))),
  ]);
  return { propertyNames: new Set(props.map((p) => p.name.toLowerCase())), landlordEmails: new Set(people.map((p) => p.email.toLowerCase())) };
}

/** Import (§14.2): the template, and the upload check. Commit comes in a later task. */
export function mountImportRoutes(app: Hono, db: Db) {
  const perUser = new RateLimiter(10, 60 * 60_000);
  const rejected = (c: Context, message: string) => apiError(c, "VALIDATION_ERROR", message, { file: message });

  app.get("/api/import/template", async (c) =>
    c.body(new Uint8Array(await buildImportTemplate()), 200, {
      "content-type": XLSX_TYPE,
      "content-disposition": `attachment; filename="${IMPORT_TEMPLATE_FILENAME}"`,
      "cache-control": "no-store",
    }),
  );

  app.post("/api/import/validate", async (c) => {
    const user = c.get("user");
    if (!perUser.take(user.id)) return apiError(c, "RATE_LIMITED", "Too many attempts. Try again in a few minutes.");
    // Refuse oversized bodies before reading them; the multipart envelope adds a little to the file itself.
    if (Number(c.req.header("content-length") ?? 0) > IMPORT_MAX_BYTES + 64 * 1024) return rejected(c, TOO_BIG);
    const form = await c.req.parseBody().catch(() => null);
    const file = form?.file;
    if (!(file instanceof File)) return rejected(c, NOT_XLSX);
    const bytes = Buffer.from(await file.arrayBuffer());
    const refusal = rejectUpload(file.name, bytes);
    if (refusal) return rejected(c, refusal);
    const checked = await checkImportFile(bytes, await loadExisting(db));
    if ("rejected" in checked) return rejected(c, checked.rejected);
    const valid = checked.errors.length === 0;
    const [run] = await db
      .insert(importRun)
      .values({ uploadedById: user.id, fileName: file.name.slice(0, 255), file: valid ? bytes : null, status: valid ? "validated" : "failed", counts: checked.counts, errors: checked.errors })
      .returning({ id: importRun.id });
    return c.json({ importRunId: run?.id, errors: checked.errors, counts: checked.counts });
  });
}
