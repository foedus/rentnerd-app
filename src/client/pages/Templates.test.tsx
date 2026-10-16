// @vitest-environment happy-dom
import { QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { queryClient } from "../App";
import { TemplateEditorPage } from "./TemplateEditorPage";
import { Templates } from "./Templates";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => vi.unstubAllGlobals());

const ID = "11111111-1111-4111-8111-111111111111";
const doc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] }] };
const row = { id: ID, name: "Standard lease", kind: "master_lease", version: 2, archivedAt: null, updatedAt: "2026-10-12T15:00:00Z", updatedByName: "Ann", hasDocuments: false };
const json = (v: unknown, status = 200) => Response.json(v, { status });
const wait = () => act(async () => void (await new Promise((r) => setTimeout(r, 60))));
const waitFor = async (check: () => unknown) => {
  for (let i = 0; i < 60 && !check(); i++) await wait();
};

type Handler = (url: string, init?: RequestInit) => Response | undefined;
async function mount(path: string, role: string, handler: Handler = () => undefined) {
  const calls: { url: string; method: string; body?: string }[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: init?.body as string | undefined });
    if (url === "/api/me") return json({ id: "u", name: "Ann", email: "a@x.com", role, status: "active" });
    const custom = handler(url, init);
    if (custom) return custom;
    if (url.startsWith("/api/templates?")) return json({ data: [row, { ...row, id: "2", name: "Old lease", archivedAt: "2026-10-01T00:00:00Z" }], page: 1, pageSize: 25, total: 2 });
    if (url === `/api/templates/${ID}` && method === "GET") return json({ ...row, content: doc });
    return json({ error: { code: "NOT_FOUND", message: "x" } }, 404);
  });
  queryClient.clear();
  document.body.innerHTML = '<div id="root"></div>';
  const root = createRoot(document.getElementById("root") as HTMLElement);
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/templates" element={<Templates />} />
            <Route path="/templates/new" element={<TemplateEditorPage />} />
            <Route path="/templates/:id" element={<TemplateEditorPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await wait();
  return { root, calls };
}
const buttonNamed = (name: string) => Array.from(document.querySelectorAll("button")).find((b) => b.textContent === name || b.getAttribute("aria-label") === name) as HTMLButtonElement | undefined;
const field = (label: string) => Array.from(document.querySelectorAll("label")).find((l) => l.textContent?.startsWith(label))?.control as HTMLInputElement & HTMLSelectElement;
const setValue = async (el: HTMLInputElement | HTMLSelectElement, value: string) => {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, value);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
};

it("lists templates with Name, Type, Last updated and Updated by, and a New template button", async () => {
  const { root, calls } = await mount("/templates", "admin");
  await waitFor(() => document.querySelector("table"));
  const headers = Array.from(document.querySelectorAll("th")).map((h) => h.textContent);
  expect(headers).toEqual(["Name", "Type", "Last updated", "Updated by"]);
  const cells = Array.from(document.querySelectorAll("tbody tr")[0]?.querySelectorAll("td") ?? []).map((c) => c.textContent);
  expect(cells[0]).toBe("Standard lease");
  expect(cells[1]).toBe("Master lease");
  expect(cells[3]).toBe("Ann");
  expect(buttonNamed("New template")).toBeTruthy();
  expect(calls.some((c) => c.url.includes("archived=false"))).toBe(true);
  await act(async () => root.unmount());
});

it("asks for archived templates when Show archived is ticked", async () => {
  const { root, calls } = await mount("/templates", "admin");
  await act(async () => (field("Show archived") as HTMLInputElement).click());
  await wait();
  expect(calls.some((c) => c.url.includes("archived=true"))).toBe(true);
  await act(async () => root.unmount());
});

it("hides New template from the Smoke user", async () => {
  const { root } = await mount("/templates", "smoke");
  await waitFor(() => document.querySelector("table"));
  expect(buttonNamed("New template")).toBeUndefined();
  await act(async () => root.unmount());
});

it("shows the Template content editor with every toolbar control and one Tab stop", async () => {
  const { root } = await mount("/templates/new", "admin");
  await waitFor(() => document.querySelector("[aria-label='Template content']"));
  expect(document.querySelector("[aria-label='Template content']")).toBeTruthy();
  const names = ["Heading 1", "Heading 2", "Bold", "Italic", "Underline", "Numbered list", "Bulleted list", "Align center", "Page break", "Insert table", "Insert placeholder"];
  for (const n of names) expect(buttonNamed(n), n).toBeTruthy();
  const bar = document.querySelector("[role=toolbar]") as HTMLElement;
  expect(bar.querySelectorAll("button[tabindex='0']")).toHaveLength(1);
  await act(async () => root.unmount());
});

it("moves between toolbar controls with the arrow keys", async () => {
  const { root } = await mount("/templates/new", "admin");
  await waitFor(() => document.querySelector("[role=toolbar]"));
  const first = buttonNamed("Heading 1") as HTMLButtonElement;
  await act(async () => first.focus());
  await act(async () => void first.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
  expect(document.activeElement).toBe(buttonNamed("Heading 2"));
  await act(async () => void (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })));
  expect(document.activeElement).toBe(buttonNamed("Insert placeholder"));
  await act(async () => root.unmount());
});

it("offers only the placeholders valid for the type, and filters them by search", async () => {
  const { root } = await mount("/templates/new", "admin");
  await waitFor(() => document.querySelector("[role=toolbar]"));
  await setValue(field("Template type"), "master_lease");
  await act(async () => (buttonNamed("Insert placeholder") as HTMLElement).click());
  await wait();
  const choices = () => Array.from(document.querySelectorAll("[role=dialog] li button")).map((b) => b.textContent);
  expect(choices()).toContain("Tenant names");
  expect(choices()).not.toContain("Extension start date");
  await setValue(document.getElementById("placeholder-search") as HTMLInputElement, "tenant names");
  expect(choices()).toEqual(["Tenant names"]);
  await act(async () => root.unmount());
});

it("inserts the chosen placeholder as a [Chip label] chip", async () => {
  const { root } = await mount("/templates/new", "admin");
  await waitFor(() => document.querySelector("[role=toolbar]"));
  await act(async () => (buttonNamed("Insert placeholder") as HTMLElement).click());
  await wait();
  const choice = Array.from(document.querySelectorAll("[role=dialog] li button")).find((b) => b.textContent === "Tenant names") as HTMLElement;
  await act(async () => choice.click());
  await wait();
  expect(document.querySelector("[aria-label='Template content']")?.textContent).toContain("[Tenant names]");
  await act(async () => root.unmount());
});

it("shows 'Enter a template name.' and does not call the server when the name is empty", async () => {
  const { root, calls } = await mount("/templates/new", "admin");
  await waitFor(() => document.querySelector("[role=toolbar]"));
  await setValue(field("Template type"), "master_lease");
  await act(async () => (buttonNamed("Save template") as HTMLElement).click());
  await wait();
  expect(document.body.textContent).toContain("Enter a template name.");
  expect(calls.some((c) => c.method === "POST")).toBe(false);
  await act(async () => root.unmount());
});

it("shows the server's duplicate-name message on the name field", async () => {
  const { root } = await mount("/templates/new", "admin", (url, init) =>
    url === "/api/templates" && init?.method === "POST" ? json({ error: { code: "CONFLICT", message: "A template with this name already exists.", fields: { name: "A template with this name already exists." } } }, 409) : undefined,
  );
  await waitFor(() => document.querySelector("[role=toolbar]"));
  await setValue(field("Template name"), "Standard lease");
  await setValue(field("Template type"), "master_lease");
  await act(async () => (buttonNamed("Save template") as HTMLElement).click());
  await wait();
  expect(document.body.textContent).toContain("A template with this name already exists.");
  await act(async () => root.unmount());
});

it("creates a template with the typed content and shows 'Template saved.' on its page", async () => {
  const { root, calls } = await mount("/templates/new", "admin", (url, init) => {
    if (url === "/api/templates" && init?.method === "POST") return json({ ...row, content: doc }, 201);
    return undefined;
  });
  await waitFor(() => document.querySelector("[role=toolbar]"));
  await setValue(field("Template name"), "Standard lease");
  await setValue(field("Template type"), "master_lease");
  await act(async () => (buttonNamed("Insert placeholder") as HTMLElement).click());
  await wait();
  await act(async () => (Array.from(document.querySelectorAll("[role=dialog] li button")).find((b) => b.textContent === "Tenant names") as HTMLElement).click());
  await wait();
  await act(async () => (buttonNamed("Save template") as HTMLElement).click());
  await wait();
  const post = calls.find((c) => c.method === "POST");
  const sent = JSON.parse(post?.body ?? "{}") as { name: string; kind: string; content: { content: { content: { type: string; attrs?: { key: string } }[] }[] } };
  expect(sent.name).toBe("Standard lease");
  expect(sent.kind).toBe("master_lease");
  expect(JSON.stringify(sent.content)).toContain('"key":"tenant_names"');
  expect(document.body.textContent).toContain("Template saved.");
  await act(async () => root.unmount());
});

it("edits a saved template: the type is fixed, and saving sends the version", async () => {
  const { root, calls } = await mount(`/templates/${ID}`, "admin", (url, init) => (url === `/api/templates/${ID}` && init?.method === "PATCH" ? json({ ...row, version: 3, name: "Renamed", content: doc }) : undefined));
  await waitFor(() => field("Template name"));
  expect(field("Template type")).toBeUndefined();
  expect(document.body.textContent).toContain("Template type: Master lease");
  await setValue(field("Template name"), "Renamed");
  await act(async () => (buttonNamed("Save template") as HTMLElement).click());
  await wait();
  const patch = calls.find((c) => c.method === "PATCH");
  expect(JSON.parse(patch?.body ?? "{}")).toMatchObject({ name: "Renamed", version: 2 });
  expect(patch?.body).not.toContain('"kind"');
  expect(document.body.textContent).toContain("Template saved.");
  await act(async () => root.unmount());
});

it("archives a template and offers Restore on an archived one", async () => {
  const { root, calls } = await mount(`/templates/${ID}`, "admin", (url, init) => (url.endsWith("/archive") && init?.method === "POST" ? json({ ...row, archivedAt: "2026-10-16T00:00:00Z" }) : undefined));
  await waitFor(() => buttonNamed("Archive template"));
  await act(async () => (buttonNamed("Archive template") as HTMLElement).click());
  await wait();
  expect(calls.find((c) => c.url.endsWith("/archive"))?.body).toBe(JSON.stringify({ version: 2 }));
  expect(document.body.textContent).toContain("Template archived.");
  await act(async () => root.unmount());

  const second = await mount(`/templates/${ID}`, "admin", (url) => (url === `/api/templates/${ID}` ? json({ ...row, archivedAt: "2026-10-01T00:00:00Z", content: doc }) : undefined));
  await waitFor(() => buttonNamed("Restore template"));
  expect(buttonNamed("Restore template")).toBeTruthy();
  expect(buttonNamed("Archive template")).toBeUndefined();
  await act(async () => second.root.unmount());
});

it("deletes after a confirmation, and explains why Delete is unavailable for a template PDFs used", async () => {
  const { root, calls } = await mount(`/templates/${ID}`, "admin", (url, init) => (url === `/api/templates/${ID}` && init?.method === "DELETE" ? new Response(null, { status: 204 }) : undefined));
  await waitFor(() => buttonNamed("Delete template"));
  await act(async () => (buttonNamed("Delete template") as HTMLElement).click());
  await wait();
  expect(calls.some((c) => c.method === "DELETE")).toBe(false);
  const confirm = Array.from(document.querySelectorAll("[role=dialog] button")).find((b) => b.textContent === "Delete template") as HTMLElement;
  await act(async () => confirm.click());
  await wait();
  expect(calls.some((c) => c.method === "DELETE")).toBe(true);
  await act(async () => root.unmount());

  const used = await mount(`/templates/${ID}`, "admin", (url) => (url === `/api/templates/${ID}` ? json({ ...row, hasDocuments: true, content: doc }) : undefined));
  await waitFor(() => buttonNamed("Delete template"));
  const del = buttonNamed("Delete template") as HTMLElement;
  expect(del.getAttribute("aria-disabled")).toBe("true");
  expect(document.getElementById(del.getAttribute("aria-describedby") ?? "")?.textContent).toBe("Templates used for generated PDFs can only be archived");
  await act(async () => used.root.unmount());
});

it("shows the Smoke user a read-only template with no buttons", async () => {
  const { root } = await mount(`/templates/${ID}`, "smoke");
  await waitFor(() => document.querySelector("[aria-label='Template content']"));
  expect(document.body.textContent).toContain("Standard lease");
  expect(buttonNamed("Save template")).toBeUndefined();
  expect(buttonNamed("Delete template")).toBeUndefined();
  expect(document.querySelector("[aria-label='Template content']")?.getAttribute("contenteditable")).toBe("false");
  await act(async () => root.unmount());
});

it("shows the server's name-clash message when Restore is refused", async () => {
  const { root } = await mount(`/templates/${ID}`, "admin", (url, init) => {
    if (url === `/api/templates/${ID}` && !init?.method) return json({ ...row, archivedAt: "2026-10-01T00:00:00Z", content: doc });
    if (url.endsWith("/restore")) return json({ error: { code: "CONFLICT", message: "A template with this name already exists.", fields: { name: "A template with this name already exists." } } }, 409);
    return undefined;
  });
  await waitFor(() => buttonNamed("Restore template"));
  await act(async () => (buttonNamed("Restore template") as HTMLElement).click());
  await wait();
  expect(document.body.textContent).toContain("A template with this name already exists.");
  await act(async () => root.unmount());
});

it("clears the placeholder search when the list is closed", async () => {
  const { root } = await mount("/templates/new", "admin");
  await waitFor(() => document.querySelector("[role=toolbar]"));
  await act(async () => (buttonNamed("Insert placeholder") as HTMLElement).click());
  await wait();
  await setValue(document.getElementById("placeholder-search") as HTMLInputElement, "zzz");
  await act(async () => (buttonNamed("Close") as HTMLElement).click());
  await wait();
  await act(async () => (buttonNamed("Insert placeholder") as HTMLElement).click());
  await wait();
  expect((document.getElementById("placeholder-search") as HTMLInputElement).value).toBe("");
  await act(async () => root.unmount());
});

it("makes list, page break and table controls unavailable inside a table", async () => {
  const { root } = await mount("/templates/new", "admin");
  await waitFor(() => document.querySelector("[role=toolbar]"));
  await act(async () => (buttonNamed("Insert table") as HTMLElement).click());
  await wait();
  for (const n of ["Page break", "Bulleted list", "Numbered list", "Insert table"]) expect(buttonNamed(n)?.getAttribute("aria-disabled"), n).toBe("true");
  expect(buttonNamed("Bold")?.getAttribute("aria-disabled")).toBeNull();
  await act(async () => root.unmount());
});
