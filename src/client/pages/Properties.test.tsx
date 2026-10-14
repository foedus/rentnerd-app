// @vitest-environment happy-dom
import { QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { queryClient } from "../App";
import { Properties } from "./Properties";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => vi.unstubAllGlobals());

const property = {
  id: "p1", name: "Court Plaza", street: "1 Elm Street", city: "Brooklyn", state: "NY", zip: "11201", archivedAt: null,
  owner: { id: "o1", name: "Acme LLC" }, responsible: [{ id: "u1", name: "Ann", email: "a@x.com" }, { id: "u2", name: "Bob", email: "b@x.com" }],
  propertyType: "Residential", unitCount: 3, occupiedCount: 0,
};
const json = (v: unknown) => Response.json(v);
const empty = { data: [], page: 1, pageSize: 50, total: 0 };

async function mount(role: string, list: unknown) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    calls.push(url);
    return url === "/api/me" ? json({ id: "u", name: "Ann", email: "a@x.com", role, status: "active" }) : json(list);
  });
  queryClient.clear();
  document.body.innerHTML = '<div id="root"></div>';
  const root = createRoot(document.getElementById("root") as HTMLElement);
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/properties"]}>
          <Routes>
            <Route path="/properties" element={<Properties />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await act(async () => void (await new Promise((r) => setTimeout(r, 100))));
  return { root, calls };
}
const buttonNamed = (name: string) => Array.from(document.querySelectorAll("button")).find((b) => b.textContent === name);

it("lists properties with the §11.7 columns, search, Show archived and Add property", async () => {
  const { root, calls } = await mount("admin", { data: [property], page: 1, pageSize: 50, total: 1 });
  expect(document.querySelector("h1")?.textContent).toBe("Properties");
  const table = document.querySelector("table") as HTMLElement;
  expect(Array.from(table.querySelectorAll("th")).map((h) => h.textContent)).toEqual([
    "Property", "Address", "Owner", "Type", "Units", "Occupied", "Responsible landlords",
  ]);
  expect(table.querySelector("a[href='/properties/p1']")?.textContent).toBe("Court Plaza");
  expect(Array.from(table.querySelectorAll("tbody td")).map((c) => c.textContent)).toEqual([
    "Court Plaza", "1 Elm Street, Brooklyn, NY 11201", "Acme LLC", "Residential", "3", "0", "Ann, Bob",
  ]);
  expect(document.querySelector("label[for=search-properties]")?.textContent).toBe("Search properties");
  expect(buttonNamed("Add property")).toBeDefined();
  const box = document.querySelector("input[type=checkbox]") as HTMLInputElement;
  await act(async () => box.click());
  await act(async () => void (await new Promise((r) => setTimeout(r, 100))));
  expect(calls.at(-1)).toContain("archived=true");
  await act(async () => root.unmount());
});

it("shows the empty state, and hides Add property for the Smoke user", async () => {
  const { root } = await mount("smoke", empty);
  expect(document.querySelector("tbody")?.textContent).toBe("No properties yet. Add a property or import a spreadsheet.");
  expect(buttonNamed("Add property")).toBeUndefined();
  await act(async () => root.unmount());
});

it("a failed load shows the error with a Try again button that reloads the list", async () => {
  let fail = true;
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    calls.push(url);
    if (url === "/api/me") return json({ id: "u", name: "Ann", email: "a@x.com", role: "admin", status: "active" });
    return fail ? new Response("{}", { status: 500 }) : json({ data: [property], page: 1, pageSize: 50, total: 1 });
  });
  queryClient.clear();
  document.body.innerHTML = '<div id="root"></div>';
  const root = createRoot(document.getElementById("root") as HTMLElement);
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/properties"]}>
          <Routes>
            <Route path="/properties" element={<Properties />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await act(async () => void (await new Promise((r) => setTimeout(r, 100))));
  expect(document.querySelector("[role=alert]")?.textContent).toBe("Something went wrong. Please try again.");
  fail = false;
  await act(async () => buttonNamed("Try again")?.click());
  await act(async () => void (await new Promise((r) => setTimeout(r, 100))));
  expect(document.querySelector("tbody")?.textContent).toContain("Court Plaza");
  await act(async () => root.unmount());
});
