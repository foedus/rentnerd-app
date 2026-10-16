// @vitest-environment happy-dom
import { QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { queryClient } from "../App";
import { LeaseDetail } from "./LeaseDetail";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => vi.unstubAllGlobals());

const json = (v: unknown, status = 200) => Response.json(v, { status });
const person = (name: string, isPrimary: boolean) => ({ tenantId: name, isPrimary, displayName: name, email: `${name}@x.com`, phone: null });
const lease = {
  id: "l1", statusLabel: "Upcoming", propertyName: "Court Plaza", unitLabel: "2R", unitUse: "Residential",
  startDate: "2026-11-01", endDate: "2027-10-31", effectiveEndDate: "2027-10-31", currentRentCents: 215000,
  current: {
    tenants: [person("Ann Lee", false), person("Bo Diaz", true)], securityDepositCents: null, rentDueDay: 1, lateFeeCents: 5000, lateFeeGraceDays: 5,
    pets: "One cat", parking: null, parkingChargeCents: null, childrenReside: false, breakClause: null, otherTerms: null,
    baseTaxYear: null, taxSharePercent: null, taxReimbursementCents: null, taxReimbursementExplanation: null,
  },
  rentSchedule: [{ periodStart: "2026-11-01", periodEnd: "2027-10-31", rentCents: 215000, term: "Master lease" }],
};

const versions = [
  { versionNumber: 2, changedAt: "2026-10-16T15:00:00.000Z", changedByName: "Ann Admin", summary: "Monthly rent: $2,150.00 → $2,200.00" },
  { versionNumber: 1, changedAt: "2026-10-15T15:00:00.000Z", changedByName: null, summary: "Lease created" },
];

async function mount(response: Response, role = "admin") {
  vi.stubGlobal("fetch", async (url: string) => {
    if (url === "/api/me") return json({ id: "u", name: "Ann", email: "a@x.com", role, status: "active" });
    if (url.endsWith("/versions")) return json({ data: versions, page: 1, pageSize: 2, total: 2 });
    return response.clone();
  });
  queryClient.clear();
  document.body.innerHTML = '<div id="root"></div>';
  const root = createRoot(document.getElementById("root") as HTMLElement);
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/leases/l1"]}>
          <Routes>
            <Route path="/leases/:id" element={<LeaseDetail />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await act(async () => void (await new Promise((r) => setTimeout(r, 100))));
}
const section = (name: string) => Array.from(document.querySelectorAll("section")).find((s) => s.querySelector("h2")?.textContent === name);
const rowOf = (text: string) => Array.from(document.querySelectorAll("tr")).find((r) => r.textContent?.includes(text));

it("shows the heading, status, tenants with the primary contact marker, term and schedule", async () => {
  await mount(json(lease));
  expect(document.querySelector("h1")?.textContent).toBe("Lease – Court Plaza Unit 2R");
  expect(document.body.textContent).toContain("Upcoming");
  expect(rowOf("Bo Diaz")?.textContent).toContain("Primary contact");
  expect(rowOf("Ann Lee")?.textContent).not.toContain("Primary contact");
  const term = section("Term and rent")?.textContent ?? "";
  for (const s of ["Effective end dateOct 31, 2027", "Current monthly rent$2,150.00", "Security deposit–", "Late fee$50.00", "Late fee grace period5 days"]) expect(term).toContain(s);
  expect(section("Term and rent")?.querySelector('table[aria-label="Rent schedule"]')?.textContent).toContain("$2,150.00");
});

it("a Residential lease shows children and no tax lines", async () => {
  await mount(json(lease));
  expect(section("Special terms")?.textContent).toContain("Children reside in unitNo");
  expect(section("Special terms")?.textContent).not.toContain("Base tax year");
  expect(section("Other income")?.textContent).not.toContain("Tax reimbursement");
});

it("a Commercial lease shows the tax reimbursement with its explanation", async () => {
  const explanation = "25% × (2025 tax $52,000.00 − 2020 tax $40,000.00) ÷ 12";
  await mount(json({ ...lease, unitUse: "Commercial", current: { ...lease.current, childrenReside: null, baseTaxYear: 2020, taxSharePercent: 25, taxReimbursementCents: 25000, taxReimbursementExplanation: explanation } }));
  const other = section("Other income")?.textContent ?? "";
  expect(other).toContain("Tax reimbursement (monthly)$250.00");
  expect(other).toContain(explanation);
  expect(section("Special terms")?.textContent).toContain("Tenant's share of tax increase (%)25");
  expect(section("Special terms")?.textContent).not.toContain("Children reside");
});

it("shows $0.00 when the latest tax is lower", async () => {
  await mount(json({ ...lease, unitUse: "Commercial", current: { ...lease.current, taxReimbursementCents: 0, taxReimbursementExplanation: "25% × (2025 tax $30,000.00 − 2020 tax $40,000.00) ÷ 12" } }));
  expect(section("Other income")?.textContent).toContain("Tax reimbursement (monthly)$0.00");
});

it("an unknown lease shows the message", async () => {
  await mount(json({ error: { message: "Lease not found." } }, 404));
  expect(document.querySelector('[role="alert"]')?.textContent).toBe("Lease not found.");
});

it("says 1 day (not 1 days) and keeps line breaks in special terms", async () => {
  await mount(json({ ...lease, current: { ...lease.current, lateFeeGraceDays: 1, otherTerms: "Line1\nLine2" } }));
  expect(section("Term and rent")?.textContent).toContain("Late fee grace period1 day");
  expect(section("Term and rent")?.textContent).not.toContain("1 days");
  expect(section("Special terms")?.querySelector("dd.whitespace-pre-line")).toBeTruthy();
});

it("lists the versions, newest first, each linking to its read-only view", async () => {
  await mount(json(lease));
  const table = section("Versions")?.querySelector('table[aria-label="Versions"]');
  const rows = Array.from(table?.querySelectorAll("tbody tr") ?? []);
  expect(rows).toHaveLength(2);
  expect(rows[0]?.textContent).toContain("Monthly rent: $2,150.00 → $2,200.00");
  expect(rows[0]?.textContent).toContain("Ann Admin");
  expect(rows[0]?.querySelector("a")?.getAttribute("href")).toBe("/leases/l1/versions/2");
  expect(rows[1]?.querySelector("a")?.textContent).toBe("Version 1");
});

it("offers Edit lease to people who can write, but not to the Smoke user", async () => {
  await mount(json(lease));
  expect(Array.from(document.querySelectorAll("button")).some((b) => b.textContent === "Edit lease")).toBe(true);
  await mount(json(lease), "smoke");
  expect(Array.from(document.querySelectorAll("button")).some((b) => b.textContent === "Edit lease")).toBe(false);
});
