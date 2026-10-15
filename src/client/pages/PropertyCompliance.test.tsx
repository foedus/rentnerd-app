// @vitest-environment happy-dom
import { QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { queryClient } from "../App";
import { PropertyDetail } from "./PropertyDetail";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const property = { id: "p1", name: "Court Plaza", street: "1 Elm", city: "Brooklyn", state: "NY", zip: "11201", archivedAt: null, owner: null, responsible: [], propertyType: "Residential", unitCount: 1, occupiedCount: 0, inNyc: true };
const type = (name: string, scheduleType: string, extra: object = {}) => ({ id: `t-${name}`, name, scheduleType, dueMonth: null, dueDay: null, intervalMonths: null, ...extra });
const item = (id: string, over: object) => ({ id, propertyId: "p1", applicable: true, nextDueDate: null, notes: null, version: 3, status: "Not scheduled", lastCompletedOn: null, completionCount: 0, ...over });
const rows = [
  item("i1", { type: type("Bed Bug Annual Filing", "annual_date", { dueMonth: 12, dueDay: 31 }), nextDueDate: "2026-12-31", status: "Upcoming", lastCompletedOn: "2025-12-15", completionCount: 1 }),
  item("i2", { type: type("Smoke and CO Detector Check", "interval", { intervalMonths: 12 }) }),
  item("i3", { type: type("Storefront Registry Filing", "annual_date", { dueMonth: 6, dueDay: 1 }), applicable: false, status: "Not applicable" }),
];
const history = [{ id: "c1", completedOn: "2025-12-15", notes: "Filed online", completedByName: "Ann" }];
const wait = () => act(async () => void (await new Promise((r) => setTimeout(r, 100))));
const buttonNamed = (name: string, within: ParentNode = document) => Array.from(within.querySelectorAll("button")).find((b) => b.textContent === name) as HTMLButtonElement | undefined;
const rowOf = (text: string) => Array.from(document.querySelectorAll("tr")).find((r) => r.textContent?.includes(text)) as HTMLElement;
const press = (el: HTMLElement) => act(async () => { el.click(); await new Promise((r) => setTimeout(r, 100)); });
const setValue = (el: HTMLInputElement, v: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 50));
  });
const input = (label: string) => {
  const l = Array.from(document.querySelectorAll("[role=dialog] label")).find((x) => x.textContent?.startsWith(label));
  return document.getElementById(l?.getAttribute("for") ?? "") as HTMLInputElement;
};

async function mount(role = "landlord", entry = "/properties/p1?tab=Compliance") {
  const sent: { url: string; method: string; body: unknown }[] = [];
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-12-15T15:00:00Z") });
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (url === "/api/me") return Response.json({ id: "u", name: "Ann", email: "a@x.com", role, status: "active" });
    if (url.startsWith("/api/properties/p1/compliance")) return Response.json({ data: rows, page: 1, pageSize: 3, total: 3 });
    if (url.includes("/completions?")) return Response.json({ data: history, page: 1, pageSize: 200, total: 1 });
    if (method !== "GET") {
      sent.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : null });
      return method === "DELETE" ? new Response(null, { status: 204 }) : Response.json({}, { status: 201 });
    }
    return Response.json(property);
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
  return { root, sent };
}

it("lists each item with its switch, status, due date and last completed date", async () => {
  const { root } = await mount();
  const table = document.querySelector("table[aria-label=Compliance]") as HTMLElement;
  expect(Array.from(table.querySelectorAll("th")).map((h) => h.textContent)).toEqual(["Item", "Applies to this property", "Status", "Due date", "Last completed", "Actions"]);
  const bedBug = rowOf("Bed Bug Annual Filing");
  expect(bedBug.textContent).toContain("Upcoming");
  expect(bedBug.textContent).toContain("Dec 31, 2026");
  expect(bedBug.textContent).toContain("Dec 15, 2025");
  expect((bedBug.querySelector("input[type=checkbox]") as HTMLInputElement).checked).toBe(true);
  expect((rowOf("Storefront").querySelector("input[type=checkbox]") as HTMLInputElement).checked).toBe(false);
  expect(rowOf("Storefront").textContent).toContain("Not applicable");
  await act(async () => root.unmount());
});

it("Mark done prefills today and the suggested next due date, which follows Completed on until edited", async () => {
  const { root, sent } = await mount();
  await press(buttonNamed("Mark done", rowOf("Bed Bug")) as HTMLElement);
  expect(input("Completed on").value).toBe("2026-12-15");
  expect(input("Next due date").value).toBe("2027-12-31");
  await setValue(input("Completed on"), "2028-01-02");
  expect(input("Next due date").value).toBe("2028-12-31");
  await setValue(input("Next due date"), "2029-01-01");
  await setValue(input("Completed on"), "2026-12-15");
  expect(input("Next due date").value).toBe("2029-01-01");
  await setValue(input("Notes"), "Done");
  await press(buttonNamed("Save", document.querySelector("[role=dialog]") as HTMLElement) as HTMLElement);
  expect(sent).toEqual([{ url: "/api/compliance/items/i1/completions", method: "POST", body: { completedOn: "2026-12-15", notes: "Done", nextDueDate: "2029-01-01", version: 3 } }]);
  expect(document.querySelector("[role=dialog]")).toBeNull();
  await act(async () => root.unmount());
});

it("an every-12-months item suggests one year after the completion date", async () => {
  const { root } = await mount();
  await press(buttonNamed("Mark done", rowOf("Smoke and CO")) as HTMLElement);
  expect(input("Next due date").value).toBe("2027-12-15");
  await act(async () => root.unmount());
});

it("Set due date saves the new date, and clearing it makes the item Not scheduled", async () => {
  const { root, sent } = await mount();
  await press(buttonNamed("Set due date", rowOf("Smoke and CO")) as HTMLElement);
  await setValue(input("Next due date"), "2026-10-01");
  await press(buttonNamed("Save", document.querySelector("[role=dialog]") as HTMLElement) as HTMLElement);
  expect(sent[0]).toEqual({ url: "/api/compliance/items/i2", method: "PATCH", body: { nextDueDate: "2026-10-01", version: 3 } });
  await press(buttonNamed("Set due date", rowOf("Bed Bug")) as HTMLElement);
  await setValue(input("Next due date"), "");
  await press(buttonNamed("Save", document.querySelector("[role=dialog]") as HTMLElement) as HTMLElement);
  expect(sent[1]?.body).toEqual({ nextDueDate: null, version: 3 });
  await act(async () => root.unmount());
});

it("the switch sends the new Applies to this property value", async () => {
  const { root, sent } = await mount();
  await press(rowOf("Bed Bug").querySelector("input[type=checkbox]") as HTMLElement);
  expect(sent).toEqual([{ url: "/api/compliance/items/i1", method: "PATCH", body: { applicable: false, version: 3 } }]);
  await act(async () => root.unmount());
});

it("History lists completions and Delete removes one after confirmation", async () => {
  const { root, sent } = await mount();
  await press(buttonNamed("History", rowOf("Bed Bug")) as HTMLElement);
  const dialog = document.querySelector("[role=dialog]") as HTMLElement;
  expect(Array.from(dialog.querySelectorAll("th")).map((h) => h.textContent)).toEqual(["Completed on", "Notes", "Completed by", "Actions"]);
  expect(dialog.textContent).toContain("Dec 15, 2025");
  expect(dialog.textContent).toContain("Filed online");
  await press(buttonNamed("Delete", dialog) as HTMLElement);
  expect(sent).toEqual([]);
  await press(buttonNamed("Delete completion", document.body) as HTMLElement);
  expect(sent).toEqual([{ url: "/api/compliance/completions/c1", method: "DELETE", body: null }]);
  await act(async () => root.unmount());
});

it("the Smoke user sees the rows but no write controls", async () => {
  const { root } = await mount("smoke");
  expect(buttonNamed("Mark done")).toBeUndefined();
  expect(buttonNamed("Set due date")).toBeUndefined();
  expect(buttonNamed("History")).toBeDefined();
  expect((rowOf("Bed Bug").querySelector("input[type=checkbox]") as HTMLInputElement).disabled).toBe(true);
  await act(async () => root.unmount());
});

it("opens the Compliance tab from the lowercase ?tab=compliance link used in emails", async () => {
  const { root } = await mount("landlord", "/properties/p1?tab=compliance");
  expect(document.querySelector("[role=tab][aria-selected=true]")?.textContent).toBe("Compliance");
  expect(document.querySelector("table[aria-label=Compliance]")).not.toBeNull();
  await act(async () => root.unmount());
});
