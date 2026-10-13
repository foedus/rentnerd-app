// @vitest-environment happy-dom
import { QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { queryClient } from "../App";
import { PropertyForm } from "./PropertyForm";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => vi.unstubAllGlobals());

const ME = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";
const OWNER = "33333333-3333-4333-8333-333333333333";
const NEW = "44444444-4444-4444-8444-444444444444";
const me = { id: ME, name: "Ann", email: "a@x.com", role: "admin", status: "active" };
const people = [{ id: ME, name: "Ann", email: "a@x.com" }, { id: BOB, name: "Bob", email: "b@x.com" }];
const json = (v: unknown, status = 200) => Response.json(v, { status });

const existing = {
  id: "p1", version: 4, name: "Court Plaza", street: "1 Elm St", city: "Brooklyn", state: "NY", zip: "11201", inNyc: true, bbl: null,
  yearBuilt: 1925, ownerId: OWNER, owner: { id: OWNER, name: "Acme LLC" }, responsibleUserIds: [BOB], responsible: [people[1]],
  purchasePriceCents: null, purchaseDate: null, notes: null,
};

async function mount(onPost: (body: Record<string, unknown>) => Response, path = "/properties/new") {
  const posts: Record<string, unknown>[] = [];
  const urls: string[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    urls.push(url);
    if (url === "/api/me") return json(me);
    if (url === "/api/people") return json(people);
    if (url === "/api/properties/p1" && !init?.method) return json(existing);
    if (url.startsWith("/api/owners?")) {
      const data = [{ id: OWNER, name: "Acme LLC" }, ...(posts.length > 0 ? [{ id: NEW, name: "Fresh LLC" }] : [])];
      return json({ data, page: 1, pageSize: 200, total: data.length });
    }
    if (init?.method === "POST" || init?.method === "PATCH") {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      posts.push(body);
      return onPost(body);
    }
    return json({});
  });
  queryClient.clear();
  document.body.innerHTML = '<div id="root"></div>';
  const root = createRoot(document.getElementById("root") as HTMLElement);
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/properties/new" element={<PropertyForm />} />
            <Route path="/properties/:id/edit" element={<PropertyForm />} />
            <Route path="/properties/:id" element={<h1>Detail</h1>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await settle();
  return { posts, urls };
}
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 30))));
const byId = (id: string) => document.getElementById(id) as HTMLInputElement & HTMLSelectElement;
const button = (name: string) => Array.from(document.querySelectorAll("button")).find((b) => b.textContent === name) as HTMLButtonElement;
const setValue = (el: HTMLInputElement | HTMLSelectElement, v: string) => {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, v);
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
};
const fillRequired = async () => {
  await act(async () => {
    setValue(byId("field-name"), "Court Plaza");
    setValue(byId("field-street"), "1 Elm St");
    setValue(byId("field-city"), "Brooklyn");
    setValue(byId("field-state"), "ny");
    setValue(byId("field-zip"), "11201");
    setValue(byId("field-ownerId"), OWNER);
  });
};
const submit = async () => {
  await act(async () => button("Save property").click());
  await settle();
};

it("shows the §11.8 fields, offers only the owners from the non-archived list, and defaults Responsible landlords to me", async () => {
  const { urls } = await mount(() => json({}));
  expect(document.querySelector("h1")?.textContent).toBe("Add property");
  const labels = Array.from(document.querySelectorAll("label, legend")).map((l) => l.textContent);
  for (const l of [
    "Property name (required)", "Street address (required)", "City (required)", "State (required)", "ZIP code (required)",
    "Located in New York City", "Borough-Block-Lot (BBL)", "Year built", "Owner (required)", "Responsible landlords (required)",
    "Purchase price", "Purchase date", "Notes", "Single-unit property",
  ]) expect(labels).toContain(l);
  expect(urls).toContain("/api/owners?archived=false&pageSize=200&page=1");
  expect(Array.from(byId("field-ownerId").options).map((o) => o.textContent)).toEqual(["Select…", "Acme LLC"]);
  const boxes = Array.from(document.querySelectorAll("fieldset input[type=checkbox]")) as HTMLInputElement[];
  expect(boxes.map((b) => b.closest("label")?.textContent)).toEqual(["Ann (a@x.com)", "Bob (b@x.com)"]);
  expect(boxes.map((b) => b.checked)).toEqual([true, false]);
  expect(byId("field-inNyc").checked).toBe(true);
  expect(button("Add owner")).toBeDefined();
  expect(button("Cancel")).toBeDefined();
});

it("shows plain messages for missing fields and the landlord rule, and posts nothing", async () => {
  const { posts } = await mount(() => json({}));
  await act(async () => (document.querySelector("fieldset input:checked") as HTMLInputElement).click());
  await submit();
  const text = document.body.textContent ?? "";
  for (const m of ["Enter the property name.", "Choose an owner.", "Choose at least one responsible landlord."]) expect(text).toContain(m);
  expect(posts).toEqual([]);
});

it("posts the values with cents, year and chosen landlords, then opens the new property", async () => {
  const { posts } = await mount(() => json({ id: "p1" }, 201));
  await fillRequired();
  await act(async () => {
    setValue(byId("field-yearBuilt"), "1925");
    setValue(byId("field-purchasePriceCents"), "250,000.50");
    (document.querySelectorAll("fieldset input[type=checkbox]")[1] as HTMLInputElement).click();
  });
  await submit();
  expect(posts).toHaveLength(1);
  expect(posts[0]).toMatchObject({
    name: "Court Plaza", street: "1 Elm St", city: "Brooklyn", state: "NY", zip: "11201", inNyc: true, yearBuilt: 1925,
    ownerId: OWNER, responsibleUserIds: [ME, BOB], purchasePriceCents: 25000050, bbl: null, notes: null,
  });
  expect(posts[0]).not.toHaveProperty("singleUnitUse");
  expect(document.querySelector("h1")?.textContent).toBe("Detail");
});

it("shows Use when Single-unit property is checked, requires it, and sends it", async () => {
  const { posts } = await mount(() => json({ id: "p1" }, 201));
  expect(byId("field-singleUnitUse")).toBeNull();
  await act(async () => byId("field-singleUnit").click());
  expect(byId("field-singleUnitUse")).not.toBeNull();
  await fillRequired();
  await submit();
  expect(document.body.textContent).toContain("Choose Residential or Commercial.");
  expect(posts).toEqual([]);
  await act(async () => setValue(byId("field-singleUnitUse"), "Commercial"));
  await submit();
  expect(posts[0]).toMatchObject({ singleUnitUse: "Commercial" });
});

it("says so when the purchase price isn't an amount instead of dropping it", async () => {
  const { posts } = await mount(() => json({ id: "p1" }, 201));
  await fillRequired();
  await act(async () => setValue(byId("field-purchasePriceCents"), "abc"));
  await submit();
  expect(document.body.textContent).toContain("Enter an amount.");
  expect(posts).toEqual([]);
});

it("shows the duplicate-name message from the server on the Property name field", async () => {
  await mount(() => json({ error: { code: "CONFLICT", message: "x", fields: { name: "A property with this name already exists." } } }, 409));
  await fillRequired();
  await submit();
  expect(byId("field-name-error").textContent).toBe("A property with this name already exists.");
  expect(document.querySelector("h1")?.textContent).toBe("Add property");
});

it("adds an owner in a dialog and selects it", async () => {
  const { posts } = await mount((body) => json({ id: NEW, version: 1, name: body.name, properties: [] }, 201));
  await act(async () => button("Add owner").click());
  await settle();
  const dialog = document.querySelector("[role=dialog]") as HTMLElement;
  expect(dialog.textContent).toContain("Owner name (required)");
  expect(dialog.closest("form")).toBeNull();
  expect(dialog.querySelector("label[for=owner-dialog-field-name]")?.textContent).toBe("Owner name (required)");
  expect(document.querySelectorAll("[id=field-name]")).toHaveLength(1);
  const fill = (id: string, v: string) => setValue(dialog.querySelector(`#owner-dialog-${id}`) as HTMLInputElement, v);
  await act(async () => {
    fill("field-name", "Fresh LLC");
    setValue(dialog.querySelector("#owner-dialog-field-ownerType") as HTMLSelectElement, "LLC");
    fill("field-addressLine1", "1 A St");
    fill("field-city", "Brooklyn");
    fill("field-state", "NY");
    fill("field-zip", "11201");
  });
  await act(async () => button("Save owner").click());
  await settle();
  expect(posts[0]).toMatchObject({ name: "Fresh LLC" });
  expect(document.querySelector("[role=dialog]")).toBeNull();
  expect(byId("field-ownerId").value).toBe(NEW);
  expect(document.querySelector("h1")?.textContent).toBe("Add property");
});

it("edits an existing property: prefilled, no Single-unit option, PATCH carries the version", async () => {
  const { posts } = await mount(() => json({ id: "p1" }), "/properties/p1/edit");
  expect(document.querySelector("h1")?.textContent).toBe("Edit property");
  expect(byId("field-name").value).toBe("Court Plaza");
  expect(byId("field-yearBuilt").value).toBe("1925");
  expect(byId("field-ownerId").value).toBe(OWNER);
  expect((document.querySelectorAll("fieldset input[type=checkbox]")[1] as HTMLInputElement).checked).toBe(true);
  expect(byId("field-singleUnit")).toBeNull();
  await act(async () => setValue(byId("field-city"), "Queens"));
  await submit();
  expect(posts[0]).toMatchObject({ city: "Queens", version: 4, responsibleUserIds: [BOB] });
  expect(posts[0]).not.toHaveProperty("singleUnitUse");
  expect(document.querySelector("h1")?.textContent).toBe("Detail");
});

it("shows the changed-by-someone-else message with Reload on a 409 without field messages", async () => {
  await mount(() => json({ error: { code: "CONFLICT", message: "changed" } }, 409), "/properties/p1/edit");
  await submit();
  expect(document.body.textContent).toContain("Someone else changed this record.");
  expect(button("Reload")).toBeDefined();
});

it("keeps an archived current owner selectable when editing", async () => {
  await mount(() => json({}), "/properties/p1/edit");
  expect(Array.from(byId("field-ownerId").options).map((o) => o.textContent)).toContain("Acme LLC");
});
