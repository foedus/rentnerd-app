import type { z } from "zod";
import { type Cell, IMPORT_FIELDS, parseCell } from "./import-parse";
import { IMPORT_SHEETS, type ImportSheet } from "./import-template";
import { createOwnerSchema, createPropertySchema, createTenantSchema, createUnitSchema, leaseFieldsSchema } from "./schemas";

export interface ImportProblem {
  sheet: string;
  row: number | null;
  column: string | null;
  problem: string;
}
export type SheetRow = { row: number; cells: ReadonlyMap<string, Cell> };
export const IMPORT_MAX_ROWS = 5000;

const SCHEMAS: Record<ImportSheet, z.ZodType> = {
  Owners: createOwnerSchema,
  Properties: createPropertySchema.omit({ ownerId: true, responsibleUserIds: true }),
  Units: createUnitSchema.omit({ ownerOverrideId: true }),
  Tenants: createTenantSchema,
  Leases: leaseFieldsSchema.omit({ unitId: true, tenants: true }),
};
const REQUIRED_KEYS: Record<ImportSheet, readonly string[]> = {
  Owners: ["Owner key"], Properties: ["Property key", "Owner key"], Units: ["Unit key", "Property key"], Tenants: ["Tenant key"], Leases: ["Unit key", "Tenant 1 key"],
};

/** Checks one row's cells against the field formats and the shared §6 schema; returns the problems found (§11.22). */
export function checkImportRow(sheet: ImportSheet, { row, cells }: SheetRow): ImportProblem[] {
  const fields = IMPORT_FIELDS[sheet];
  const problems: ImportProblem[] = [];
  const add = (column: string | null, problem: string) => problems.push({ sheet, row, column, problem });
  const values: Record<string, unknown> = {};
  const headerOf = new Map<string, string>();
  const bad = new Set<string>();
  for (const [header, spec] of Object.entries(fields)) {
    headerOf.set(spec.field, header);
    const cell = cells.get(header) ?? null;
    if (cell === null) continue;
    const parsed = parseCell(spec.type, cell);
    if (parsed.ok) values[spec.field] = parsed.value;
    else {
      bad.add(spec.field);
      add(header, parsed.message);
    }
  }
  for (const header of REQUIRED_KEYS[sheet]) if (cells.get(header) == null) add(header, `Enter the ${header}.`);

  const result = SCHEMAS[sheet].safeParse(values);
  if (!result.success) {
    const seen = new Set<string>();
    for (const issue of result.error.issues) {
      const field = String(issue.path[0] ?? "");
      if (bad.has(field) || seen.has(field)) continue;
      seen.add(field);
      add(headerOf.get(field) ?? null, issue.message);
    }
  }
  return problems;
}

/** Row cap per sheet (§11.22); the data starts below the heading row. */
export const tooManyRows = (rowCount: number) => rowCount - 1 > IMPORT_MAX_ROWS;

/** Everything the "Ready to import" summary and the problems table need from the parsed sheets. */
export function checkImportSheets(sheets: Partial<Record<ImportSheet, { missing?: string[]; rows: SheetRow[] }>>): { errors: ImportProblem[]; counts: Record<string, number> } {
  const errors: ImportProblem[] = [];
  const counts: Record<string, number> = {};
  for (const sheet of IMPORT_SHEETS) {
    const data = sheets[sheet];
    if (!data) {
      errors.push({ sheet, row: null, column: null, problem: `The workbook has no sheet named ${sheet}. Use the template.` });
      continue;
    }
    for (const column of data.missing ?? []) errors.push({ sheet, row: 1, column, problem: `The column ${column} is missing. Use the template.` });
    if (data.missing?.length) continue;
    counts[sheet] = data.rows.length;
    for (const r of data.rows) errors.push(...checkImportRow(sheet, r));
  }
  return { errors, counts };
}
