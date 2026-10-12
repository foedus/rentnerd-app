/**
 * Import spreadsheets for the IMP criteria, built from the app's own
 * downloadable template (GET /api/import/template): rows are written under
 * the column headings (field labels, SPEC.md §11.22), wherever they are.
 */
import ExcelJS from 'exceljs';
import type { Api } from './api';

export type Rows = Partial<Record<'Owners' | 'Properties' | 'Units' | 'Tenants' | 'Leases', Record<string, string | number>[]>>;

const KEY_HEADER: Record<string, string> = { Owners: 'Owner key', Properties: 'Property key', Units: 'Unit key', Tenants: 'Tenant key', Leases: 'Unit key' };

export async function downloadTemplate(api: Api): Promise<Buffer> {
  const res = await api.ctx.get('/api/import/template');
  if (res.status() !== 200) throw new Error(`GET /api/import/template -> ${res.status()}`);
  return Buffer.from(await res.body());
}

function headerRow(ws: ExcelJS.Worksheet, key: string): { row: number; cols: Map<string, number> } {
  for (let r = 1; r <= Math.min(ws.rowCount, 10); r++) {
    const cols = new Map<string, number>();
    ws.getRow(r).eachCell((c, col) => cols.set(String(c.text ?? c.value).trim(), col));
    if (cols.has(key)) return { row: r, cols };
  }
  throw new Error(`Sheet ${ws.name} has no "${key}" heading`);
}

/** Fills the template; returns the buffer and, per sheet, the Excel row numbers written. */
export async function buildImport(template: Buffer, rows: Rows): Promise<{ buffer: Buffer; rowNumbers: Record<string, number[]> }> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(template as unknown as ArrayBuffer);
  const rowNumbers: Record<string, number[]> = {};
  for (const [sheet, list] of Object.entries(rows)) {
    const ws = wb.getWorksheet(sheet);
    if (!ws) throw new Error(`Template has no sheet ${sheet}`);
    const { row: header, cols } = headerRow(ws, KEY_HEADER[sheet]);
    let r = header + 1;
    while (ws.getRow(r).hasValues) r++;
    rowNumbers[sheet] = [];
    for (const values of list ?? []) {
      const row = ws.getRow(r);
      for (const [heading, v] of Object.entries(values)) {
        const col = cols.get(heading);
        if (!col) throw new Error(`Sheet ${sheet} has no "${heading}" column; columns: ${[...cols.keys()].join(', ')}`);
        row.getCell(col).value = v;
      }
      row.commit();
      rowNumbers[sheet].push(r);
      r++;
    }
  }
  return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), rowNumbers };
}

export async function sheetNames(buf: Buffer): Promise<string[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  return wb.worksheets.map((w) => w.name);
}

/** A valid portfolio: 1 owner, 1 NYC property, 2 residential units, 2 tenants, 1 lease. */
export function validRows(tag: string): Rows {
  return {
    Owners: [{ 'Owner key': 'O1', 'Owner name': `Imported Owner ${tag} LLC`, 'Owner type': 'LLC', 'Mailing address line 1': '5 Import Way', City: 'Brooklyn', State: 'NY', 'ZIP code': '11201' }],
    Properties: [{
      'Property key': 'P1', 'Owner key': 'O1', 'Property name': `Imported House ${tag}`, 'Street address': '77 Import Street', City: 'Brooklyn', State: 'NY', 'ZIP code': '11201', 'Located in New York City': 'Yes',
    }],
    Units: [
      { 'Unit key': 'U1', 'Property key': 'P1', 'Unit label': '1R', Use: 'Residential' },
      { 'Unit key': 'U2', 'Property key': 'P1', 'Unit label': '2R', Use: 'Residential' },
    ],
    Tenants: [
      { 'Tenant key': 'T1', 'Tenant type': 'Individual', 'First name': 'Imogen', 'Last name': `Port${tag}` },
      { 'Tenant key': 'T2', 'Tenant type': 'Individual', 'First name': 'Ivan', 'Last name': `Port${tag}` },
    ],
    Leases: [{
      'Unit key': 'U1', 'Tenant 1 key': 'T1', 'Tenant 2 key': 'T2', 'Lease start date': '2026-01-01', 'Lease end date': '2026-12-31', 'Monthly rent': '2,150.00',
      'Rent increases': 'None', 'Children reside in unit': 'No',
    }],
  };
}
