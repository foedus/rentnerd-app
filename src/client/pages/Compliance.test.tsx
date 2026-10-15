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

const type = { id: "t1", name: "Bed Bug Annual Filing", scheduleType: "annual_date", dueMonth: 12, dueDay: 31, intervalMonths: null };
const item = { id: "i1", propertyId: "p1", propertyName: "Court Plaza", applicable: true, nextDueDate: "2026-12-31", notes: null, version: 1, status: "Upcoming", lastCompletedOn: null, completionCount: 0, type, responsible: [{ id: "u1", name: "Ann Lord", email: "a@x.test" }] };
const wait = () => act(async () => void (await new Promise((r) => setTimeout(r, 100))));

function stub(calls: string[], role = "admin") {
  vi.stubGlobal("fetch", async (url: string) => {
    calls.push(url);
    const body = url.startsWith("/api/compliance/items") ? { data: [item], page: 1, pageSize: 50, total: 1 }
      : url.startsWith("/api/properties") ? { data: [{ id: "p1", name: "Court Plaza" }] }
      : url.startsWith("/api/me") ? { role }
      : [{ id: "u1", name: "Ann Lord", email: "a@x.test" }];
    return new Response(JSON.stringify(body), { status: 200 });
  });
}

async function render() {
  const el = document.createElement("div");
  document.body.append(el);
  await act(async () => createRoot(el).render(<QueryClientProvider client={queryClient}><MemoryRouter><Compliance /></MemoryRouter></QueryClientProvider>));
  await wait();
  return el;
}

it("lists items with the default statuses and the spec's columns", async () => {
  const calls: string[] = [];
  stub(calls);
  const el = await render();
  expect(calls.some((u) => u.includes("status=Overdue%2CDue+soon%2CUpcoming"))).toBe(true);
  const heads = Array.from(el.querySelectorAll("th")).map((h) => h.textContent);
  expect(heads.slice(0, 6)).toEqual(["Property", "Item", "Due date", "Status", "Last completed", "Responsible landlords"]);
  expect(el.querySelector("table")?.textContent).toContain("Ann Lord");
  expect(Array.from(el.querySelectorAll("input[type=checkbox]")).map((c) => (c as HTMLInputElement).checked)).toEqual([true, true, true, false, false, false]);
});

it("sends the chosen landlord as a filter", async () => {
  const calls: string[] = [];
  stub(calls);
  const el = await render();
  const select = el.querySelector("#due-landlord") as HTMLSelectElement;
  await act(async () => {
    select.value = "u1";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await wait();
  expect(calls.some((u) => u.includes("responsibleUserId=u1"))).toBe(true);
});

const markDone = (el: HTMLElement) => Array.from(el.querySelectorAll("button")).find((b) => b.textContent === "Mark done");

it("opens Mark done for a row", async () => {
  stub([]);
  queryClient.setQueryData(["me"], { role: "admin" });
  const el = await render();
  await act(async () => markDone(el)?.click());
  await wait();
  expect(document.body.textContent).toContain("Mark done – Bed Bug Annual Filing – Court Plaza");
  expect(document.body.textContent).toContain("Completed on");
});

it("hides the row actions from the Smoke user", async () => {
  stub([], "smoke");
  queryClient.setQueryData(["me"], { role: "smoke" });
  const el = await render();
  expect(el.querySelector("table")?.textContent).toContain("Court Plaza");
  expect(markDone(el)).toBeUndefined();
});

it("loads every page of property names for the Property filter", async () => {
  const pages: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    if (!url.startsWith("/api/properties")) return new Response(JSON.stringify(url.startsWith("/api/compliance") ? { data: [], page: 1, pageSize: 50, total: 0 } : url.startsWith("/api/people") ? [] : { role: "admin" }), { status: 200 });
    pages.push(url);
    const first = url.includes("page=1");
    return new Response(JSON.stringify({ data: first ? [{ id: "a", name: "A" }] : [{ id: "b", name: "B" }], total: 2 }), { status: 200 });
  });
  const el = await render();
  expect(pages.length).toBe(2);
  expect(Array.from(el.querySelectorAll("#due-property option")).map((o) => o.textContent)).toEqual(["All properties", "A", "B"]);
});

it("keeps what was typed and uses the latest version after a version conflict", async () => {
  const patches: { version?: number; nextDueDate?: string }[] = [];
  let version = 1;
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    if (init?.method === "PATCH") {
      patches.push(JSON.parse(String(init.body)));
      if (patches.length === 1) {
        version = 2; // someone else saved in the meantime
        return new Response(JSON.stringify({ error: { code: "CONFLICT" } }), { status: 409 });
      }
      return new Response("{}", { status: 200 });
    }
    const body = url.startsWith("/api/compliance/items") ? { data: [{ ...item, version }], page: 1, pageSize: 50, total: 1 }
      : url.startsWith("/api/properties") ? { data: [{ id: "p1", name: "Court Plaza" }] }
      : url.startsWith("/api/me") ? { role: "admin" }
      : [];
    return new Response(JSON.stringify(body), { status: 200 });
  });
  queryClient.setQueryData(["me"], { role: "admin" });
  // An older cached filter result still holds version 1 of the item.
  queryClient.setQueryData(["compliance-due", "old", "", ["Overdue"], 1], { data: [item], page: 1, pageSize: 50, total: 1 });
  const el = await render();
  const press = async (label: string) => {
    await act(async () => Array.from(document.querySelectorAll("button")).find((b) => b.textContent === label)?.click());
    await wait();
  };
  await act(async () => Array.from(el.querySelectorAll("button")).find((b) => b.textContent === "Set due date")?.click());
  await wait();
  const input = document.querySelector("dialog input, [role=dialog] input[type=date]") as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "2027-03-01");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await press("Save");
  await press("Reload");
  expect((document.querySelector("[role=dialog] input[type=date]") as HTMLInputElement).value).toBe("2027-03-01");
  await press("Save");
  expect(patches.map((p) => p.version)).toEqual([1, 2]);
  expect(patches[1]?.nextDueDate).toBe("2027-03-01");
});
