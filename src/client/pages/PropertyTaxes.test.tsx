// @vitest-environment happy-dom
import { QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { queryClient } from "../App";
import { PropertyDetail } from "./PropertyDetail";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => vi.unstubAllGlobals());

const base = {
  id: "p1", name: "Court Plaza", street: "1 Elm Street", city: "Brooklyn", state: "NY", zip: "11201", archivedAt: null,
  owner: { id: "o1", name: "Acme LLC" }, responsible: [], propertyType: "—", unitCount: 0, occupiedCount: 0, purchasePriceCents: 70000000,
};
const taxes = [
  { id: "t2", taxYear: 2025, amountCents: 5200000, version: 1 },
  { id: "t1", taxYear: 2020, amountCents: 4000000, version: 3 },
];
const json = (v: unknown) => Response.json(v);
const wait = () => act(async () => void (await new Promise((r) => setTimeout(r, 30))));

async function mount(role: string, duplicate = false, patchStatus = 200) {
  const calls: { url: string; method: string; body?: string }[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? "GET", body: init?.body as string | undefined });
    if (url === "/api/me") return json({ id: "u", name: "Ann", email: "a@x.com", role, status: "active" });
    if (url.startsWith("/api/properties/p1/units")) return json({ data: [], page: 1, pageSize: 200, total: 0 });
    if (url === "/api/properties/p1/taxes" && init?.method === "POST" && duplicate)
      return Response.json({ error: { code: "CONFLICT", message: "This tax year already exists for this property.", fields: { taxYear: "This tax year already exists for this property." } } }, { status: 409 });
    if (url.startsWith("/api/properties/p1/taxes")) return init?.method === "POST" ? json({ id: "t3", taxYear: 2026, amountCents: 100, version: 1 }) : json({ data: taxes, page: 1, pageSize: 200, total: 2 });
    if (url.startsWith("/api/property-taxes/") && init?.method === "PATCH" && patchStatus !== 200) return Response.json({ error: { code: "X", message: "x" } }, { status: patchStatus });
    if (url.startsWith("/api/property-taxes/")) return new Response(null, { status: 204 });
    return json(base);
  });
  queryClient.clear();
  document.body.innerHTML = '<div id="root"></div>';
  const root = createRoot(document.getElementById("root") as HTMLElement);
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/properties/p1?tab=Property%20taxes"]}>
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
const typeInto = async (label: string, value: string) => {
  const input = Array.from(document.querySelectorAll("label")).find((l) => l.textContent?.startsWith(label))?.control as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

it("lists tax years with Edit and Delete on each row", async () => {
  const { root } = await mount("landlord");
  const table = document.querySelector("table[aria-label='Property taxes']") as HTMLElement;
  expect(Array.from(table.querySelectorAll("th")).map((h) => h.textContent)).toEqual(["Tax year", "Annual property tax", "Actions"]);
  const rows = Array.from(table.querySelectorAll("tbody tr")).map((r) => r.textContent);
  expect(rows[0]).toContain("2025");
  expect(rows[0]).toContain("$52,000.00");
  expect(rows[1]).toContain("2020");
  expect(buttonNamed("Add tax year")).toBeDefined();
  expect(buttonNamed("Edit tax year 2025")).toBeDefined();
  expect(buttonNamed("Delete tax year 2020")).toBeDefined();
  await act(async () => root.unmount());
});

it("hides the write buttons from the Smoke user", async () => {
  const { root } = await mount("smoke");
  expect(buttonNamed("Add tax year")).toBeUndefined();
  expect(Array.from(document.querySelectorAll("table[aria-label='Property taxes'] th")).map((h) => h.textContent)).not.toContain("Actions");
  await act(async () => root.unmount());
});

it("adds a tax year from the dialog", async () => {
  const { root, calls } = await mount("admin");
  await act(async () => (buttonNamed("Add tax year") as HTMLElement).click());
  await wait();
  await typeInto("Tax year", "2026");
  await typeInto("Annual property tax", "1.00");
  await act(async () => (buttonNamed("Save tax year") as HTMLElement).click());
  await wait();
  const post = calls.find((c) => c.method === "POST");
  expect(post?.url).toBe("/api/properties/p1/taxes");
  expect(JSON.parse(post?.body ?? "{}")).toEqual({ taxYear: 2026, amountCents: 100 });
  await act(async () => root.unmount());
});

it("shows the duplicate-year message next to the Tax year field and keeps the dialog open", async () => {
  const { root } = await mount("admin", true);
  await act(async () => (buttonNamed("Add tax year") as HTMLElement).click());
  await wait();
  await typeInto("Tax year", "2025");
  await typeInto("Annual property tax", "12000");
  await act(async () => (buttonNamed("Save tax year") as HTMLElement).click());
  await wait();
  const dialog = document.querySelector("[role=dialog]") as HTMLElement;
  expect(dialog.textContent).toContain("This tax year already exists for this property.");
  expect(buttonNamed("Save tax year")).toBeDefined();
  await act(async () => root.unmount());
});

it("deletes a tax year after confirmation", async () => {
  const { root, calls } = await mount("admin");
  await act(async () => (buttonNamed("Delete tax year 2020") as HTMLElement).click());
  await wait();
  expect(document.body.textContent).toContain("Delete this tax year?");
  await act(async () => (buttonNamed("Delete tax year") as HTMLElement).click());
  await wait();
  expect(calls).toContainEqual({ url: "/api/property-taxes/t1", method: "DELETE", body: undefined });
  expect(document.activeElement).toBe(buttonNamed("Add tax year"));
  await act(async () => root.unmount());
});

it("says so when the tax year was deleted by someone else while editing", async () => {
  const { root } = await mount("admin", false, 404);
  await act(async () => (buttonNamed("Edit tax year 2025") as HTMLElement).click());
  await wait();
  await act(async () => (buttonNamed("Save tax year") as HTMLElement).click());
  await wait();
  expect((document.querySelector("[role=dialog]") as HTMLElement).textContent).toContain("This tax year no longer exists.");
  await act(async () => root.unmount());
});

it("tells the user the session ended and refreshes the signed-in check when saving gets a 401", async () => {
  const { root, calls } = await mount("admin", false, 401);
  await act(async () => (buttonNamed("Edit tax year 2025") as HTMLElement).click());
  await wait();
  await act(async () => (buttonNamed("Save tax year") as HTMLElement).click());
  await wait();
  expect((document.querySelector("[role=dialog]") as HTMLElement).textContent).toContain("Your session has ended.");
  expect(calls.filter((c) => c.url === "/api/me").length).toBeGreaterThan(1);
  await act(async () => root.unmount());
});
