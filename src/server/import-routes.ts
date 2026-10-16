import ExcelJS from "exceljs";
import type { Hono } from "hono";
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

/** Import (§14.2). The upload, check and commit routes come in later tasks. */
export function mountImportRoutes(app: Hono) {
  app.get("/api/import/template", async (c) =>
    c.body(new Uint8Array(await buildImportTemplate()), 200, {
      "content-type": XLSX_TYPE,
      "content-disposition": `attachment; filename="${IMPORT_TEMPLATE_FILENAME}"`,
      "cache-control": "no-store",
    }),
  );
}
