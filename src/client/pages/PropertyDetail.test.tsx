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

const property = {
  id: "p1", name: "Court Plaza", street: "1 Elm Street", city: "Brooklyn", state: "NY", zip: "11201", archivedAt: null,
  owner: { id: "o1", name: "Acme LLC" }, responsible: [{ id: "u1", name: "Ann", email: "a@x.com" }, { id: "u2", name: "Bob", email: "b@x.com" }],
  propertyType: "Mixed", unitCount: 2, occupiedCount: 0, inNyc: true, bbl: "3-00123-0045", yearBuilt: 1931,
  purchasePriceCents: 125000000, purchaseDate: "2020-03-05",
};
const units = [
  { id: "n1", label: "2R", use: "Residential", archivedAt: null },
  { id: "n2", label: "Store", use: "Commercial", archivedAt: null },
];
const json = (v: unknown) => Response.json(v);
const wait = () => act(async () => void (await new Promise((r) => setTimeout(r, 100))));

async function mount(role: string, entry = "/properties/p1") {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    calls.push(url);
    if (url === "/api/me") return json({ id: "u", name: "Ann", email: "a@x.com", role, status: "active" });
    if (url.startsWith("/api/properties/p1/units")) return json({ data: units, page: 1, pageSize: 200, total: 2 });
    return json(property);
  });
  queryClient.clear();
  document.body.innerHTML = '<div id="root"></div>';
  const root = createRoot(document.getElementById("root") as HTMLElement);
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[entry]}>
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
const buttonNamed = (name: string) => Array.from(document.querySelectorAll("button")).find((b) => b.textContent === name);

it("shows the summary with each responsible landlord's name and email, and the Units tab", async () => {
  const { root } = await mount("landlord");
  expect(document.querySelector("h1")?.textContent).toBe("Court Plaza");
  const text = document.querySelector("dl")?.textContent ?? "";
  for (const s of ["1 Elm Street, Brooklyn, NY 11201", "Mixed", "Acme LLC", "Yes", "3-00123-0045", "1931", "$1,250,000.00", "Mar 5, 2020", "Ann (a@x.com)", "Bob (b@x.com)"]) {
    expect(text).toContain(s);
  }
  expect(Array.from(document.querySelectorAll("[role=tab]")).map((t) => t.textContent)).toEqual(["Units", "Values", "Property taxes", "Compliance", "Investments"]);
  const table = document.querySelector("table[aria-label=Units]") as HTMLElement;
  expect(Array.from(table.querySelectorAll("th")).map((h) => h.textContent)).toEqual(["Unit", "Use", "Status", "Tenants", "Current rent", "Lease end"]);
  expect(table.textContent).toContain("Store");
  expect(buttonNamed("Add unit")).toBeDefined();
  await act(async () => root.unmount());
});

it("selects a tab from ?tab= and hides write buttons from the Smoke user", async () => {
  const { root } = await mount("smoke", "/properties/p1?tab=Compliance");
  expect(document.querySelector("[role=tab][aria-selected=true]")?.textContent).toBe("Compliance");
  expect(buttonNamed("Add unit")).toBeUndefined();
  expect(buttonNamed("Edit property")).toBeUndefined();
  await act(async () => root.unmount());
});

it("an unknown property shows Page not found", async () => {
  vi.stubGlobal("fetch", async (url: string) =>
    url === "/api/me" ? json({ id: "u", name: "A", email: "a@x.com", role: "admin", status: "active" }) : new Response("{}", { status: 404 }));
  queryClient.clear();
  document.body.innerHTML = '<div id="root"></div>';
  const root = createRoot(document.getElementById("root") as HTMLElement);
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/properties/zzz"]}>
          <Routes><Route path="/properties/:id" element={<PropertyDetail />} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await wait();
  expect(document.body.textContent).toContain("Page not found");
  await act(async () => root.unmount());
});

it("keeps Show archived ticked after visiting another tab", async () => {
  const { root, calls } = await mount("admin");
  const box = () => document.querySelector("input[type=checkbox]") as HTMLInputElement;
  await act(async () => box().click());
  await wait();
  const tabs = Array.from(document.querySelectorAll("[role=tab]")) as HTMLElement[];
  await act(async () => tabs[1]!.click());
  await act(async () => tabs[0]!.click());
  await wait();
  expect(box().checked).toBe(true);
  expect(calls.at(-1)).toContain("archived=true");
  await act(async () => root.unmount());
});

it("a failed load shows the error with Try again", async () => {
  vi.stubGlobal("fetch", async (url: string) =>
    url === "/api/me" ? json({ id: "u", name: "A", email: "a@x.com", role: "admin", status: "active" }) : new Response("{}", { status: 500 }));
  queryClient.clear();
  document.body.innerHTML = '<div id="root"></div>';
  const root = createRoot(document.getElementById("root") as HTMLElement);
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/properties/zzz"]}>
          <Routes><Route path="/properties/:id" element={<PropertyDetail />} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await wait();
  expect(document.querySelector("[role=alert]")).not.toBeNull();
  expect(buttonNamed("Try again")).toBeDefined();
  expect(document.activeElement).toBe(document.querySelector("[role=alert]"));
  await act(async () => root.unmount());
});

it("a lost session re-checks who is signed in so the app can send the user to sign in", async () => {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    calls.push(url);
    return url === "/api/me" ? json({ id: "u", name: "A", email: "a@x.com", role: "admin", status: "active" }) : new Response("{}", { status: 401 });
  });
  queryClient.clear();
  queryClient.setQueryData(["me"], { id: "u" });
  document.body.innerHTML = '<div id="root"></div>';
  const root = createRoot(document.getElementById("root") as HTMLElement);
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/properties/p1"]}>
          <Routes><Route path="/properties/:id" element={<PropertyDetail />} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await wait();
  expect(queryClient.getQueryState(["me"])?.isInvalidated).toBe(true);
  expect(calls.every((u) => u.startsWith("/api/properties/"))).toBe(true);
  await act(async () => root.unmount());
});

it("a lost session or refused access on the Units list is handled", async () => {
  for (const [status, text] of [[401, null], [403, "You don't have access to this page."]] as const) {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      calls.push(url);
      if (url === "/api/me") return json({ id: "u", name: "A", email: "a@x.com", role: "admin", status: "active" });
      return url.startsWith("/api/properties/p1/units") ? new Response("{}", { status }) : json(property);
    });
    queryClient.clear();
    document.body.innerHTML = '<div id="root"></div>';
    const root = createRoot(document.getElementById("root") as HTMLElement);
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={["/properties/p1"]}>
            <Routes><Route path="/properties/:id" element={<PropertyDetail />} /></Routes>
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });
    await wait();
    await wait();
    if (text) expect(document.querySelector("[role=alert]")?.textContent).toBe(text);
    // Signed out: /api/me is asked again (once on load, once after the 401) so the app can send the user to sign in.
    else expect(calls.filter((u) => u === "/api/me").length).toBe(2);
    await act(async () => root.unmount());
  }
});

it("a refused property load says the user has no access", async () => {
  vi.stubGlobal("fetch", async (url: string) =>
    url === "/api/me" ? json({ id: "u", name: "A", email: "a@x.com", role: "admin", status: "active" }) : new Response("{}", { status: 403 }));
  queryClient.clear();
  document.body.innerHTML = '<div id="root"></div>';
  const root = createRoot(document.getElementById("root") as HTMLElement);
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/properties/p1"]}>
          <Routes><Route path="/properties/:id" element={<PropertyDetail />} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await wait();
  expect(document.querySelector("[role=alert]")?.textContent).toBe("You don't have access to this page.");
  await act(async () => root.unmount());
});

it("lists each active unit as Vacant, linked to its page", async () => {
  await mount("landlord");
  const rows = Array.from(document.querySelectorAll("table tbody tr"));
  expect(rows[0]?.textContent).toContain("2R");
  expect(rows[0]?.textContent).toContain("Vacant");
  expect(rows[0]?.querySelector("a")?.getAttribute("href")).toBe("/units/n1");
});
