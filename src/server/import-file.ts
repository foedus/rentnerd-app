import ExcelJS from "exceljs";
import { type Cell } from "../shared/import-parse";
import { type ImportExisting } from "../shared/import-links";
import { checkImportSheets, type ImportProblem, type SheetRow, tooManyRows } from "../shared/import-validate";
import { IMPORT_COLUMNS, IMPORT_SHEETS, type ImportSheet } from "../shared/import-template";

export const IMPORT_MAX_BYTES = 5 * 1024 * 1024;
export const IMPORT_MAX_UNCOMPRESSED = 50 * 1024 * 1024;
export const NOT_XLSX = "Choose an .xlsx file.";
export const TOO_BIG = "The file must be 5 MB or smaller.";
export const NOTHING_TO_IMPORT = "The file has no rows to import.";
export const TOO_LARGE = "This file is too large to import.";

/** Total uncompressed size declared in the zip's central directory, or null when the bytes are not a zip. */
export function declaredUncompressedSize(buf: Buffer): number | null {
  const min = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) !== 0x06054b50) continue;
    const entries = buf.readUInt16LE(i + 10);
    let pos = buf.readUInt32LE(i + 16);
    let total = 0;
    for (let n = 0; n < entries; n++) {
      if (pos + 46 > buf.length || buf.readUInt32LE(pos) !== 0x02014b50) return null;
      total += buf.readUInt32LE(pos + 24);
      pos += 46 + buf.readUInt16LE(pos + 28) + buf.readUInt16LE(pos + 30) + buf.readUInt16LE(pos + 32);
    }
    return total;
  }
  return null;
}

/** Rejects files before any parsing (§11.22). Returns the message to show, or null when the file may be parsed. */
export function rejectUpload(name: string, buf: Buffer): string | null {
  if (!name.toLowerCase().endsWith(".xlsx")) return NOT_XLSX;
  if (buf.length > IMPORT_MAX_BYTES) return TOO_BIG;
  const size = declaredUncompressedSize(buf);
  if (size === null) return NOT_XLSX;
  return size > IMPORT_MAX_UNCOMPRESSED ? TOO_LARGE : null;
}

/** Flattens exceljs cell values (formulas, rich text, links) to plain text, numbers or dates; blank is null. */
export function plainCell(v: ExcelJS.CellValue): Cell {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v.trim() === "" ? null : v.trim();
  if (typeof v === "number" || typeof v === "boolean" || v instanceof Date) return v;
  if ("result" in v) return plainCell(v.result as ExcelJS.CellValue);
  if ("richText" in v) return plainCell(v.richText.map((r) => r.text).join(""));
  if ("text" in v) return plainCell(typeof v.text === "string" ? v.text : (v.text as { richText: { text: string }[] }).richText.map((r) => r.text).join(""));
  return null;
}

export type FileCheck = { errors: ImportProblem[]; counts: Record<string, number> } | { rejected: string };

/** Reads the workbook and checks every row. Heading row is row 1 (the template); data rows start at 2. */
export async function checkImportFile(buf: Buffer, existing?: ImportExisting): Promise<FileCheck> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
  } catch {
    return { rejected: NOT_XLSX };
  }
  const sheets: Partial<Record<ImportSheet, { missing: string[]; rows: SheetRow[] }>> = {};
  for (const name of IMPORT_SHEETS) {
    const ws = wb.getWorksheet(name);
    if (!ws) continue;
    if (tooManyRows(ws.rowCount)) return { rejected: TOO_LARGE };
    const columns = new Map<string, number>();
    ws.getRow(1).eachCell((c, col) => columns.set(String(plainCell(c.value) ?? ""), col));
    const missing = IMPORT_COLUMNS[name].map((c) => c.header).filter((h) => !columns.has(h));
    const rows: SheetRow[] = [];
    for (let r = 2; r <= ws.rowCount; r++) {
      const cells = new Map<string, Cell>();
      for (const [header, col] of columns) cells.set(header, plainCell(ws.getRow(r).getCell(col).value));
      if ([...cells.values()].some((v) => v !== null)) rows.push({ row: r, cells });
    }
    sheets[name] = { missing, rows };
  }
  const checked = checkImportSheets(sheets, existing);
  const empty = checked.errors.length === 0 && Object.values(checked.counts).every((n) => n === 0);
  return empty ? { rejected: NOTHING_TO_IMPORT } : checked;
}
