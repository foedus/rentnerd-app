// @vitest-environment happy-dom
import { QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { queryClient } from "../App";
import { Investments } from "./Investments";
import { PropertyDetail } from "./PropertyDetail";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => vi.unstubAllGlobals());

const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";
const json = (v: unknown) => Response.json(v);
const wait = () => act(async () => void (await new Promise((r) => setTimeout(r, 100))));
const waitFor = async (check: () => unknown) => {
  for (let i = 0; i < 80 && !check(); i++) await wait();
};
const property = {
  id: P1, name: "Court Plaza", street: "1 Elm Street", city: "Brooklyn", state: "NY", zip: "11201", archivedAt: null,
  owner: { id: "o1", name: "Acme LLC" }, responsible: [], propertyType: "—", unitCount: 0, occupiedCount: 0, totalInvestedCents: 2090050,
};
const entries = [
  { id: "e1", version: 1, entryDate: "2026-09-02", propertyId: P1, propertyName: "Court Plaza", unitId: "u1", unitLabel: "1A", category: "Appliance", description: "Dryer", vendor: null, costCents: 90050 },
  { id: "e2", version: 2, entryDate: "2026-09-01", propertyId: P1, propertyName: "Court Plaza", unitId: null, unitLabel: null, category: "Renovation", description: "Kitchen", vendor: "Acme", costCents: 2000000 },
];

async function mount(role: string, path = "/investments", opts: { saveStatus?: number } = {}) {
  const calls: { url: string; method: string; body?: string }[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: init?.body as string | undefined });
    if (url === "/api/me") return json({ id: "u", name: "Ann", email: "a@x.com", role, status: "active" });
    if (url.startsWith("/api/investments/") && method === "DELETE") return new Response(null, { status: 204 });
    if (url.startsWith("/api/investments") && method !== "GET") {
      if (opts.saveStatus) return Response.json({ error: { code: "CONFLICT", message: "This property is archived. Restore it before adding entries." } }, { status: opts.saveStatus });
      return json(entries[0]);
    }
    if (url.startsWith("/api/investments")) return json({ data: entries, page: 1, pageSize: 25, total: 2, totalCents: 2090050 });
    if (url.startsWith(`/api/properties/${P1}/units`)) return json({ data: [{ id: "u1", label: "1A", use: "Residential", archivedAt: null }, { id: "u2", label: "1B", use: "Residential", archivedAt: null }], page: 1, pageSize: 200, total: 2 });
    if (url.startsWith(`/api/properties/${P2}/units`)) return json({ data: [], page: 1, pageSize: 200, total: 0 });
    if (url.startsWith("/api/properties?")) return json({ data: [property, { ...property, id: P2, name: "Other" }], page: 1, pageSize: 200, total: 2 });
    return json(property);
  });
  queryClient.clear();
  document.body.innerHTML = '<div id="root"></div>';
  const root = createRoot(document.getElementById("root") as HTMLElement);
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/investments" element={<Investments />} />
            <Route path="/properties/:id" element={<PropertyDetail />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await waitFor(() => document.querySelector("table[aria-label='Investments']"));
  return { root, calls };
}
const buttonNamed = (name: string) => Array.from(document.querySelectorAll("button")).find((b) => b.textContent === name || b.getAttribute("aria-label") === name);
const control = (label: string) => Array.from((document.querySelector("[role=dialog]") ?? document).querySelectorAll("label")).find((l) => l.textContent?.startsWith(label))?.control as HTMLInputElement & HTMLSelectElement;
const typeInto = async (label: string, value: string) => {
  const input = control(label);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const pick = async (label: string, value: string) => {
  const select = control(label);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await wait();
};
const optionLabels = (label: string) => Array.from(control(label).querySelectorAll("option")).map((o) => o.textContent);

it("lists entries with a Total row for the whole filter", async () => {
  const { root } = await mount("landlord");
  const table = document.querySelector("table[aria-label='Investments']") as HTMLElement;
  expect(Array.from(table.querySelectorAll("th[scope=col]")).map((h) => h.textContent)).toEqual(["Date", "Property", "Unit", "Category", "Description", "Vendor", "Cost", "Actions"]);
  const rows = Array.from(table.querySelectorAll("tbody tr")).map((r) => r.textContent);
  expect(rows[0]).toContain("Dryer");
  expect(rows[0]).toContain("1A");
  expect(rows[0]).toContain("$900.50");
  expect(rows[1]).toContain("Whole property");
  expect(table.querySelector("tfoot")?.textContent).toBe("Total$20,900.50");
  await act(async () => root.unmount());
});

it("sends the filters to the API and returns to page 1", async () => {
  const { root, calls } = await mount("landlord");
  await pick("Property", P1);
  await pick("Category", "Appliance");
  await typeInto("From", "2026-09-01");
  await wait();
  const last = calls.filter((c) => c.url.startsWith("/api/investments?")).at(-1);
  expect(new URL(last?.url ?? "", "http://x").searchParams.toString()).toBe(`page=1&propertyId=${P1}&category=Appliance&from=2026-09-01`);
  await act(async () => root.unmount());
});

it("hides the write buttons from the Smoke user", async () => {
  const { root } = await mount("smoke");
  expect(buttonNamed("Add entry")).toBeUndefined();
  expect(Array.from(document.querySelectorAll("table[aria-label='Investments'] th[scope=col]")).map((h) => h.textContent)).not.toContain("Actions");
  expect(document.querySelector("tfoot")?.textContent).toBe("Total$20,900.50");
  await act(async () => root.unmount());
});

it("limits the Unit choices to the chosen property, with Whole property first, and saves", async () => {
  const { root, calls } = await mount("admin");
  await act(async () => (buttonNamed("Add entry") as HTMLElement).click());
  await wait();
  expect(optionLabels("Unit")).toEqual(["Whole property"]);
  await pick("Property", P1);
  expect(optionLabels("Unit")).toEqual(["Whole property", "1A", "1B"]);
  await typeInto("Date", "2026-09-01");
  await pick("Category", "Appliance");
  await typeInto("Description", "Replace fridge");
  await typeInto("Cost", "1250");
  await act(async () => (buttonNamed("Save entry") as HTMLElement).click());
  await wait();
  const post = calls.find((c) => c.method === "POST");
  expect(post?.url).toBe("/api/investments");
  expect(JSON.parse(post?.body ?? "{}")).toMatchObject({ entryDate: "2026-09-01", propertyId: P1, category: "Appliance", description: "Replace fridge", costCents: 125000 });
  expect(document.querySelector("[role=dialog]")).toBeNull();
  expect(document.body.textContent).toContain("Entry saved.");
  await act(async () => root.unmount());
});

it("drops a chosen unit when the property changes", async () => {
  const { root } = await mount("admin");
  await act(async () => (buttonNamed("Edit Dryer") as HTMLElement).click());
  await wait();
  expect(control("Unit").value).toBe("u1");
  await pick("Property", P2);
  await waitFor(() => control("Unit").value === "");
  expect(control("Unit").value).toBe("");
  await act(async () => root.unmount());
});

it("shows the server's reason when the property is archived", async () => {
  const { root } = await mount("admin", "/investments", { saveStatus: 409 });
  await act(async () => (buttonNamed("Add entry") as HTMLElement).click());
  await wait();
  await pick("Property", P1);
  await typeInto("Date", "2026-09-01");
  await pick("Category", "Repair");
  await typeInto("Description", "x");
  await typeInto("Cost", "1");
  await act(async () => (buttonNamed("Save entry") as HTMLElement).click());
  await wait();
  expect(document.querySelector("[role=dialog]")?.textContent).toContain("This property is archived. Restore it before adding entries.");
  await act(async () => root.unmount());
});

it("pre-selects the property on the property's tab and warns when From is after To", async () => {
  const { root } = await mount("admin", `/properties/${P1}?tab=Investments`);
  await act(async () => (buttonNamed("Add entry") as HTMLElement).click());
  await waitFor(() => control("Property").value === P1);
  expect(control("Property").value).toBe(P1);
  await act(async () => (buttonNamed("Cancel") as HTMLElement).click());
  await typeInto("From", "2026-10-01");
  await typeInto("To", "2026-09-01");
  expect(document.body.textContent).toContain("From can't be after To.");
  await act(async () => root.unmount());
});

it("deletes after confirmation", async () => {
  const { root, calls } = await mount("admin");
  await act(async () => (buttonNamed("Delete Dryer") as HTMLElement).click());
  await wait();
  expect(calls.some((c) => c.method === "DELETE")).toBe(false);
  await act(async () => (buttonNamed("Delete entry") as HTMLElement).click());
  await wait();
  expect(calls.find((c) => c.method === "DELETE")?.url).toBe("/api/investments/e1");
  expect(document.body.textContent).toContain("Entry deleted.");
  await act(async () => root.unmount());
});

it("shows Total invested and the Investments tab on the property", async () => {
  const { root, calls } = await mount("admin", `/properties/${P1}?tab=Investments`);
  const dl = document.querySelector("dl") as HTMLElement;
  expect(Array.from(dl.querySelectorAll("dt")).find((t) => t.textContent === "Total invested")?.nextElementSibling?.textContent).toBe("$20,900.50");
  expect(calls.some((c) => c.url.includes("/api/investments?") && c.url.includes(`propertyId=${P1}`))).toBe(true);
  expect(control("Property")).toBeUndefined();
  expect(buttonNamed("Add entry")).toBeDefined();
  await act(async () => root.unmount());
});
