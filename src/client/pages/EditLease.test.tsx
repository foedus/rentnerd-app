// @vitest-environment happy-dom
import { QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { queryClient } from "../App";
import { EditLease } from "./EditLease";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => vi.unstubAllGlobals());

const json = (v: unknown, status = 200) => Response.json(v, { status });
const lease = {
  id: "l1", version: 3, statusLabel: "Upcoming", propertyName: "Court Plaza", propertyId: "p1", unitLabel: "2R", unitUse: "Residential",
  startDate: "2026-11-01", endDate: "2027-10-31", baseRentCents: 215000, securityDepositCents: null, rentDueDay: 1, lateFeeCents: null, lateFeeGraceDays: null,
  increaseType: "none", increasePercent: null, rentSteps: [], moveOutDate: null, endReason: null, pets: null, parking: null, parkingChargeCents: null,
  childrenReside: false, breakClause: null, otherTerms: null, baseTaxYear: null, taxSharePercent: null,
  masterTenants: [{ tenantId: "t1", isPrimary: true, displayName: "Ann Lee" }],
};

let patchBody: Record<string, unknown> | null = null;
async function mount(patch: Response) {
  patchBody = null;
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    if (init?.method === "PATCH") {
      patchBody = JSON.parse(String(init.body)) as Record<string, unknown>;
      return patch.clone();
    }
    return json(lease);
  });
  queryClient.clear();
  document.body.innerHTML = '<div id="root"></div>';
  const root = createRoot(document.getElementById("root") as HTMLElement);
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/leases/l1/edit"]}>
          <Routes>
            <Route path="/leases/:id/edit" element={<EditLease />} />
            <Route path="/leases/:id" element={<p>Lease page</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await act(async () => void (await new Promise((r) => setTimeout(r, 100))));
}
const buttonNamed = (name: string) => Array.from(document.querySelectorAll("button")).find((b) => b.textContent === name) as HTMLButtonElement | undefined;
const press = async (name: string) => {
  await act(async () => {
    buttonNamed(name)?.click();
    await new Promise((r) => setTimeout(r, 50));
  });
};

it("shows every wizard field on one page, filled in, with Save lease and no Add new tenant", async () => {
  await mount(json({}));
  const labels = Array.from(document.querySelectorAll("label")).map((l) => l.textContent ?? "");
  for (const want of ["Monthly rent", "Lease start date", "Pets", "Primary contact"]) expect(labels.some((l) => l.includes(want))).toBe(true);
  expect(document.body.textContent).toContain("Ann Lee");
  expect(buttonNamed("Save lease")).toBeTruthy();
  expect(buttonNamed("Add new tenant")).toBeUndefined();
});

it("saves with the loaded version number and goes back to the lease", async () => {
  await mount(json({}));
  await press("Save lease");
  expect(patchBody).toMatchObject({ version: 3, baseRentCents: 215000, tenants: [{ tenantId: "t1", isPrimary: true }] });
  expect(document.body.textContent).toContain("Lease page");
});

it("shows the conflict message with a Reload button when someone else saved first", async () => {
  await mount(json({ error: { code: "CONFLICT", message: "This lease was changed by someone else. Reload and try again." } }, 409));
  await press("Save lease");
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("Someone else changed this record. Reload to see the latest version.");
  expect(buttonNamed("Reload")).toBeTruthy();
});

it("lists the server's field problems", async () => {
  await mount(json({ error: { code: "VALIDATION_ERROR", message: "x", fields: { endDate: "This unit already has a lease for those dates." } } }, 422));
  await press("Save lease");
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("Lease end date: This unit already has a lease for those dates.");
});
