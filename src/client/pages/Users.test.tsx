// @vitest-environment happy-dom
import { QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { queryClient } from "../App";
import { Users } from "./Users";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => vi.unstubAllGlobals());

const rows = [
  { id: "1", name: "Ann Admin", email: "ann@example.com", role: "admin", status: "active", lastSignInAt: "2027-01-05T03:30:00Z", invitation: null },
  { id: "2", name: "Pat Lee", email: "pat@example.com", role: "landlord", status: "invited", lastSignInAt: null, invitation: { id: "i", state: "expired" } },
  { id: "3", name: "Smoke", email: "smoke@example.com", role: "smoke", status: "active", lastSignInAt: null, invitation: null },
];

async function mount(fetchImpl: (url: string, init?: RequestInit) => Promise<Response>) {
  vi.stubGlobal("fetch", fetchImpl);
  queryClient.clear();
  document.body.innerHTML = '<div id="root"></div>';
  const root = createRoot(document.getElementById("root") as HTMLElement);
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <Users />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
  return root;
}

it("lists users with role and status labels and an Invite landlord button", async () => {
  const root = await mount(async () => Response.json({ data: rows, page: 1, pageSize: 50, total: 3 }));
  expect(document.querySelector("h1")?.textContent).toBe("Users");
  const table = document.querySelector('table[aria-label="Users"]') as HTMLElement;
  const text = Array.from(table.querySelectorAll("tbody tr")).map((r) => r.textContent);
  expect(Array.from(table.querySelectorAll("th")).map((h) => h.textContent)).toEqual(["Name", "Email", "Role", "Status", "Last sign-in", "Actions"]);
  expect(text[0]).toContain("Admin");
  expect(text[0]).toContain("Active");
  expect(text[1]).toContain("Landlord");
  expect(text[1]).toContain("Invitation expired");
  expect(text[2]).toContain("Smoke test (read-only)");
  expect(Array.from(document.querySelectorAll("button")).some((b) => b.textContent === "Invite landlord")).toBe(true);
  await act(async () => root.unmount());
});

it("shows the duplicate-email message in the invite dialog on a 409", async () => {
  const root = await mount(async (url, init) =>
    init?.method === "POST"
      ? Response.json({ error: { code: "CONFLICT", message: "A user with this email already exists." } }, { status: 409 })
      : Response.json({ data: rows, page: 1, pageSize: 50, total: 3 }),
  );
  const open = Array.from(document.querySelectorAll("button")).find((b) => b.textContent === "Invite landlord") as HTMLElement;
  await act(async () => open.click());
  const set = (el: HTMLInputElement, v: string) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
  expect(dialog).not.toBeNull();
  const inputs = dialog.querySelectorAll("input");
  await act(async () => {
    set(inputs[0] as HTMLInputElement, "Someone");
    set(inputs[1] as HTMLInputElement, "pat@example.com");
  });
  await act(async () => {
    dialog.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 100));
  });
  expect(dialog.textContent).toContain("A user with this email already exists.");
  expect(dialog.textContent).toContain("There is a problem");
  const cancel = Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === "Cancel") as HTMLElement;
  await act(async () => cancel.click());
  await act(async () => open.click());
  const reopened = document.querySelector('[role="dialog"]') as HTMLElement;
  expect(reopened.textContent).not.toContain("A user with this email already exists.");
  expect((reopened.querySelectorAll("input")[1] as HTMLInputElement).value).toBe("");
  await act(async () => root.unmount());
});

it("maps server 422 field errors onto the invite dialog fields", async () => {
  const root = await mount(async (url, init) =>
    init?.method === "POST"
      ? Response.json({ error: { code: "VALIDATION_ERROR", message: "Please check.", fields: { email: "Enter a valid email address." } } }, { status: 422 })
      : Response.json({ data: rows, page: 1, pageSize: 50, total: 3 }),
  );
  const open = Array.from(document.querySelectorAll("button")).find((b) => b.textContent === "Invite landlord") as HTMLElement;
  await act(async () => open.click());
  const set = (el: HTMLInputElement, v: string) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
  const inputs = dialog.querySelectorAll("input");
  await act(async () => {
    set(inputs[0] as HTMLInputElement, "Someone");
    set(inputs[1] as HTMLInputElement, "someone@example.com");
  });
  await act(async () => {
    dialog.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 100));
  });
  expect(dialog.textContent).toContain("Enter a valid email address.");
  expect(dialog.textContent).not.toContain("Something went wrong");
  await act(async () => root.unmount());
});

it("asks for a name with neutral wording", async () => {
  const root = await mount(async () => Response.json({ data: rows, page: 1, pageSize: 50, total: 3 }));
  const open = Array.from(document.querySelectorAll("button")).find((b) => b.textContent === "Invite landlord") as HTMLElement;
  await act(async () => open.click());
  const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
  await act(async () => {
    dialog.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 100));
  });
  expect(dialog.textContent).toContain("Enter a name.");
  expect(dialog.textContent).not.toContain("Enter your name.");
  await act(async () => root.unmount());
});

const buttonsOf = (row: Element) => Array.from(row.querySelectorAll("button")).map((b) => b.textContent);

it("offers row actions per user and none on the Admin and Smoke rows", async () => {
  const more = [
    ...rows,
    { id: "4", name: "Lou", email: "lou@example.com", role: "landlord", status: "active", lastSignInAt: null, invitation: null },
    { id: "5", name: "Rae", email: "rae@example.com", role: "landlord", status: "deactivated", lastSignInAt: null, invitation: null },
    { id: "6", name: "Val", email: "val@example.com", role: "landlord", status: "invited", lastSignInAt: null, invitation: { id: "iv", state: "valid" } },
  ];
  const root = await mount(async () => Response.json({ data: more, page: 1, pageSize: 50, total: 6 }));
  const trs = Array.from(document.querySelectorAll('table[aria-label="Users"] tbody tr'));
  expect(trs.map(buttonsOf)).toEqual([[], ["Resend invitation"], [], ["Deactivate"], ["Reactivate"], ["Resend invitation", "Revoke invitation"]]);
  await act(async () => root.unmount());
});

it("confirms Deactivate with the spec wording, then posts to the user's deactivate route", async () => {
  const calls: string[] = [];
  const more = [{ id: "4", name: "Lou", email: "lou@example.com", role: "landlord", status: "active", lastSignInAt: null, invitation: null }];
  const root = await mount(async (url, init) => {
    if (init?.method === "POST") {
      calls.push(url);
      return Response.json({});
    }
    return Response.json({ data: more, page: 1, pageSize: 50, total: 1 });
  });
  const row = document.querySelector('table[aria-label="Users"] tbody tr') as HTMLElement;
  await act(async () => (Array.from(row.querySelectorAll("button")).find((b) => b.textContent === "Deactivate") as HTMLElement).click());
  const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
  expect(dialog.textContent).toContain(
    "Deactivate Lou? They will be signed out and can't sign in. They'll be removed as a responsible landlord; properties left with no responsible landlord will be assigned to you.",
  );
  expect(calls).toEqual([]);
  await act(async () => (Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === "Deactivate") as HTMLElement).click());
  await act(async () => {
    await new Promise((r) => setTimeout(r, 100));
  });
  expect(calls).toEqual(["/api/users/4/deactivate"]);
  expect(document.querySelector('[role="status"]')?.textContent).toContain("User deactivated.");
  await act(async () => root.unmount());
});

it("revokes an invitation by its invitation id without a dialog", async () => {
  const calls: string[] = [];
  const more = [{ id: "6", name: "Val", email: "val@example.com", role: "landlord", status: "invited", lastSignInAt: null, invitation: { id: "iv", state: "valid" } }];
  const root = await mount(async (url, init) => {
    if (init?.method === "POST") {
      calls.push(url);
      return Response.json({});
    }
    return Response.json({ data: more, page: 1, pageSize: 50, total: 1 });
  });
  const revoke = Array.from(document.querySelectorAll("button")).find((b) => b.textContent === "Revoke invitation") as HTMLElement;
  await act(async () => revoke.click());
  await act(async () => {
    await new Promise((r) => setTimeout(r, 100));
  });
  expect(calls).toEqual(["/api/invitations/iv/revoke"]);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await act(async () => root.unmount());
});

it("shows the server's message when a row action conflicts and keeps focus on the outcome", async () => {
  const more = [{ id: "4", name: "Lou", email: "lou@example.com", role: "landlord", status: "deactivated", lastSignInAt: null, invitation: null }];
  const root = await mount(async (url, init) =>
    init?.method === "POST"
      ? Response.json({ error: { code: "CONFLICT", message: "Only deactivated users can be reactivated." } }, { status: 409 })
      : Response.json({ data: more, page: 1, pageSize: 50, total: 1 }),
  );
  const btn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent === "Reactivate") as HTMLElement;
  await act(async () => btn.click());
  await act(async () => {
    await new Promise((r) => setTimeout(r, 100));
  });
  expect(document.querySelector('[role="alert"]')?.textContent).toBe("Only deactivated users can be reactivated.");
  expect(document.activeElement?.contains(document.querySelector('[role="alert"]'))).toBe(true);
  await act(async () => root.unmount());
});
