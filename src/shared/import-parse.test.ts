import { describe, expect, it } from "vitest";
import { type FieldKind, IMPORT_FIELDS, parseCell } from "./import-parse";
import { IMPORT_COLUMNS, IMPORT_SHEETS } from "./import-template";

const p = (kind: FieldKind["kind"], cell: Parameters<typeof parseCell>[1]) => parseCell({ kind } as FieldKind, cell);

describe("IMPORT_FIELDS", () => {
  it.each(IMPORT_SHEETS)("covers exactly the template columns of %s", (sheet) => {
    expect(Object.keys(IMPORT_FIELDS[sheet])).toEqual(IMPORT_COLUMNS[sheet].map((c) => c.header));
  });
});

describe("parseCell", () => {
  it("reads real Excel dates and YYYY-MM-DD text", () => {
    expect(p("date", new Date(Date.UTC(2026, 0, 31)))).toEqual({ ok: true, value: "2026-01-31" });
    expect(p("date", "2026-02-28")).toEqual({ ok: true, value: "2026-02-28" });
    expect(p("date", "2026-02-30")).toEqual({ ok: false, message: "Enter a valid date." });
    expect(p("date", "1/31/2026")).toEqual({ ok: false, message: "Enter a valid date." });
    expect(p("date", 46000)).toEqual({ ok: false, message: "Enter a valid date." });
  });

  it("reads money as numbers or text, in cents", () => {
    expect(p("money", 2150)).toEqual({ ok: true, value: 215000 });
    expect(p("money", 19.99)).toEqual({ ok: true, value: 1999 });
    expect(p("money", "2,150.00")).toEqual({ ok: true, value: 215000 });
    expect(p("money", "$75")).toEqual({ ok: true, value: 7500 });
    expect(p("money", 1.005)).toEqual({ ok: false, message: "Enter an amount in whole cents." });
    expect(p("money", "lots")).toEqual({ ok: false, message: "Enter an amount." });
  });

  it("reads numbers and whole numbers", () => {
    expect(p("number", 3)).toEqual({ ok: true, value: 3 });
    expect(p("number", "2.5")).toEqual({ ok: true, value: 2.5 });
    expect(p("number", "3%")).toEqual({ ok: false, message: "Enter a number." });
    expect(p("int", 4)).toEqual({ ok: true, value: 4 });
    expect(p("int", "1990")).toEqual({ ok: true, value: 1990 });
    expect(p("int", 1.5)).toEqual({ ok: false, message: "Enter a whole number." });
  });

  it("reads Yes and No in any case, nothing else", () => {
    expect(p("yesno", "Yes")).toEqual({ ok: true, value: true });
    expect(p("yesno", " no ")).toEqual({ ok: true, value: false });
    expect(p("yesno", "Maybe")).toEqual({ ok: false, message: "Choose Yes or No." });
    expect(p("yesno", true)).toEqual({ ok: false, message: "Choose Yes or No." });
  });

  it("maps enum labels to their codes", () => {
    const type: FieldKind = { kind: "enum", message: "Choose how rent increases.", choices: [["None", "none"], ["Percent", "percent"]] };
    expect(parseCell(type, "percent")).toEqual({ ok: true, value: "percent" });
    expect(parseCell(type, "Schedule")).toEqual({ ok: false, message: "Choose how rent increases." });
  });

  it("keeps ZIP codes as text, restoring leading zeros lost by Excel", () => {
    expect(p("zip", 2134)).toEqual({ ok: true, value: "02134" });
    expect(p("zip", " 11201 ")).toEqual({ ok: true, value: "11201" });
  });

  it("splits landlord emails on semicolons", () => {
    expect(p("emails", "a@x.com; b@x.com;")).toEqual({ ok: true, value: ["a@x.com", "b@x.com"] });
  });
});
