// @vitest-environment happy-dom
import { QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { queryClient } from "../App";
import { UnitForm } from "./UnitForm";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => vi.unstubAllGlobals());

const OWNER = "33333333-3333-4333-8333-333333333333";
const json = (v: unknown, status = 200) => Response.json(v, { status });
const property = { id: "p1", name: "Court Plaza", responsible: [], owner: null };
const unit = {
  id: "n1", propertyId: "p1", version: 3, label: "3F", use: "Residential", bedrooms: 2, bathrooms: 1.5, squareFeet: null, notes: null,
  ownerOverrideId: null, owner: { id: "o1", name: "Acme LLC" }, archivedAt: null,
};

let served = unit;

async function mount(path: string, respond: (init: RequestInit) => Response = () => json({ id: "n9" }, 201)) {
  served = unit;
  const sent: { url: string; method?: string; body: Record<string, unknown> }[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    if (init?.method === "POST" || init?.method === "PATCH") {
      sent.push({ url, method: init.method, body: JSON.parse(String(init.body)) as Record<string, unknown> });
      return respond(init);
    }
    if (url.startsWith("/api/owners?")) return json({ data: [{ id: OWNER, name: "Override Trust" }], page: 1, pageSize: 200, total: 1 });
    if (url === "/api/units/n1") return json(served);
    if (url === "/api/properties/p1") return json(property);
    return json({ error: { message: "nope" } }, 404);
  });
  queryClient.clear();
  document.body.innerHTML = '<div id="root"></div>';
  const root = createRoot(document.getElementById("root") as HTMLElement);
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/properties/:id/units/new" element={<UnitForm />} />
            <Route path="/units/:id/edit" element={<UnitForm />} />
            <Route path="/units/:id" element={<h1>Detail</h1>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await settle();
  return sent;
}
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 100))));
const byId = (id: string) => document.getElementById(id) as HTMLInputElement & HTMLSelectElement;
const button = (name: string) => Array.from(document.querySelectorAll("button")).find((b) => b.textContent === name) as HTMLButtonElement;
const setValue = (el: HTMLInputElement | HTMLSelectElement, v: string) => {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, v);
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
};
const submit = async () => {
  await act(async () => button("Save unit").click());
  await settle();
};

it("Add unit has the §11.10 fields and posts the unit to the property", async () => {
  const sent = await mount("/properties/p1/units/new");
  expect(document.querySelector("h1")?.textContent).toBe("Add unit");
  const labels = Array.from(document.querySelectorAll("label")).map((l) => l.textContent);
  expect(labels).toEqual(["Unit label (required)", "Use (required)", "Bedrooms", "Bathrooms", "Square feet", "Owner (if different from property)", "Notes"]);
  await act(async () => {
    setValue(byId("field-label"), "2R");
    setValue(byId("field-use"), "Residential");
    setValue(byId("field-bathrooms"), "1.5");
    setValue(byId("field-ownerOverrideId"), OWNER);
  });
  await submit();
  expect(sent).toHaveLength(1);
  expect(sent[0]?.url).toBe("/api/properties/p1/units");
  expect(sent[0]?.method).toBe("POST");
  expect(sent[0]?.body).toMatchObject({ label: "2R", use: "Residential", bathrooms: 1.5, bedrooms: null, ownerOverrideId: OWNER });
  expect(document.querySelector("h1")?.textContent).toBe("Detail");
});

it("asks for the label and use before saving", async () => {
  const sent = await mount("/properties/p1/units/new");
  await submit();
  expect(sent).toHaveLength(0);
  expect(document.body.textContent).toContain("Enter the unit label.");
  expect(document.body.textContent).toContain("Choose Residential or Commercial.");
});

it("shows the duplicate-label message from the server next to the field", async () => {
  const msg = "A unit with this label already exists in this property.";
  const sent = await mount("/properties/p1/units/new", () => json({ error: { code: "CONFLICT", message: msg, fields: { label: msg } } }, 409));
  await act(async () => {
    setValue(byId("field-label"), "2R");
    setValue(byId("field-use"), "Residential");
  });
  await submit();
  expect(sent).toHaveLength(1);
  expect(document.getElementById("field-label-error")?.textContent).toBe(msg);
});

it("Edit unit shows Use as plain text with the hint, and never sends use", async () => {
  const sent = await mount("/units/n1/edit");
  expect(document.querySelector("h1")?.textContent).toBe("Edit unit");
  expect(document.querySelector("select#field-use")).toBeNull();
  expect(document.body.textContent).toContain("Use can't be changed. To change it, archive this unit and add a new one.");
  const group = document.querySelector("[role=group]");
  expect(group?.getAttribute("aria-describedby")).toBe("unit-use-hint");
  expect(document.getElementById("unit-use-hint")?.textContent).toContain("Use can't be changed");
  expect(byId("field-label").value).toBe("3F");
  expect(byId("field-bathrooms").value).toBe("1.5");
  await act(async () => setValue(byId("field-label"), "3G"));
  await submit();
  expect(sent[0]?.url).toBe("/api/units/n1");
  expect(sent[0]?.method).toBe("PATCH");
  expect(sent[0]?.body).toMatchObject({ label: "3G", version: 3 });
  expect(sent[0]?.body).not.toHaveProperty("use");
});

it("a stale edit shows the changed-by-someone-else message", async () => {
  await mount("/units/n1/edit", () => json({ error: { code: "CONFLICT", message: "stale" } }, 409));
  await submit();
  expect(document.body.textContent).toContain("Someone else changed this record. Reload to see the latest version.");
});

it("an unknown unit or property is Page not found", async () => {
  await mount("/properties/zzz/units/new");
  expect(document.querySelector("h1")?.textContent).toBe("Page not found");
});

it("after Reload on a stale edit, focus goes to the first field of the reloaded form", async () => {
  await mount("/units/n1/edit", () => json({ error: { code: "CONFLICT", message: "stale" } }, 409));
  await submit();
  served = { ...unit, version: 4, label: "3F (changed elsewhere)" };
  await act(async () => button("Reload").click());
  await act(async () => void (await new Promise((r) => setTimeout(r, 450))));
  expect(document.activeElement?.id).toBe("field-label");
});
