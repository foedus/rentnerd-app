// @vitest-environment happy-dom
import { QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { queryClient } from "../App";
import { TenantDetail } from "./TenantDetail";
import { TenantForm } from "./TenantForm";
import { Tenants } from "./Tenants";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => vi.unstubAllGlobals());

const tenant = {
  id: "11111111-1111-4111-8111-111111111111", version: 3, tenantType: "Individual", firstName: "Ann", lastName: "Lee", businessName: null,
  contactPerson: null, email: null, phone: null, notes: null, archivedAt: null, displayName: "Ann Lee", onLease: false,
};
const business = { ...tenant, tenantType: "Business", firstName: null, lastName: null, businessName: "Acme Shop", contactPerson: "Bo Diaz", displayName: "Acme Shop (Bo Diaz)" };
const me = { id: "u", name: "Ann", email: "a@x.com", role: "admin", status: "active" };
const json = (v: unknown, status = 200) => Response.json(v, { status });

async function mount(path: string, fetchImpl: (url: string, init?: RequestInit) => Promise<Response>, role = "admin") {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return url === "/api/me" ? json({ ...me, role }) : fetchImpl(url, init);
  });
  queryClient.clear();
  document.body.innerHTML = '<div id="root"></div>';
  const root = createRoot(document.getElementById("root") as HTMLElement);
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/tenants" element={<Tenants />} />
            <Route path="/tenants/new" element={<TenantForm />} />
            <Route path="/tenants/:id" element={<TenantDetail />} />
            <Route path="/tenants/:id/edit" element={<TenantForm />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await settle();
  return { root, calls };
}
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 100))));
const buttonNamed = (name: string) => Array.from(document.querySelectorAll("button")).find((b) => b.textContent === name) as HTMLButtonElement | undefined;
const setValue = (el: HTMLInputElement, v: string) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(el, v);
  el.dispatchEvent(new Event("input", { bubbles: true }));
};
const radio = (value: string) => document.querySelector(`input[type=radio][value=${value}]`) as HTMLInputElement;
const labelOf = (id: string) => document.querySelector(`label[for=${id}]`)?.textContent;

it("lists tenants with the §11.15 columns, search, Show archived and Add tenant", async () => {
  const { root, calls } = await mount("/tenants", async () => json({ data: [tenant, business], page: 1, pageSize: 50, total: 2 }));
  expect(document.querySelector("h1")?.textContent).toBe("Tenants");
  const table = document.querySelector("table[aria-label=Tenants]") as HTMLElement;
  expect(Array.from(table.querySelectorAll("th")).map((h) => h.textContent)).toEqual(["Name", "Contact person", "Email", "Phone", "Current unit(s)"]);
  const rows = Array.from(table.querySelectorAll("tbody tr")).map((r) => r.textContent);
  expect(rows[0]).toContain("Ann Lee");
  expect(rows[1]).toContain("Acme Shop");
  expect(rows[1]).toContain("Bo Diaz");
  expect(table.querySelector("a[href='/tenants/" + tenant.id + "']")?.textContent).toBe("Ann Lee");
  expect(labelOf("search-tenants")).toBe("Search tenants");
  expect(buttonNamed("Add tenant")).toBeDefined();
  await act(async () => (document.querySelector("input[type=checkbox]") as HTMLInputElement).click());
  await settle();
  expect(calls.at(-1)?.url).toContain("archived=true");
  await act(async () => root.unmount());
});

it("list: empty state, archived marker and no Add tenant for the Smoke user", async () => {
  const empty = await mount("/tenants", async () => json({ data: [], page: 1, pageSize: 50, total: 0 }), "smoke");
  expect(document.querySelector("tbody")?.textContent).toBe("No tenants yet.");
  expect(buttonNamed("Add tenant")).toBeUndefined();
  await act(async () => empty.root.unmount());
  const archived = await mount("/tenants", async () => json({ data: [{ ...tenant, archivedAt: "2026-10-01T00:00:00Z" }], page: 1, pageSize: 50, total: 1 }));
  expect(document.querySelector("tbody td")?.textContent).toBe("Ann Lee (archived)");
  await act(async () => archived.root.unmount());
});

it("form: choosing a type shows its fields; an Individual saves with only first and last name", async () => {
  const { root, calls } = await mount("/tenants/new", async (_url, init) => (init?.method === "POST" ? json(tenant, 201) : json(tenant)));
  expect(document.querySelector("[role=radiogroup] legend")?.textContent).toBe("Tenant type (required)");
  expect(document.getElementById("field-firstName")).toBeNull();
  await act(async () => radio("Individual").click());
  expect(labelOf("field-firstName")).toBe("First name (required)");
  expect(document.getElementById("field-businessName")).toBeNull();
  await act(async () => {
    setValue(document.getElementById("field-firstName") as HTMLInputElement, "Ann");
    setValue(document.getElementById("field-lastName") as HTMLInputElement, "Lee");
  });
  await act(async () => buttonNamed("Save tenant")?.click());
  await settle();
  const post = calls.find((c) => c.init?.method === "POST");
  expect(JSON.parse(String(post?.init?.body))).toMatchObject({ tenantType: "Individual", firstName: "Ann", lastName: "Lee" });
  expect(document.querySelector("h1")?.textContent).toBe("Ann Lee");
  expect(document.querySelector("[role=status]")?.textContent).toBe("Tenant saved.");
  await act(async () => root.unmount());
});

it("form: a Business without a contact person shows 'Enter a contact person.' and sends nothing", async () => {
  const { root, calls } = await mount("/tenants/new", async () => json({}));
  await act(async () => radio("Business").click());
  await act(async () => setValue(document.getElementById("field-businessName") as HTMLInputElement, "Bagel Shop Inc"));
  await act(async () => buttonNamed("Save tenant")?.click());
  await settle();
  expect(document.querySelector("[role=alert]")?.textContent).toContain("Enter a contact person.");
  expect(document.getElementById("field-contactPerson")?.getAttribute("aria-invalid")).toBe("true");
  expect(calls.some((c) => c.init?.method === "POST")).toBe(false);
  await act(async () => root.unmount());
});

it("form: an invalid email is refused, and an empty form asks for the type", async () => {
  const { root, calls } = await mount("/tenants/new", async () => json({}));
  await act(async () => buttonNamed("Save tenant")?.click());
  await settle();
  expect(document.body.textContent).toContain("Choose Individual or Business.");
  await act(async () => radio("Individual").click());
  await act(async () => {
    setValue(document.getElementById("field-firstName") as HTMLInputElement, "Bad");
    setValue(document.getElementById("field-lastName") as HTMLInputElement, "Email");
    setValue(document.getElementById("field-email") as HTMLInputElement, "not-an-email");
  });
  await act(async () => buttonNamed("Save tenant")?.click());
  await settle();
  expect(document.body.textContent).toContain("Enter a valid email address.");
  expect(calls.some((c) => c.init?.method === "POST")).toBe(false);
  await act(async () => root.unmount());
});

it("edit: loads the tenant (type checked) and sends its version", async () => {
  const { root, calls } = await mount(`/tenants/${business.id}/edit`, async (_url, init) =>
    init?.method === "PATCH" ? json({ ...business, version: 4 }) : json(business),
  );
  expect(document.querySelector("h1")?.textContent).toBe("Edit tenant");
  expect(radio("Business").checked).toBe(true);
  expect((document.getElementById("field-contactPerson") as HTMLInputElement).value).toBe("Bo Diaz");
  await act(async () => buttonNamed("Save tenant")?.click());
  await settle();
  const patch = calls.find((c) => c.init?.method === "PATCH");
  expect(JSON.parse(String(patch?.init?.body))).toMatchObject({ tenantType: "Business", businessName: "Acme Shop", version: 3 });
  await act(async () => root.unmount());
});

it("edit: Reload after a conflict shows the latest version", async () => {
  let current = tenant;
  const { root } = await mount(`/tenants/${tenant.id}/edit`, async (_url, init) =>
    init?.method === "PATCH" ? json({ error: { code: "CONFLICT", message: "x" } }, 409) : json(current),
  );
  await act(async () => buttonNamed("Save tenant")?.click());
  await settle();
  expect(document.body.textContent).toContain("Someone else changed this record.");
  current = { ...tenant, version: 4, firstName: "Anna" };
  await act(async () => buttonNamed("Reload")?.click());
  await settle();
  expect((document.getElementById("field-firstName") as HTMLInputElement).value).toBe("Anna");
  await act(async () => root.unmount());
});

it("detail: shows contact details, the Leases table and the action buttons", async () => {
  const { root } = await mount(`/tenants/${business.id}`, async (url) =>
    url.startsWith("/api/leases") ? json({ data: [], page: 1, pageSize: 200, total: 0 }) : json({ ...business, email: "bo@acme.test" }));
  expect(document.querySelector("h1")?.textContent).toBe("Acme Shop (Bo Diaz)");
  expect(document.querySelector("dl")?.textContent).toContain("bo@acme.test");
  const table = document.querySelector("table[aria-label=Leases]") as HTMLElement;
  expect(Array.from(table.querySelectorAll("th")).map((h) => h.textContent)).toEqual(["Property", "Unit", "Start", "End", "Status", "Primary contact"]);
  for (const name of ["Edit tenant", "Archive tenant", "Delete tenant"]) expect(buttonNamed(name)).toBeDefined();
  expect(buttonNamed("Delete tenant")?.getAttribute("aria-disabled")).toBeNull();
  await act(async () => root.unmount());
});

it("detail: the Leases table lists each lease from the tenant's lease list with a Primary contact Yes/No", async () => {
  const row = (id: string, unit: string, primary: boolean) => ({
    id, propertyName: "Oak House", unitId: `u-${id}`, unitLabel: unit, startDate: "2026-01-01", effectiveEndDate: "2026-12-31", currentRentCents: 100000, statusLabel: "Active",
    currentTenants: [{ tenantId: tenant.id, displayName: "Ann Lee", isPrimary: primary }, { tenantId: "other", displayName: "Bo", isPrimary: !primary }],
  });
  const { root, calls } = await mount(`/tenants/${tenant.id}`, async (url) =>
    url.startsWith("/api/leases") ? json({ data: [row("l1", "A1", true), row("l2", "B2", false)], page: 1, pageSize: 200, total: 2 }) : json(tenant));
  const query = calls.find((c) => c.url.startsWith("/api/leases"))?.url ?? "";
  expect(query).toContain(`tenantId=${tenant.id}`);
  expect(query).toContain("archived=true");
  const rows = Array.from(document.querySelectorAll("table[aria-label=Leases] tbody tr")).map((r) => Array.from(r.querySelectorAll("td")).map((c) => c.textContent));
  expect(rows).toEqual([
    ["Oak House", "A1", "Jan 1, 2026", "Dec 31, 2026", "Active", "Yes"],
    ["Oak House", "B2", "Jan 1, 2026", "Dec 31, 2026", "Active", "No"],
  ]);
  await act(async () => root.unmount());
});

it("detail: a tenant on no lease says so", async () => {
  const { root } = await mount(`/tenants/${tenant.id}`, async (url) => (url.startsWith("/api/leases") ? json({ data: [], page: 1, pageSize: 200, total: 0 }) : json(tenant)));
  expect(document.querySelector("table[aria-label=Leases]")?.textContent).toContain("This tenant is not on any lease.");
  await act(async () => root.unmount());
});

it("detail: a tenant on a lease can't be deleted but can be archived; archived offers Restore", async () => {
  const onLease = await mount(`/tenants/${tenant.id}`, async () => json({ ...tenant, onLease: true }));
  const del = buttonNamed("Delete tenant") as HTMLButtonElement;
  expect(del.getAttribute("aria-disabled")).toBe("true");
  expect(document.getElementById(del.getAttribute("aria-describedby") ?? "")?.textContent).toBe("Tenants on a lease can only be archived");
  expect(buttonNamed("Archive tenant")).toBeDefined();
  await act(async () => onLease.root.unmount());
  const archived = await mount(`/tenants/${tenant.id}`, async () => json({ ...tenant, archivedAt: "2026-10-01T00:00:00Z" }));
  expect(buttonNamed("Restore tenant")).toBeDefined();
  expect(buttonNamed("Archive tenant")).toBeUndefined();
  await act(async () => archived.root.unmount());
});

it("detail: archiving posts the version and says 'Tenant archived.'", async () => {
  const { root, calls } = await mount(`/tenants/${tenant.id}`, async (_url, init) => (init?.method === "POST" ? json({ ...tenant, version: 4 }) : json(tenant)));
  await act(async () => buttonNamed("Archive tenant")?.click());
  await settle();
  const post = calls.find((c) => c.init?.method === "POST");
  expect(post?.url).toBe(`/api/tenants/${tenant.id}/archive`);
  expect(JSON.parse(String(post?.init?.body))).toEqual({ version: 3 });
  expect(document.querySelector("[role=status]")?.textContent).toBe("Tenant archived.");
  await act(async () => root.unmount());
});

it("detail: a double-click on Archive tenant sends only one request", async () => {
  const { root, calls } = await mount(`/tenants/${tenant.id}`, async (url, init) => (init?.method === "POST" ? json({ ...tenant, version: 4 }) : url.startsWith("/api/leases") ? json({ data: [], page: 1, pageSize: 200, total: 0 }) : json(tenant)));
  const button = buttonNamed("Archive tenant") as HTMLButtonElement;
  await act(async () => {
    button.click();
    button.click();
  });
  await settle();
  expect(calls.filter((c) => c.init?.method === "POST")).toHaveLength(1);
  expect(document.querySelector("[role=alert]")).toBeNull();
  await act(async () => root.unmount());
});

it("detail: deleting asks first, then returns to the list with 'Tenant deleted.'", async () => {
  const { root } = await mount(`/tenants/${tenant.id}`, async (_url, init) =>
    init?.method === "DELETE" ? new Response(null, { status: 204 }) : json({ data: [], page: 1, pageSize: 50, total: 0, ...tenant }),
  );
  await act(async () => buttonNamed("Delete tenant")?.click());
  await settle();
  const confirm = Array.from(document.querySelectorAll("[role=dialog] button")).find((b) => b.textContent === "Delete") as HTMLElement;
  await act(async () => confirm.click());
  await settle();
  expect(document.querySelector("h1")?.textContent).toBe("Tenants");
  expect(document.querySelector("[role=status]")?.textContent).toBe("Tenant deleted.");
  await act(async () => root.unmount());
});

it("detail: hides write buttons from the Smoke user and shows the API's message for an unknown tenant", async () => {
  const smoke = await mount(`/tenants/${tenant.id}`, async () => json(tenant), "smoke");
  expect(buttonNamed("Edit tenant")).toBeUndefined();
  expect(buttonNamed("Delete tenant")).toBeUndefined();
  await act(async () => smoke.root.unmount());
  const missing = await mount(`/tenants/${tenant.id}`, async () => json({ error: { code: "NOT_FOUND", message: "Tenant not found." } }, 404));
  expect(document.querySelector("[role=alert]")?.textContent).toBe("Tenant not found.");
  await act(async () => missing.root.unmount());
});

it("edit: saving a tenant someone else deleted says 'Tenant not found.'", async () => {
  const { root } = await mount(`/tenants/${tenant.id}/edit`, async (_url, init) =>
    init?.method === "PATCH" ? json({ error: { code: "NOT_FOUND", message: "Tenant not found." } }, 404) : json(tenant),
  );
  await act(async () => buttonNamed("Save tenant")?.click());
  await settle();
  expect(document.querySelector("[role=alert]")?.textContent).toBe("Tenant not found.");
  await act(async () => root.unmount());
});
