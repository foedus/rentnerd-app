// @vitest-environment happy-dom
import { QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { queryClient } from "../App";
import { OwnerDetail } from "./OwnerDetail";
import { OwnerForm } from "./OwnerForm";
import { Owners } from "./Owners";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => vi.unstubAllGlobals());

const owner = {
  id: "11111111-1111-4111-8111-111111111111", version: 3, name: "Acme LLC", ownerType: "LLC", addressLine1: "1 A St", addressLine2: null,
  city: "Brooklyn", state: "NY", zip: "11201", email: null, phone: null, signatoryName: null, signatoryTitle: null, notes: null,
  archivedAt: null, properties: [] as { id: string; name: string }[], referenced: false,
};
const me = { id: "u", name: "Ann", email: "a@x.com", role: "admin", status: "active" };
const json = (v: unknown, status = 200) => Response.json(v, { status });

async function mount(path: string, fetchImpl: (url: string, init?: RequestInit) => Promise<Response>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return url === "/api/me" ? json(me) : fetchImpl(url, init);
  });
  queryClient.clear();
  document.body.innerHTML = '<div id="root"></div>';
  const root = createRoot(document.getElementById("root") as HTMLElement);
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/owners" element={<Owners />} />
            <Route path="/owners/new" element={<OwnerForm />} />
            <Route path="/owners/:id" element={<OwnerDetail />} />
            <Route path="/owners/:id/edit" element={<OwnerForm />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await settle();
  return { root, calls };
}
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 30))));
const buttons = () => Array.from(document.querySelectorAll("button"));
const buttonNamed = (name: string) => buttons().find((b) => b.textContent === name) as HTMLButtonElement | undefined;
const setValue = (el: HTMLInputElement | HTMLSelectElement, v: string) => {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, v);
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
};

it("lists owners with the §11.16 columns, search, Show archived and Add owner", async () => {
  const { root, calls } = await mount("/owners", async () =>
    json({ data: [{ ...owner, properties: [{ id: "p1", name: "12 Elm St" }] }], page: 1, pageSize: 50, total: 1 }),
  );
  expect(document.querySelector("h1")?.textContent).toBe("Owners");
  const table = document.querySelector("table") as HTMLElement;
  expect(Array.from(table.querySelectorAll("th")).map((h) => h.textContent)).toEqual(["Owner name", "Owner type", "City", "Properties"]);
  expect(table.querySelector("a[href='/owners/" + owner.id + "']")?.textContent).toBe("Acme LLC");
  expect(table.textContent).toContain("12 Elm St");
  expect(document.querySelector("label[for=search-owners]")?.textContent).toBe("Search owners");
  expect(buttonNamed("Add owner")).toBeDefined();
  const box = Array.from(document.querySelectorAll("input[type=checkbox]"))[0] as HTMLInputElement;
  await act(async () => box.click());
  await settle();
  expect(calls.at(-1)?.url).toContain("archived=true");
  await act(async () => root.unmount());
});

it("shows the empty state", async () => {
  const { root } = await mount("/owners", async () => json({ data: [], page: 1, pageSize: 50, total: 0 }));
  expect(document.querySelector("tbody")?.textContent).toBe("No owners yet.");
  await act(async () => root.unmount());
});

it("an empty owner form shows the error summary with every required field", async () => {
  const { root, calls } = await mount("/owners/new", async () => json({}));
  await act(async () => buttonNamed("Save owner")?.click());
  await settle();
  expect(document.body.textContent).toContain("There is a problem");
  const links = Array.from(document.querySelectorAll("[role=alert] a")).map((a) => a.getAttribute("href"));
  expect(links).toEqual(["#field-name", "#field-ownerType", "#field-addressLine1", "#field-city", "#field-state", "#field-zip"]);
  expect(calls.some((c) => c.init?.method === "POST")).toBe(false);
  expect(buttonNamed("Cancel")).toBeDefined();
  expect(document.querySelector("label[for=field-name]")?.textContent).toBe("Owner name (required)");
  await act(async () => root.unmount());
});

it("saves a new owner with the typed values", async () => {
  const { root, calls } = await mount("/owners/new", async (_url, init) => (init?.method === "POST" ? json(owner, 201) : json(owner)));
  const fill = (id: string, v: string) => setValue(document.getElementById(id) as HTMLInputElement, v);
  await act(async () => {
    fill("field-name", "Acme LLC");
    setValue(document.getElementById("field-ownerType") as HTMLSelectElement, "LLC");
    fill("field-addressLine1", "1 A St");
    fill("field-city", "Brooklyn");
    fill("field-state", "ny");
    fill("field-zip", "11201");
  });
  await act(async () => buttonNamed("Save owner")?.click());
  await settle();
  const post = calls.find((c) => c.init?.method === "POST");
  expect(JSON.parse(String(post?.init?.body))).toMatchObject({ name: "Acme LLC", ownerType: "LLC", state: "NY", zip: "11201" });
  expect(document.querySelector("h1")?.textContent).toBe("Acme LLC");
  expect(document.querySelector("[role=status]")?.textContent).toBe("Owner saved.");
  await act(async () => root.unmount());
});

it("edit loads the owner and sends its version", async () => {
  const { root, calls } = await mount(`/owners/${owner.id}/edit`, async (_url, init) =>
    init?.method === "PATCH" ? json({ ...owner, version: 4 }) : json(owner),
  );
  expect((document.getElementById("field-name") as HTMLInputElement).value).toBe("Acme LLC");
  await act(async () => buttonNamed("Save owner")?.click());
  await settle();
  const patch = calls.find((c) => c.init?.method === "PATCH");
  expect(JSON.parse(String(patch?.init?.body))).toMatchObject({ name: "Acme LLC", version: 3 });
  await act(async () => root.unmount());
});

it("detail: Delete owner is unavailable with a reason while properties use the owner", async () => {
  const used = { ...owner, properties: [{ id: "p1", name: "12 Elm St" }] };
  const { root } = await mount(`/owners/${owner.id}`, async () => json(used));
  expect(document.querySelector("h1")?.textContent).toBe("Acme LLC");
  const del = buttonNamed("Delete owner") as HTMLButtonElement;
  expect(del.getAttribute("aria-disabled")).toBe("true");
  const reason = document.getElementById(del.getAttribute("aria-describedby") ?? "");
  expect(reason?.textContent).toBe("Owners used by properties or units can only be archived");
  await act(async () => root.unmount());
});

it("detail: a refused archive shows the message and links to the properties", async () => {
  const { root } = await mount(`/owners/${owner.id}`, async (_url, init) =>
    init?.method === "POST"
      ? json({ error: { code: "CONFLICT", message: "Change the owner on these properties before archiving this owner:", properties: [{ id: "p1", name: "12 Elm St" }] } }, 409)
      : json(owner),
  );
  await act(async () => buttonNamed("Archive owner")?.click());
  await settle();
  expect(document.body.textContent).toContain("Change the owner on these properties before archiving this owner:");
  expect(document.querySelector("[role=alert] a")?.textContent).toBe("12 Elm St");
  await act(async () => root.unmount());
});

it("detail: an archived owner offers Restore owner", async () => {
  const { root } = await mount(`/owners/${owner.id}`, async () => json({ ...owner, archivedAt: "2026-10-01T00:00:00Z" }));
  expect(buttonNamed("Restore owner")).toBeDefined();
  expect(buttonNamed("Archive owner")).toBeUndefined();
  await act(async () => root.unmount());
});

it("hides write buttons from the Smoke user", async () => {
  vi.stubGlobal("fetch", async (url: string) => (url === "/api/me" ? json({ ...me, role: "smoke" }) : json(owner)));
  queryClient.clear();
  document.body.innerHTML = '<div id="root"></div>';
  const root = createRoot(document.getElementById("root") as HTMLElement);
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/owners/${owner.id}`]}>
          <Routes><Route path="/owners/:id" element={<OwnerDetail />} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await settle();
  expect(buttonNamed("Edit owner")).toBeUndefined();
  expect(buttonNamed("Archive owner")).toBeUndefined();
  await act(async () => root.unmount());
});

it("edit: Reload after a conflict shows the latest version in the form", async () => {
  let current = owner;
  const { root } = await mount(`/owners/${owner.id}/edit`, async (_url, init) =>
    init?.method === "PATCH" ? json({ error: { code: "CONFLICT", message: "x" } }, 409) : json(current),
  );
  await act(async () => buttonNamed("Save owner")?.click());
  await settle();
  expect(document.body.textContent).toContain("Someone else changed this record.");
  current = { ...owner, version: 4, name: "Renamed LLC" };
  await act(async () => buttonNamed("Reload")?.click());
  await settle();
  expect((document.getElementById("field-name") as HTMLInputElement).value).toBe("Renamed LLC");
  expect(document.body.textContent).not.toContain("Someone else changed this record.");
  await act(async () => root.unmount());
});

it("list marks archived owners", async () => {
  const { root } = await mount("/owners", async () =>
    json({ data: [{ ...owner, archivedAt: "2026-10-01T00:00:00Z" }], page: 1, pageSize: 50, total: 1 }),
  );
  expect(document.querySelector("tbody td")?.textContent).toBe("Acme LLC (archived)");
  await act(async () => root.unmount());
});

it("detail: deleting goes back to the list with 'Owner deleted.'", async () => {
  const { root } = await mount(`/owners/${owner.id}`, async (_url, init) =>
    init?.method === "DELETE" ? new Response(null, { status: 204 }) : json({ data: [], page: 1, pageSize: 50, total: 0, ...owner }),
  );
  await act(async () => buttonNamed("Delete owner")?.click());
  await settle();
  const confirm = Array.from(document.querySelectorAll('[role=dialog] button')).find((b) => b.textContent === "Delete") as HTMLElement;
  await act(async () => confirm.click());
  await settle();
  expect(document.querySelector("h1")?.textContent).toBe("Owners");
  expect(document.querySelector("[role=status]")?.textContent).toBe("Owner deleted.");
  await act(async () => root.unmount());
});
