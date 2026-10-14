// @vitest-environment happy-dom
import { QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Link, Route, Routes } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { queryClient } from "../App";
import { NewLease } from "./NewLease";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => vi.unstubAllGlobals());

const unit = { id: "u1", label: "2R", use: "Residential", archivedAt: null, property: { id: "p1", name: "Elm House" } };
const ann = {
  id: "t1", version: 1, tenantType: "Individual", firstName: "Ann", lastName: "Lee", businessName: null, contactPerson: null,
  email: "ann@x.com", phone: null, notes: null, archivedAt: null, displayName: "Ann Lee",
};
const json = (v: unknown, status = 200) => Response.json(v, { status });

interface MountOptions {
  use?: string;
  taxes?: { id: string; taxYear: number; amountCents: number; version: number }[];
  /** Answers POST /api/units/:id/leases; the default saves as lease "l1". */
  post?: (body: Record<string, unknown>) => Response;
}
async function mount({ use = "Residential", taxes = [], post }: MountOptions = {}) {
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    if (init?.method === "POST" && url === "/api/units/u1/leases") return (post ?? (() => json({ id: "l1" }, 201)))(JSON.parse(init.body as string));
    if (url.startsWith("/api/properties/p1/taxes")) return json({ data: taxes, page: 1, pageSize: 200, total: taxes.length });
    if (url.startsWith("/api/units/")) return json({ ...unit, use, propertyId: "p1" });
    if (url.startsWith("/api/tenants")) return json({ data: [ann], page: 1, pageSize: 50, total: 1 });
    return json({}, 404);
  });
  queryClient.clear();
  document.body.innerHTML = '<div id="root"></div>';
  const root = createRoot(document.getElementById("root") as HTMLElement);
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/units/u1/leases/new"]}>
          <Link to="/home">Dashboard</Link>
          <Routes>
            <Route path="/units/:id/leases/new" element={<NewLease />} />
            <Route path="/home" element={<h1>Home</h1>} />
            <Route path="/leases/:leaseId" element={<h1>Lease page</h1>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await settle();
  return root;
}
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 100))));
const buttonNamed = (name: string) => Array.from(document.querySelectorAll("button")).find((b) => b.textContent === name) as HTMLButtonElement | undefined;
const setValue = (el: HTMLInputElement, v: string) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(el, v);
  el.dispatchEvent(new Event("input", { bubbles: true }));
};
const addNewTenant = async () => {
  await act(async () => buttonNamed("Add new tenant")?.click());
  await act(async () => (document.querySelector("input[type=radio][value=Individual]") as HTMLInputElement).click());
  await act(async () => {
    setValue(document.getElementById("new-tenant-field-firstName") as HTMLInputElement, "Bo");
    setValue(document.getElementById("new-tenant-field-lastName") as HTMLInputElement, "Diaz");
  });
  await act(async () => buttonNamed("Add tenant")?.click());
  await settle();
};
const click = (el: Element | undefined | null) => act(async () => (el as HTMLElement).click());

it("shows Step 1 of 4 with Next but no Back, and refuses to move on without a tenant", async () => {
  const root = await mount();
  expect(document.body.textContent).toContain("Step 1 of 4");
  expect(document.body.textContent).toContain("Elm House Unit 2R");
  expect(buttonNamed("Back")).toBeUndefined();
  await click(buttonNamed("Next"));
  expect(document.querySelector("[role=alert]")?.textContent).toBe("Add at least one tenant.");
  expect(document.body.textContent).toContain("Step 1 of 4");
  await act(async () => root.unmount());
});

it("a new tenant is added to the table, needs a primary contact, and Next/Back move between steps", async () => {
  const root = await mount();
  await addNewTenant();
  const row = document.querySelector("tbody tr") as HTMLElement;
  expect(row.textContent).toContain("Bo Diaz");
  await click(buttonNamed("Next"));
  expect(document.querySelector("[role=alert]")?.textContent).toBe("Choose a primary contact.");
  await click(row.querySelector("input[type=radio]"));
  expect(document.querySelector("[role=alert]")).toBeNull(); // the message goes away once it is fixed
  await click(buttonNamed("Next"));
  expect(document.body.textContent).toContain("Step 2 of 4");
  expect(buttonNamed("Back")).toBeDefined();
  await click(buttonNamed("Back"));
  expect(document.body.textContent).toContain("Step 1 of 4");
  await act(async () => root.unmount());
});

it("Remove takes a tenant out and clears the primary contact", async () => {
  const root = await mount();
  await addNewTenant();
  await click(document.querySelector("tbody input[type=radio]"));
  await click(buttonNamed("Remove"));
  expect(document.querySelector("tbody")).toBeNull();
  expect(document.activeElement).toBe(buttonNamed("Add new tenant"));
  await click(buttonNamed("Next"));
  expect(document.querySelector("[role=alert]")?.textContent).toBe("Add at least one tenant.");
  await act(async () => root.unmount());
});

it("leaving with a tenant added asks to discard; Keep editing stays, Discard leaves", async () => {
  const root = await mount();
  await addNewTenant();
  await click(Array.from(document.querySelectorAll("a")).find((a) => a.textContent === "Dashboard"));
  expect(document.body.textContent).toContain("Discard this lease? Your changes will be lost.");
  await click(buttonNamed("Keep editing"));
  expect(document.querySelector("h1")?.textContent).toBe("New lease");
  await click(Array.from(document.querySelectorAll("a")).find((a) => a.textContent === "Dashboard"));
  await click(buttonNamed("Discard"));
  await settle();
  expect(document.querySelector("h1")?.textContent).toBe("Home");
  await act(async () => root.unmount());
});

it("leaving before entering anything doesn't ask", async () => {
  const root = await mount();
  await click(Array.from(document.querySelectorAll("a")).find((a) => a.textContent === "Dashboard"));
  await settle();
  expect(document.querySelector("h1")?.textContent).toBe("Home");
  await act(async () => root.unmount());
});

it("the browser's Back button asks to discard too", async () => {
  const root = await mount();
  await addNewTenant();
  await act(async () => void window.dispatchEvent(new PopStateEvent("popstate")));
  expect(document.body.textContent).toContain("Discard this lease? Your changes will be lost.");
  await click(buttonNamed("Keep editing"));
  expect(document.querySelector("h1")?.textContent).toBe("New lease");
  await act(async () => root.unmount());
});

it("shows the email next to a tenant so same-named tenants can be told apart", async () => {
  const root = await mount();
  const box = document.querySelector("input[role=combobox]") as HTMLInputElement;
  await act(async () => box.focus());
  await act(async () => setValue(box, "Lee"));
  await settle();
  await click(document.querySelector("[role=option]"));
  expect(document.querySelector("tbody td")?.textContent).toContain("Ann Lee");
  expect(document.querySelector("tbody td")?.textContent).toContain("ann@x.com");
  await act(async () => root.unmount());
});

it("adding, removing and re-adding a tenant keeps a single extra history entry", async () => {
  const root = await mount();
  const push = vi.spyOn(window.history, "pushState");
  await addNewTenant();
  await click(buttonNamed("Remove"));
  await addNewTenant();
  expect(push).toHaveBeenCalledTimes(1);
  push.mockRestore();
  await act(async () => root.unmount());
});

const toStep2 = async () => {
  await addNewTenant();
  await click(document.querySelector("tbody input[type=radio]"));
  await click(buttonNamed("Next"));
};
const byLabel = (text: string) => {
  const label = Array.from(document.querySelectorAll("label")).find((l) => l.textContent?.startsWith(text));
  return document.getElementById((label as HTMLLabelElement).htmlFor) as HTMLInputElement;
};
const fill = (text: string, v: string) => act(async () => setValue(byLabel(text), v));

it("step 2 refuses an end date that isn't after the start date and clears the message once fixed", async () => {
  const root = await mount();
  await toStep2();
  expect(document.body.textContent).toContain("Step 2 of 4");
  await fill("Lease start date", "2026-11-01");
  await fill("Lease end date", "2026-11-01");
  await fill("Monthly rent", "2150");
  await click(buttonNamed("Next"));
  expect(document.body.textContent).toContain("Step 2 of 4");
  expect(document.body.textContent).toContain("Lease end date must be after the start date.");
  await fill("Lease end date", "2027-10-31");
  expect(document.body.textContent).not.toContain("Lease end date must be after the start date.");
  await click(buttonNamed("Next"));
  expect(document.body.textContent).toContain("Step 3 of 4");
  await act(async () => root.unmount());
});

it("step 2 shows a live Rent schedule for a fixed percentage and rows for a custom schedule", async () => {
  const root = await mount();
  await toStep2();
  await fill("Lease start date", "2026-01-01");
  await fill("Lease end date", "2028-12-31");
  await fill("Monthly rent", "2000");
  await click(document.querySelector("input[name=increaseType][value=percent]"));
  await fill("Annual increase (%)", "3");
  const table = document.querySelector("table[aria-label='Rent schedule']") as HTMLElement;
  expect(table.textContent).toContain("$2,060.00");
  expect(table.textContent).toContain("$2,121.80");
  await click(document.querySelector("input[name=increaseType][value=schedule]"));
  await click(buttonNamed("Add row"));
  await fill("Effective date", "2027-06-01");
  expect(document.body.textContent).not.toContain("Effective date must fall within");
  await fill("Effective date", "2029-06-01");
  await click(buttonNamed("Next"));
  expect(document.body.textContent).toContain("Effective date must fall within the lease term.");
  expect(document.body.textContent).toContain("There is a problem");
  await click(buttonNamed("Remove"));
  expect(document.activeElement).toBe(buttonNamed("Add row"));
  await act(async () => root.unmount());
});

it("step 2 offers Move-out date and Reason only when the end date is before today", async () => {
  const root = await mount();
  await toStep2();
  await fill("Lease start date", "2999-01-01");
  await fill("Lease end date", "2999-12-31");
  expect(document.body.textContent).not.toContain("Move-out date");
  await fill("Lease start date", "2020-01-01");
  await fill("Lease end date", "2020-12-31");
  expect(document.body.textContent).toContain("Move-out date");
  expect(document.body.textContent).toContain("Reason");
  await act(async () => root.unmount());
});

it("step 2 rows keep unique ids after Back and Next, and a far-future end date doesn't crash", async () => {
  const root = await mount();
  await toStep2();
  await fill("Lease start date", "2026-01-01");
  await fill("Lease end date", "2027-12-31");
  await fill("Monthly rent", "1000");
  await click(document.querySelector("input[name=increaseType][value=schedule]"));
  await click(buttonNamed("Add row"));
  expect(document.activeElement?.id).toBe(byLabel("Effective date").id);
  await fill("Effective date", "2027-03-01");
  const rentLabels = Array.from(document.querySelectorAll("label")).filter((l) => l.textContent?.startsWith("Monthly rent"));
  await act(async () => setValue(document.getElementById((rentLabels[1] as HTMLLabelElement).htmlFor) as HTMLInputElement, "1100"));
  await click(buttonNamed("Next"));
  await click(buttonNamed("Back"));
  await click(buttonNamed("Add row"));
  const ids = Array.from(document.querySelectorAll("input[type=date]")).map((i) => i.id);
  expect(new Set(ids).size).toBe(ids.length);
  await click(buttonNamed("Next"));
  expect(document.body.textContent).toContain("Rent step 2: Enter the effective date.");
  await click(document.querySelector("input[name=increaseType][value=percent]"));
  await fill("Annual increase (%)", "50");
  await fill("Lease end date", "9999-12-31");
  expect(document.body.textContent).toContain("Lease end date must be within 50 years of the start date.");
  await act(async () => root.unmount());
});

const toStep3 = async (options?: MountOptions) => {
  const root = await mount(options);
  await toStep2();
  await fill("Lease start date", "2026-11-01");
  await fill("Lease end date", "2027-10-31");
  await fill("Monthly rent", "2150");
  await click(buttonNamed("Next"));
  expect(document.body.textContent).toContain("Step 3 of 4");
  return root;
};
const labelled = (text: string) => Array.from(document.querySelectorAll("label, legend")).some((l) => l.textContent?.startsWith(text));

it("step 3 for a Residential unit requires Children reside in unit and hides the tax fields", async () => {
  const root = await toStep3();
  expect(labelled("Children reside in unit (required)")).toBe(true);
  expect(labelled("Base tax year")).toBe(false);
  await click(buttonNamed("Next"));
  expect(document.body.textContent).toContain("Step 3 of 4");
  expect(document.body.textContent).toContain("There is a problem");
  expect(document.body.textContent).toContain("Choose Yes or No.");
  await click(document.querySelector("input[name=childrenReside][value=No]"));
  expect(document.body.textContent).not.toContain("Choose Yes or No.");
  await click(buttonNamed("Next"));
  expect(document.body.textContent).toContain("Step 4 of 4");
  await act(async () => root.unmount());
});

it("step 3 for a Commercial unit shows the tax fields with the computed Tax reimbursement and no children field", async () => {
  const taxes = [
    { id: "a", taxYear: 2020, amountCents: 4_000_000, version: 1 },
    { id: "b", taxYear: 2025, amountCents: 5_200_000, version: 1 },
  ];
  const root = await toStep3({ use: "Commercial", taxes });
  await settle();
  expect(labelled("Children reside in unit")).toBe(false);
  expect(labelled("Tenant's share of tax increase (%)")).toBe(true);
  expect(Array.from(byLabel("Base tax year").querySelectorAll("option")).map((o) => o.textContent)).toEqual(["Select…", "2020", "2025"]);
  expect(document.body.textContent).toContain("Tax reimbursement (monthly): –");
  await act(async () => {
    const select = byLabel("Base tax year") as unknown as HTMLSelectElement;
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(select, "2020");
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await fill("Tenant's share of tax increase (%)", "25");
  expect(document.body.textContent).toContain("$250.00");
  expect(document.body.textContent).toContain("25% × (2025 tax $52,000.00 − 2020 tax $40,000.00) ÷ 12");
  await act(async () => root.unmount());
});

it("step 3 for a Commercial unit with no tax years shows the hint", async () => {
  const root = await toStep3({ use: "Commercial" });
  await settle();
  expect(document.body.textContent).toContain("Add tax years on the property's Property taxes tab to calculate tax reimbursement.");
  await act(async () => root.unmount());
});

it("Save lease on the Review step sends the lease and opens the lease page", async () => {
  const bodies: Record<string, unknown>[] = [];
  const root = await toStep3({ post: (b) => (bodies.push(b), json({ id: "l1" }, 201)) });
  await click(document.querySelector("input[name=childrenReside][value=No]"));
  await click(buttonNamed("Next"));
  expect(document.querySelector("dl")?.textContent).toContain("$2,150.00");
  expect(document.querySelector("dl")?.textContent).toContain("Bo Diaz (Primary contact)");
  expect((buttonNamed("Save and generate PDF") as HTMLButtonElement).disabled).toBe(true);
  expect(buttonNamed("Next")).toBeUndefined();
  await click(buttonNamed("Save lease"));
  await settle();
  expect(bodies).toHaveLength(1);
  expect(bodies[0]).toMatchObject({ startDate: "2026-11-01", endDate: "2027-10-31", baseRentCents: 215000, childrenReside: false, newTenants: [{ isPrimary: true }] });
  expect(document.querySelector("h1")?.textContent).toBe("Lease page");
  await act(async () => root.unmount());
});

it("a refused save shows the server's message on the Review step and keeps the data", async () => {
  const root = await toStep3({ post: () => json({ error: { code: "CONFLICT", message: "This unit already has a lease for those dates." } }, 409) });
  await click(document.querySelector("input[name=childrenReside][value=No]"));
  await click(buttonNamed("Next"));
  await click(buttonNamed("Save lease"));
  await settle();
  expect(document.querySelector("[role=alert]")?.textContent).toContain("This unit already has a lease for those dates.");
  expect(document.body.textContent).toContain("Step 4 of 4");
  expect((buttonNamed("Save lease") as HTMLButtonElement).disabled).toBe(false);
  await act(async () => root.unmount());
});

it("moving to the next step puts focus on the step heading", async () => {
  const root = await toStep3();
  expect(document.activeElement?.id).toBe("step-heading");
  await act(async () => root.unmount());
});

it("a network failure on save shows the plain message", async () => {
  const root = await toStep3({ post: () => { throw new TypeError("Failed to fetch"); } });
  await click(document.querySelector("input[name=childrenReside][value=No]"));
  await click(buttonNamed("Next"));
  await click(buttonNamed("Save lease"));
  await settle();
  expect(document.querySelector("[role=alert]")?.textContent).toContain("Something went wrong. Please try again.");
  await act(async () => root.unmount());
});
