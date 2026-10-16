import { describe, expect, it } from "vitest";
import { centsInWords, formatLongDate, ordinal } from "./format";
import { PLACEHOLDERS } from "./placeholders";
import { BLANK, escapeHtml, renderTemplate } from "./template-render";
import { buildPlaceholderValues, formatPercent, joinNames, type SourceTenant, type TemplateSource } from "./template-values";

const jordan: SourceTenant = { id: "t1", name: "Jordan Sample", email: "jordan@example.com", phone: "555-0100", isPrimary: true };
const casey: SourceTenant = { id: "t2", name: "Casey Sample", email: null, phone: null, isPrimary: false };
const cy: SourceTenant = { id: "t3", name: "Cy Added", email: null, phone: null, isPrimary: false };

const source = (over: Partial<TemplateSource> = {}): TemplateSource => ({
  today: "2027-01-05",
  owner: { name: "Sample Holdings LLC", address: "100 Example Ave, Brooklyn, NY 11201", signatoryName: "Alex Owner", signatoryTitle: "Managing Member" },
  propertyAddress: "100 Example Ave, Brooklyn, NY 11201",
  unitLabel: "2R",
  unitUse: "Residential",
  tenants: [jordan, casey],
  masterStartDate: "2027-01-01",
  masterEndDate: "2027-12-31",
  terms: {
    rent: { startDate: "2027-01-01", endDate: "2027-12-31", rentCents: 250000, increaseType: "percent", increasePercent: "3.0000" },
    securityDepositCents: 250000, rentDueDay: 1, lateFeeCents: 5000, lateFeeGraceDays: 5, pets: "One cat", parking: "Space #4",
    parkingChargeCents: 15000, childrenReside: false, breakClause: "None", otherTerms: "Line one\nLine two", baseTaxYear: 2024, taxSharePercent: "25.0000",
  },
  ...over,
});
const p = (...content: unknown[]) => ({ type: "paragraph", content });
const doc = (...content: unknown[]) => ({ type: "doc", content });
const chip = (key: string) => ({ type: "placeholder", attrs: { key, label: key } });
const text = (t: string, marks?: string[]) => ({ type: "text", text: t, ...(marks ? { marks: marks.map((type) => ({ type })) } : {}) });

describe("format helpers", () => {
  it("formats long dates and ordinals", () => {
    expect(formatLongDate("2027-01-05")).toBe("January 5, 2027");
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 28].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "28th"]);
  });
  it("writes rent in words", () => {
    expect(centsInWords(215000)).toBe("Two thousand one hundred fifty dollars and 00/100");
    expect(centsInWords(250005)).toBe("Two thousand five hundred dollars and 05/100");
    expect(centsInWords(2100)).toBe("Twenty-one dollars and 00/100");
    expect(centsInWords(100)).toBe("One dollar and 00/100");
    expect(centsInWords(50)).toBe("Zero dollars and 50/100");
    expect(centsInWords(100000000)).toBe("One million dollars and 00/100");
  });
  it("joins names and trims percentages", () => {
    expect(joinNames([])).toBe("");
    expect(joinNames(["A"])).toBe("A");
    expect(joinNames(["A", "B"])).toBe("A and B");
    expect(joinNames(["A", "B", "C"])).toBe("A, B and C");
    expect([formatPercent("3.0000"), formatPercent("2.5000"), formatPercent("10"), formatPercent("0.0500")]).toEqual(["3%", "2.5%", "10%", "0.05%"]);
  });
});

describe("buildPlaceholderValues", () => {
  it("fills every master lease key from Appendix B data", () => {
    const v = buildPlaceholderValues(source());
    expect(v).toMatchObject({
      today: "January 5, 2027", owner_name: "Sample Holdings LLC", owner_signatory: "Alex Owner, Managing Member", unit_use: "Residential",
      tenant_names: "Jordan Sample and Casey Sample", primary_tenant_name: "Jordan Sample", primary_tenant_email: "jordan@example.com", primary_tenant_phone: "555-0100",
      lease_start_date: "January 1, 2027", lease_end_date: "December 31, 2027", lease_term_months: "12", monthly_rent: "$2,500.00",
      monthly_rent_words: "Two thousand five hundred dollars and 00/100", annual_increase_percent: "3%", security_deposit: "$2,500.00", rent_due_day: "1st",
      late_fee: "$50.00", late_fee_grace_days: "5 days", pets: "One cat", parking: "Space #4", parking_charge: "$150.00", children_reside: "No",
      break_clause: "None", other_terms: "Line one\nLine two", base_tax_year: "2024", tax_share_percent: "25%",
    });
    expect(v.tenant_signature_blocks).toEqual({ signatures: ["Jordan Sample", "Casey Sample"] });
    expect(v.rent_schedule).toEqual({
      table: { head: ["Period start", "Period end", "Monthly rent"], rows: [["January 1, 2027", "December 31, 2027", "$2,500.00"]] },
    });
    expect("extension_start_date" in v).toBe(false);
    for (const ph of PLACEHOLDERS.filter((x) => !x.extensionOnly)) expect(v, ph.key).toHaveProperty(ph.key);
  });

  it("leaves missing values empty", () => {
    const v = buildPlaceholderValues(source({
      owner: { name: null, address: null, signatoryName: "Alex", signatoryTitle: null }, propertyAddress: null, tenants: [],
      terms: { ...source().terms, rent: { startDate: "2027-01-01", endDate: "2027-12-31", rentCents: 100, increaseType: "none" }, securityDepositCents: null, rentDueDay: null, lateFeeCents: null, lateFeeGraceDays: null, pets: " ", parkingChargeCents: null, childrenReside: null, baseTaxYear: null, taxSharePercent: null },
    }));
    expect(v).toMatchObject({ owner_name: "", owner_signatory: "Alex", property_address: "", tenant_names: "", primary_tenant_name: "", annual_increase_percent: "", security_deposit: "", rent_due_day: "", late_fee: "", late_fee_grace_days: "", pets: "", parking_charge: "", children_reside: "", base_tax_year: "", tax_share_percent: "" });
  });

  it("uses singular day and the schedule's yearly rows", () => {
    const v = buildPlaceholderValues(source({ terms: { ...source().terms, lateFeeGraceDays: 1, rent: { startDate: "2027-01-01", endDate: "2028-06-30", rentCents: 100000, increaseType: "percent", increasePercent: "10" } } }));
    expect(v.late_fee_grace_days).toBe("1 day");
    expect(v.rent_schedule).toMatchObject({ table: { rows: [["January 1, 2027", "December 31, 2027", "$1,000.00"], ["January 1, 2028", "June 30, 2028", "$1,100.00"]] } });
    expect(v.lease_term_months).toBe("18");
  });

  it("builds extension keys from the extension's own term and tenants", () => {
    const v = buildPlaceholderValues(source({
      tenants: [jordan, cy],
      terms: { ...source().terms, rent: { startDate: "2028-01-01", endDate: "2028-12-31", rentCents: 260000, increaseType: "none" } },
      extension: { previousEndDate: "2027-12-31", previousRentCents: 257500, previousTenants: [jordan, casey] },
    }));
    expect(v).toMatchObject({
      previous_end_date: "December 31, 2027", previous_monthly_rent: "$2,575.00", extension_start_date: "January 1, 2028", extension_end_date: "December 31, 2028",
      extension_monthly_rent: "$2,600.00", monthly_rent: "$2,600.00", lease_start_date: "January 1, 2027", lease_end_date: "December 31, 2027", lease_term_months: "12",
      tenant_names: "Jordan Sample and Cy Added", previous_tenant_names: "Jordan Sample and Casey Sample", removed_tenant_names: "Casey Sample", added_tenant_names: "Cy Added",
    });
    expect(v.extension_rent_schedule).toEqual(v.rent_schedule);
    const same = buildPlaceholderValues(source({ extension: { previousEndDate: "2027-12-31", previousRentCents: 1, previousTenants: [jordan, casey] } }));
    expect(same).toMatchObject({ removed_tenant_names: "None", added_tenant_names: "None" });
  });
});

describe("renderTemplate", () => {
  const values = buildPlaceholderValues(source());

  it("renders chips and typed keys inline with formatting", () => {
    const r = renderTemplate(doc(p(text("Rent "), chip("monthly_rent"), text(" for "), text("{{tenant_names}}", ["bold"]), text(" on {{ today }}."))), values);
    expect(r.html).toBe("<p>Rent $2,500.00 for <strong>Jordan Sample and Casey Sample</strong> on January 5, 2027.</p>");
    expect(r.blanks).toEqual([]);
  });

  it("prints missing values as ten underscores and lists them once", () => {
    const r = renderTemplate(doc(p(chip("pets"), text(" {{pets}} {{parking}}")), p(chip("previous_end_date"))), { ...values, pets: "", parking: undefined });
    expect(BLANK).toHaveLength(10);
    expect(r.html).toBe(`<p>${BLANK} ${BLANK} ${BLANK}</p><p>${BLANK}</p>`);
    expect(r.blanks).toEqual(["Pets", "Parking", "Previous end date"]);
  });

  it("keeps unknown keys as escaped text", () => {
    expect(renderTemplate(doc(p(text("{{nope}} <b>"))), values).html).toBe("<p>{{nope}} &lt;b&gt;</p>");
  });

  it("escapes values and keeps line breaks", () => {
    const r = renderTemplate(doc(p(chip("other_terms")), p(chip("pets"))), { ...values, pets: "<script>alert(1)</script> & \"x\"" });
    expect(r.html).toBe("<p>Line one<br>Line two</p><p>&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;x&quot;</p>");
    expect(escapeHtml(`'`)).toBe("&#39;");
  });

  it("renders the rent schedule table and signature blocks as blocks, splitting the paragraph", () => {
    const r = renderTemplate(doc(p(text("Before "), chip("rent_schedule"), text(" after")), p(chip("tenant_signature_blocks"))), values);
    expect(r.html).toBe(
      '<p>Before </p><table class="rn-table"><thead><tr><th>Period start</th><th>Period end</th><th>Monthly rent</th></tr></thead><tbody><tr><td>January 1, 2027</td><td>December 31, 2027</td><td>$2,500.00</td></tr></tbody></table><p> after</p>' +
        `<p class="rn-signature">______________________________ Date: ${BLANK}<br>Jordan Sample</p><p class="rn-signature">______________________________ Date: ${BLANK}<br>Casey Sample</p>`,
    );
  });

  it("prints a blank for empty block values", () => {
    const r = renderTemplate(doc(p(chip("tenant_signature_blocks"))), { tenant_signature_blocks: { signatures: [] } });
    expect(r.html).toBe(`<p>${BLANK}</p>`);
    expect(r.blanks).toEqual(["Tenant signature blocks"]);
  });

  it("renders headings, alignment, lists, tables and page breaks", () => {
    const r = renderTemplate(
      doc(
        { type: "heading", attrs: { level: 1, textAlign: "center" }, content: [text("Lease")] },
        { type: "heading", attrs: { level: 2 }, content: [text("Terms", ["italic", "underline"])] },
        { type: "paragraph", attrs: { textAlign: "center" }, content: [text("a"), { type: "hardBreak" }, text("b")] },
        { type: "orderedList", attrs: { start: 3 }, content: [{ type: "listItem", content: [p(text("one")), { type: "bulletList", content: [{ type: "listItem", content: [p(text("nested"))] }] }] }] },
        { type: "table", content: [{ type: "tableRow", content: [{ type: "tableHeader", content: [p(text("H"))] }, { type: "tableCell", content: [p()] }] }] },
        { type: "pageBreak" },
        p(),
      ),
      values,
    );
    expect(r.html).toBe(
      '<h1 class="rn-center">Lease</h1><h2><u><em>Terms</em></u></h2><p class="rn-center">a<br>b</p>' +
        '<ol start="3"><li><p>one</p><ul><li><p>nested</p></li></ul></li></ol>' +
        '<table class="rn-table"><tbody><tr><th><p>H</p></th><td><p><br></p></td></tr></tbody></table><div class="rn-page-break"></div><p><br></p>',
    );
  });

  it("drops anything outside the allowed content", () => {
    const hostile = doc(
      { type: "image", attrs: { src: "http://evil.example/x.png" } },
      { type: "paragraph", attrs: { style: "x" }, content: [{ type: "text", text: "ok", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }, { type: "textStyle", attrs: { color: "red" } }] }] },
      { type: "heading", attrs: { level: 9 }, content: [text("h")] },
      { type: "orderedList", attrs: { start: '"><script>' }, content: [{ type: "listItem", content: [p(text("x"))] }, { type: "script" }] },
    );
    const { html } = renderTemplate(hostile, values);
    expect(html).toBe("<p>ok</p><h1>h</h1><ol><li><p>x</p></li></ol>");
    expect(renderTemplate("nope", values)).toEqual({ html: "", blanks: [] });
    expect(renderTemplate(null, values).html).toBe("");
  });

  it("renders every Appendix B key without blanks (master and extension)", () => {
    const ext = buildPlaceholderValues(source({ extension: { previousEndDate: "2027-12-31", previousRentCents: 257500, previousTenants: [jordan] } }));
    const all = doc(...PLACEHOLDERS.map((ph) => p(chip(ph.key))));
    const r = renderTemplate(all, ext);
    expect(r.blanks).toEqual([]);
    expect(r.html).not.toMatch(/<p>_+<\/p>/);
  });
});

describe("centsInWords large amounts", () => {
  it("handles thousands and millions", () => {
    expect(centsInWords(123456700)).toBe("One million two hundred thirty-four thousand five hundred sixty-seven dollars and 00/100");
  });
});
