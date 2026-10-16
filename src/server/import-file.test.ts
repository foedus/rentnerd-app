import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { buildImportTemplate } from "./import-routes";
import { checkImportFile, declaredUncompressedSize, plainCell, rejectUpload } from "./import-file";

async function filled(edit: (wb: ExcelJS.Workbook) => void): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await buildImportTemplate()) as unknown as ArrayBuffer);
  edit(wb);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
const put = (wb: ExcelJS.Workbook, sheet: string, row: number, values: Record<string, ExcelJS.CellValue>) => {
  const ws = wb.getWorksheet(sheet) as ExcelJS.Worksheet;
  const cols = new Map<string, number>();
  ws.getRow(1).eachCell((c, i) => cols.set(String(c.value), i));
  for (const [h, v] of Object.entries(values)) ws.getRow(row).getCell(cols.get(h) as number).value = v;
};

describe("rejectUpload", () => {
  it("wants an .xlsx name", () => {
    expect(rejectUpload("notes.txt", Buffer.from("x"))).toBe("Choose an .xlsx file.");
  });
  it("wants a real zip even when named .xlsx", () => {
    expect(rejectUpload("a.xlsx", Buffer.from("not a zip at all, sorry"))).toBe("Choose an .xlsx file.");
  });
  it("refuses more than 5 MB before looking inside", () => {
    expect(rejectUpload("huge.xlsx", Buffer.alloc(5 * 1024 * 1024 + 1, 65))).toBe("The file must be 5 MB or smaller.");
  });
  it("accepts the template", async () => {
    expect(rejectUpload("RentNerd.XLSX", await buildImportTemplate())).toBeNull();
  });
  it("refuses more than 50 MB declared uncompressed", async () => {
    const zip = await buildImportTemplate();
    const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    const first = zip.readUInt32LE(eocd + 16);
    zip.writeUInt32LE(51 * 1024 * 1024, first + 24);
    expect(declaredUncompressedSize(zip)).toBeGreaterThan(50 * 1024 * 1024);
    expect(rejectUpload("zip-bomb.xlsx", zip)).toBe("This file is too large to import.");
  });
});

describe("plainCell", () => {
  it("flattens text, rich text, links, formulas and blanks", () => {
    expect(plainCell("  hi ")).toBe("hi");
    expect(plainCell("   ")).toBeNull();
    expect(plainCell(null)).toBeNull();
    expect(plainCell({ richText: [{ text: "a" }, { text: "b" }] })).toBe("ab");
    expect(plainCell({ text: "x@y.com", hyperlink: "mailto:x@y.com" })).toBe("x@y.com");
    expect(plainCell({ formula: "1+1", result: 2 })).toBe(2);
    expect(plainCell(5)).toBe(5);
  });
});

describe("checkImportFile", () => {
  it("rejects a workbook with no rows at all", async () => {
    expect(await checkImportFile(await buildImportTemplate())).toEqual({ rejected: "The file has no rows to import." });
  });

  it("counts the rows of a valid workbook", async () => {
    const buf = await filled((wb) => {
      put(wb, "Owners", 2, { "Owner key": "O1", "Owner name": "A LLC", "Owner type": "LLC", "Mailing address line 1": "1 St", City: "NYC", State: "NY", "ZIP code": 10001 });
      put(wb, "Tenants", 2, { "Tenant key": "T1", "Tenant type": "Individual", "First name": "A", "Last name": "B" });
      put(wb, "Tenants", 4, { "Tenant key": "T2", "Tenant type": "Individual", "First name": "C", "Last name": "D" });
    });
    expect(await checkImportFile(buf)).toEqual({ errors: [], counts: { Owners: 1, Properties: 0, Units: 0, Tenants: 2, Leases: 0 } });
  });

  it("reports problems with the sheet row, skipping blank rows", async () => {
    const buf = await filled((wb) => put(wb, "Tenants", 3, { "Tenant key": "T1", "Tenant type": "Individual", "First name": "A", "Last name": "B", Email: "bad" }));
    const out = await checkImportFile(buf);
    expect(out).toMatchObject({ errors: [{ sheet: "Tenants", row: 3, column: "Email", problem: "Enter a valid email address." }] });
  });

  it("reports a missing sheet", async () => {
    const buf = await filled((wb) => wb.removeWorksheet(wb.getWorksheet("Leases")?.id as number));
    expect(await checkImportFile(buf)).toMatchObject({ errors: [{ sheet: "Leases", row: null, column: null }] });
  });

  it("rejects a sheet with more than 5,000 rows", async () => {
    const buf = await filled((wb) => put(wb, "Tenants", 5002, { "Tenant key": "T" }));
    expect(await checkImportFile(buf)).toEqual({ rejected: "This file is too large to import." });
  });

  it("rejects bytes that only look like a zip", async () => {
    const buf = (await buildImportTemplate()).subarray(0, 300);
    expect(await checkImportFile(Buffer.concat([buf, Buffer.alloc(30)]))).toEqual({ rejected: "Choose an .xlsx file." });
  });
});
