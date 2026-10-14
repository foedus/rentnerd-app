// @vitest-environment happy-dom
import { QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { queryClient } from "../App";
import { PropertyDetail } from "./PropertyDetail";
import { currentValueText } from "./PropertyValues";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => vi.unstubAllGlobals());

const base = {
  id: "p1", name: "Court Plaza", street: "1 Elm Street", city: "Brooklyn", state: "NY", zip: "11201", archivedAt: null,
  owner: { id: "o1", name: "Acme LLC" }, responsible: [], propertyType: "—", unitCount: 0, occupiedCount: 0, purchasePriceCents: 70000000,
};
const values = [
  { id: "v2", valueDate: "2026-06-01", kind: "market_estimate", amountCents: 95000000, source: "Broker", version: 1 },
  { id: "v1", valueDate: "2026-01-01", kind: "assessed", amountCents: 30000000, source: null, version: 2 },
];
const json = (v: unknown) => Response.json(v);
const wait = () => act(async () => void (await new Promise((r) => setTimeout(r, 30))));

async function mount(role: string, currentValue: unknown) {
  const calls: { url: string; method: string }[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? "GET" });
    if (url === "/api/me") return json({ id: "u", name: "Ann", email: "a@x.com", role, status: "active" });
    if (url.startsWith("/api/properties/p1/units")) return json({ data: [], page: 1, pageSize: 200, total: 0 });
    if (url.startsWith("/api/properties/p1/values")) return json({ data: values, page: 1, pageSize: 200, total: 2 });
    if (url.startsWith("/api/property-values/")) return new Response(null, { status: 204 });
    return json({ ...base, currentValue });
  });
  queryClient.clear();
  document.body.innerHTML = '<div id="root"></div>';
  const root = createRoot(document.getElementById("root") as HTMLElement);
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/properties/p1?tab=Values"]}>
          <Routes>
            <Route path="/properties/:id" element={<PropertyDetail />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await wait();
  return { root, calls };
}
const buttonNamed = (name: string) => Array.from(document.querySelectorAll("button")).find((b) => b.textContent === name || b.getAttribute("aria-label") === name);

it("describes the current value and its basis (D-15)", () => {
  expect(currentValueText({ amountCents: 95000000, basis: { kind: "market_estimate", date: "2026-06-01" } })).toEqual({ amount: "$950,000.00", basis: "Market estimate Jun 1, 2026" });
  expect(currentValueText({ amountCents: 70000000, basis: { kind: "purchase_price" } })).toEqual({ amount: "$700,000.00", basis: "Purchase price" });
  expect(currentValueText(null)).toBeNull();
});

it("shows the current value with its basis in the summary and the history table with row actions", async () => {
  const { root } = await mount("landlord", { amountCents: 95000000, basis: { kind: "market_estimate", date: "2026-06-01" } });
  expect(document.querySelector("dl")?.textContent).toContain("$950,000.00 (Market estimate Jun 1, 2026)");
  const table = document.querySelector("table[aria-label=Values]") as HTMLElement;
  expect(Array.from(table.querySelectorAll("th")).map((h) => h.textContent)).toEqual(["Date", "Value type", "Amount", "Source / notes", "Actions"]);
  const rows = Array.from(table.querySelectorAll("tbody tr")).map((r) => r.textContent);
  expect(rows[0]).toContain("Market estimate");
  expect(rows[0]).toContain("$950,000.00");
  expect(rows[1]).toContain("Assessed value");
  expect(buttonNamed("Add value")).toBeDefined();
  expect(buttonNamed("Edit Market estimate Jun 1, 2026")).toBeDefined();
  expect(buttonNamed("Delete Assessed value Jan 1, 2026")).toBeDefined();
  await act(async () => root.unmount());
});

it("falls back to the purchase price and hides write buttons from the Smoke user", async () => {
  const { root } = await mount("smoke", { amountCents: 70000000, basis: { kind: "purchase_price" } });
  expect(document.querySelector("dl")?.textContent).toContain("$700,000.00 (Purchase price)");
  expect(buttonNamed("Add value")).toBeUndefined();
  expect(Array.from(document.querySelectorAll("table[aria-label=Values] th")).map((h) => h.textContent)).not.toContain("Actions");
  await act(async () => root.unmount());
});

it("deletes a value after confirmation", async () => {
  const { root, calls } = await mount("admin", null);
  await act(async () => (buttonNamed("Delete Assessed value Jan 1, 2026") as HTMLElement).click());
  await wait();
  expect(document.body.textContent).toContain("Delete this value?");
  await act(async () => (buttonNamed("Delete value") as HTMLElement).click());
  await wait();
  expect(calls).toContainEqual({ url: "/api/property-values/v1", method: "DELETE" });
  expect(document.activeElement).toBe(buttonNamed("Add value"));
  await act(async () => root.unmount());
});
