// @vitest-environment happy-dom
import { QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { queryClient } from "../App";
import { Leases } from "./Leases";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => vi.unstubAllGlobals());

const me = { id: "u", name: "Ann", email: "a@x.com", role: "admin", status: "active" };
const row = {
  id: "11111111-1111-4111-8111-111111111111", propertyName: "Oak House", unitId: "22222222-2222-4222-8222-222222222222", unitLabel: "1A",
  currentTenants: [{ tenantId: "t", displayName: "Ann Lee" }], startDate: "2026-01-01", effectiveEndDate: "2026-12-31", currentRentCents: 215000,
  statusLabel: "Active · Archived",
};

async function mount() {
  const urls: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    if (url === "/api/me") return Response.json(me);
    if (url.startsWith("/api/properties")) return Response.json({ data: [{ id: "p1", name: "Oak House" }], page: 1, pageSize: 200, total: 1 });
    urls.push(url);
    return Response.json({ data: [row], page: 1, pageSize: 50, total: 1 });
  });
  queryClient.clear();
  document.body.innerHTML = '<div id="root"></div>';
  await act(async () => {
    createRoot(document.getElementById("root") as HTMLElement).render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <Leases />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
  return urls;
}

const box = (name: string) => [...document.querySelectorAll("label")].find((l) => l.textContent === name)?.querySelector("input") as HTMLInputElement;

it("hides Ended by default, lists the columns, and asks for ended leases once Ended is checked", async () => {
  const urls = await mount();
  expect(urls[0]).toContain("status=active");
  expect(urls[0]).not.toContain("status=ended");
  expect(urls[0]).toContain("archived=false");
  expect([...document.querySelectorAll("th")].map((th) => th.textContent)).toEqual(["Property", "Unit", "Tenants", "Start", "Effective end", "Current rent", "Status"]);
  expect(document.querySelector("tbody")?.textContent).toContain("Active · Archived");
  expect(box("Ended").checked).toBe(false);
  expect(box("Show archived").checked).toBe(false);
  await act(async () => box("Ended").click());
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
  expect(urls.at(-1)).toContain("status=ended&status=ended_superseded");
  await act(async () => box("Show archived").click());
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
  expect(urls.at(-1)).toContain("archived=true");
});

it("shows no leases without asking the server when every status is unchecked", async () => {
  const urls = await mount();
  const before = urls.length;
  for (const name of ["Upcoming", "Active", "Month-to-month", "Needs decision"]) await act(async () => box(name).click());
  expect(document.body.textContent).toContain("No leases match these filters.");
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
  expect(urls.slice(before).every((u) => u.includes("status="))).toBe(true);
  expect(urls.at(-1)).toBe("/api/leases?page=1&archived=false&status=needs_decision");
});
