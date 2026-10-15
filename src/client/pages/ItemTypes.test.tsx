// @vitest-environment happy-dom
import { QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { queryClient } from "../App";
import { Compliance } from "./Compliance";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => {
  vi.unstubAllGlobals();
  queryClient.clear();
  document.body.innerHTML = "";
});

const base = { description: null, nycOnly: true, dueMonth: null, dueDay: null, intervalMonths: null, version: 1, archivedAt: null, hasCompletions: false };
const types = [
  { ...base, id: "t1", name: "HPD Property Registration", appliesTo: "Properties with residential units", scheduleType: "annual_date", dueMonth: 9, dueDay: 1 },
  { ...base, id: "t2", name: "Boiler Inspection", appliesTo: "All properties", scheduleType: "interval", intervalMonths: 12, archivedAt: "2026-01-01T00:00:00Z" },
];
const wait = () => act(async () => void (await new Promise((r) => setTimeout(r, 100))));
const confirmDelete = () => Array.from(document.querySelectorAll("[role=alertdialog] button, [role=dialog] button")).find((b) => b.textContent === "Delete") as HTMLElement | undefined;
const buttonNamed = (label: string) => Array.from(document.querySelectorAll("button")).find((b) => b.textContent === label || b.getAttribute("aria-label") === label);
const setValue = (el: HTMLInputElement | HTMLSelectElement, value: string) =>
  act(async () => {
    const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, value);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });

async function render(role = "admin", onWrite: (url: string, init: RequestInit) => Response | undefined = () => undefined) {
  queryClient.setQueryData(["me"], { role });
  const writes: { url: string; method: string; body?: Record<string, unknown> }[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    if (init?.method && init.method !== "GET") {
      writes.push({ url, method: init.method, body: init.body ? JSON.parse(String(init.body)) : undefined });
      return onWrite(url, init) ?? new Response("{}", { status: 200 });
    }
    const body = url.startsWith("/api/compliance/types") ? { data: types, page: 1, pageSize: 200, total: 2 }
      : url.startsWith("/api/compliance/items") ? { data: [], page: 1, pageSize: 50, total: 0 }
      : url.startsWith("/api/properties") ? { data: [] }
      : url.startsWith("/api/me") ? { role }
      : [];
    return new Response(JSON.stringify(body), { status: 200 });
  });
  const el = document.createElement("div");
  document.body.append(el);
  await act(async () => createRoot(el).render(<QueryClientProvider client={queryClient}><MemoryRouter><Compliance /></MemoryRouter></QueryClientProvider>));
  await wait();
  await act(async () => (Array.from(el.querySelectorAll("[role=tab]")).find((t) => t.textContent === "Item types") as HTMLElement).click());
  await wait();
  return { el, writes };
}

it("shows the notice and the spec's columns, with archived types marked", async () => {
  const { el } = await render();
  expect(el.textContent).toContain("Default dates are starting points. Check current requirements with the relevant agency; RentNerd does not provide legal advice.");
  expect(Array.from(el.querySelectorAll("th")).map((h) => h.textContent)).toEqual(["Name", "Applies to", "NYC only", "Schedule", "Actions"]);
  expect(el.textContent).toContain("Every year on September 1");
  expect(el.textContent).toContain("Boiler Inspection (archived)");
  expect(buttonNamed("Restore – Boiler Inspection")).toBeDefined();
  expect(buttonNamed("Archive – HPD Property Registration")).toBeDefined();
});

it("hides the buttons from the Smoke user", async () => {
  const { el } = await render("smoke");
  expect(el.textContent).toContain("HPD Property Registration");
  expect(buttonNamed("Add item type")).toBeUndefined();
  expect(buttonNamed("Delete – HPD Property Registration")).toBeUndefined();
});

it("asks for a month and day on a yearly schedule, then sends the type", async () => {
  const { writes } = await render();
  await act(async () => buttonNamed("Add item type")?.click());
  await wait();
  const field = (id: string) => document.querySelector(`#item-type-field-${id}`) as HTMLInputElement & HTMLSelectElement;
  await setValue(field("name"), "Roof check");
  await setValue(field("appliesTo"), "All properties");
  await setValue(field("scheduleType"), "annual_date");
  await wait();
  await act(async () => buttonNamed("Save item type")?.click());
  await wait();
  expect(document.body.textContent).toContain("Choose a month and day.");
  expect(writes).toHaveLength(0);
  await setValue(field("dueMonth"), "3");
  await setValue(field("dueDay"), "15");
  await act(async () => buttonNamed("Save item type")?.click());
  await wait();
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({ url: "/api/compliance/types", method: "POST", body: { name: "Roof check", appliesTo: "All properties", nycOnly: false, scheduleType: "annual_date", dueMonth: 3, dueDay: 15 } });
});

it("shows only Repeat every (months) for an interval schedule", async () => {
  await render();
  await act(async () => buttonNamed("Add item type")?.click());
  await wait();
  await setValue(document.querySelector("#item-type-field-scheduleType") as HTMLSelectElement, "interval");
  await wait();
  expect(document.body.textContent).toContain("Repeat every (months)");
  expect(document.body.textContent).not.toContain("Month");
});

it("edits with the current version, archives, and deletes after confirming", async () => {
  const { writes } = await render();
  await act(async () => buttonNamed("Edit – HPD Property Registration")?.click());
  await wait();
  expect((document.querySelector("#item-type-field-dueMonth") as HTMLSelectElement).value).toBe("9");
  await setValue(document.querySelector("#item-type-field-name") as HTMLInputElement, "HPD Registration");
  await act(async () => buttonNamed("Save item type")?.click());
  await wait();
  expect(writes[0]).toMatchObject({ url: "/api/compliance/types/t1", method: "PATCH", body: { name: "HPD Registration", version: 1, dueMonth: 9, dueDay: 1 } });
  await act(async () => buttonNamed("Archive – HPD Property Registration")?.click());
  await wait();
  expect(writes[1]).toMatchObject({ url: "/api/compliance/types/t1/archive", method: "POST", body: { version: 1 } });
  await act(async () => buttonNamed("Delete – HPD Property Registration")?.click());
  await wait();
  expect(writes).toHaveLength(2);
  await act(async () => confirmDelete()?.click());
  await wait();
  expect(writes[2]).toMatchObject({ url: "/api/compliance/types/t1", method: "DELETE" });
});

it("shows the server's reason when a type can't be deleted", async () => {
  const reason = "This item type has completions, so it can't be deleted. Archive it instead.";
  await render("admin", (_url, init) => (init.method === "DELETE" ? new Response(JSON.stringify({ error: { code: "CONFLICT", message: reason } }), { status: 409 }) : undefined));
  await act(async () => buttonNamed("Delete – HPD Property Registration")?.click());
  await wait();
  await act(async () => confirmDelete()?.click());
  await wait();
  expect(document.querySelector("[role=alert]")?.textContent).toBe(reason);
});

it("loads every page of item types", async () => {
  const pages: string[] = [];
  queryClient.setQueryData(["me"], { role: "admin" });
  vi.stubGlobal("fetch", async (url: string) => {
    if (!url.startsWith("/api/compliance/types")) return new Response(JSON.stringify(url.startsWith("/api/me") ? { role: "admin" } : url.startsWith("/api/compliance") || url.startsWith("/api/properties") ? { data: [], page: 1, pageSize: 50, total: 0 } : []), { status: 200 });
    pages.push(url);
    const first = url.includes("page=1");
    return new Response(JSON.stringify({ data: [{ ...types[0], id: first ? "a" : "b", name: first ? "First type" : "Second type" }], total: 2 }), { status: 200 });
  });
  const el = document.createElement("div");
  document.body.append(el);
  await act(async () => createRoot(el).render(<QueryClientProvider client={queryClient}><MemoryRouter><Compliance /></MemoryRouter></QueryClientProvider>));
  await wait();
  await act(async () => (Array.from(el.querySelectorAll("[role=tab]")).find((t) => t.textContent === "Item types") as HTMLElement).click());
  await wait();
  expect(pages).toHaveLength(2);
  expect(el.textContent).toContain("First type");
  expect(el.textContent).toContain("Second type");
});

it("opens on the Item types tab from ?tab=types and writes the tab to the address", async () => {
  queryClient.setQueryData(["me"], { role: "admin" });
  vi.stubGlobal("fetch", async (url: string) =>
    new Response(JSON.stringify(url.startsWith("/api/compliance/types") ? { data: types, total: 2 } : url.startsWith("/api/me") ? { role: "admin" } : url.startsWith("/api/compliance") || url.startsWith("/api/properties") ? { data: [], page: 1, pageSize: 50, total: 0 } : []), { status: 200 }),
  );
  const el = document.createElement("div");
  document.body.append(el);
  await act(async () => createRoot(el).render(<QueryClientProvider client={queryClient}><MemoryRouter initialEntries={["/compliance?tab=types"]}><Compliance /></MemoryRouter></QueryClientProvider>));
  await wait();
  expect(el.querySelector("[role=tab][aria-selected=true]")?.textContent).toBe("Item types");
  expect(el.textContent).toContain("HPD Property Registration");
  await act(async () => (Array.from(el.querySelectorAll("[role=tab]")).find((t) => t.textContent === "Due list") as HTMLElement).click());
  await wait();
  expect(el.querySelector("[role=tab][aria-selected=true]")?.textContent).toBe("Due list");
});
