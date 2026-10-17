// @vitest-environment happy-dom
import { QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { queryClient } from "../App";
import { ExtensionForm } from "./ExtensionForm";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => vi.unstubAllGlobals());

const json = (v: unknown, status = 200) => Response.json(v, { status });
const lease = { id: "l1", version: 4, extensions: [{ id: "e1", startDate: "2027-11-01" }], status: "active", moveOutDate: null, propertyName: "Court Plaza", unitLabel: "2R", effectiveEndDate: "2027-10-31" };
const extension = { id: "e1", leaseId: "l1", startDate: "2027-11-01", endDate: "2028-10-31", baseRentCents: 225000, increaseType: "none", increasePercent: null, rentSteps: [], notes: "Renewal", tenants: [] };

async function mount(path: string, route: string, handle: (url: string, init?: RequestInit) => Response | undefined = () => undefined, over: object = {}) {
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const custom = handle(url, init);
    if (custom) return custom;
    if (url === "/api/leases/l1") return json({ ...lease, ...over });
    if (url === "/api/extensions/e1") return json(extension);
    return json({ error: { message: "x" } }, 404);
  });
  queryClient.clear();
  document.body.innerHTML = '<div id="root"></div>';
  const root = createRoot(document.getElementById("root") as HTMLElement);
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path={route} element={<ExtensionForm />} />
            <Route path="/leases/:id" element={<p>Lease page</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await act(async () => void (await new Promise((r) => setTimeout(r, 100))));
}
const input = (label: string) => Array.from(document.querySelectorAll("label")).find((l) => l.textContent?.startsWith(label))?.control as HTMLInputElement;
const button = (name: string) => Array.from(document.querySelectorAll("button")).find((b) => b.textContent === name);
async function type(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const press = async (el: Element | undefined) => {
  await act(async () => void el?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  await act(async () => void (await new Promise((r) => setTimeout(r, 50))));
};

it("starts the extension the day after the effective end, with the spec's fields and buttons", async () => {
  await mount("/leases/l1/extensions/new", "/leases/:id/extensions/new");
  expect(document.querySelector("h1")?.textContent).toBe("Add extension – Court Plaza Unit 2R");
  expect(input("Extension start date").value).toBe("2027-11-01");
  expect(input("Extension end date").value).toBe("");
  for (const l of ["Monthly rent", "Notes"]) expect(input(l), l).toBeTruthy();
  expect(document.body.textContent).toContain("Rent increases");
  expect(button("Save extension")).toBeTruthy();
  expect(button("Cancel")).toBeTruthy();
});

it("refuses an empty form without calling the server", async () => {
  const posts: string[] = [];
  await mount("/leases/l1/extensions/new", "/leases/:id/extensions/new", (url, init) => (init?.method === "POST" ? (posts.push(url), undefined) : undefined));
  await press(button("Save extension"));
  expect(document.body.textContent).toContain("Enter the extension end date.");
  expect(document.body.textContent).toContain("Enter the monthly rent.");
  expect(posts).toHaveLength(0);
});

it("posts only dates, rent, increases, notes and the lease version, then returns to the lease", async () => {
  const posts: { url: string; body: Record<string, unknown> }[] = [];
  await mount("/leases/l1/extensions/new", "/leases/:id/extensions/new", (url, init) => {
    if (init?.method !== "POST") return undefined;
    posts.push({ url, body: JSON.parse(String(init.body)) });
    return json({ id: "e1" }, 201);
  });
  await type(input("Extension end date"), "2028-10-31");
  await type(input("Monthly rent"), "2250");
  await press(button("Save extension"));
  expect(posts).toHaveLength(1);
  expect(posts[0]?.url).toBe("/api/leases/l1/extensions");
  expect(posts[0]?.body).toEqual({ startDate: "2027-11-01", endDate: "2028-10-31", baseRentCents: 225000, increaseType: "none", increasePercent: null, rentSteps: [], notes: null, version: 4 });
  expect(document.body.textContent).toContain("Lease page");
});

it("shows the server's start-date message next to the field", async () => {
  await mount("/leases/l1/extensions/new", "/leases/:id/extensions/new", (_url, init) =>
    init?.method === "POST" ? json({ error: { message: "Check the fields.", fields: { startDate: "Extension must start on or after Nov 1, 2027." } } }, 422) : undefined,
  );
  await type(input("Extension start date"), "2027-10-15");
  await type(input("Extension end date"), "2028-10-31");
  await type(input("Monthly rent"), "2250");
  await press(button("Save extension"));
  expect(document.body.textContent).toContain("Extension must start on or after Nov 1, 2027.");
  expect(document.body.textContent).not.toContain("Lease page");
});

it("says so, with Reload, when someone else saved first", async () => {
  await mount("/leases/l1/extensions/new", "/leases/:id/extensions/new", (_url, init) =>
    init?.method === "POST" ? json({ error: { message: "This lease was changed by someone else. Reload to see the latest version." } }, 409) : undefined,
  );
  await type(input("Extension end date"), "2028-10-31");
  await type(input("Monthly rent"), "2250");
  await press(button("Save extension"));
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("Someone else changed this record. Reload to see the latest version.");
  expect(button("Reload")).toBeTruthy();
});

it("won't add to an ended lease or one with a move-out date", async () => {
  await mount("/leases/l1/extensions/new", "/leases/:id/extensions/new", () => undefined, { status: "ended" });
  expect(document.querySelector('[role="alert"]')?.textContent).toBe("Extensions can't be added to an ended lease or one with a move-out date.");
  await mount("/leases/l1/extensions/new", "/leases/:id/extensions/new", () => undefined, { moveOutDate: "2027-05-01" });
  expect(button("Save extension")).toBeUndefined();
});

it("edits an extension: fields filled in, PATCH to the extension with the lease version", async () => {
  const patches: { url: string; body: Record<string, unknown> }[] = [];
  await mount("/extensions/e1/edit", "/extensions/:id/edit", (url, init) => {
    if (init?.method !== "PATCH") return undefined;
    patches.push({ url, body: JSON.parse(String(init.body)) });
    return json({ id: "e1" });
  });
  expect(document.querySelector("h1")?.textContent).toBe("Edit extension – Court Plaza Unit 2R");
  expect(input("Extension end date").value).toBe("2028-10-31");
  expect(input("Monthly rent").value).toBe("$2,250.00");
  expect((document.querySelector("textarea") as HTMLTextAreaElement).value).toBe("Renewal");
  await type(input("Extension end date"), "2028-12-31");
  await press(button("Save extension"));
  expect(patches[0]?.url).toBe("/api/extensions/e1");
  expect(patches[0]?.body).toMatchObject({ endDate: "2028-12-31", baseRentCents: 225000, notes: "Renewal", version: 4 });
});

it("shows a missing extension's message", async () => {
  await mount("/extensions/zz/edit", "/extensions/:id/edit");
  expect(document.querySelector('[role="alert"]')?.textContent).toBe("Extension not found.");
});

it("won't edit an extension that is not the latest", async () => {
  await mount("/extensions/e1/edit", "/extensions/:id/edit", () => undefined, { extensions: [{ id: "e1", startDate: "2027-11-01" }, { id: "e2", startDate: "2028-11-01" }] });
  expect(document.querySelector('[role="alert"]')?.textContent).toBe("Only the latest extension can be edited.");
  expect(button("Save extension")).toBeUndefined();
});
