// @vitest-environment happy-dom
import { QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { queryClient } from "../App";
import type { Me } from "../api";
import { Account } from "./Account";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => vi.unstubAllGlobals());

const me: Me = { id: "1", name: "Pat Lee", email: "pat@example.com", role: "landlord", status: "active" };

async function mount(who: Me, fetchImpl: (url: string, init?: RequestInit) => Promise<Response> = async () => Response.json({})) {
  vi.stubGlobal("fetch", fetchImpl);
  queryClient.clear();
  queryClient.setQueryData(["me"], who);
  document.body.innerHTML = '<div id="root"></div>';
  const root = createRoot(document.getElementById("root") as HTMLElement);
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <Account me={who} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  return root;
}

const input = (label: string) => {
  const l = Array.from(document.querySelectorAll("label")).find((x) => x.textContent === label);
  return document.getElementById(l?.getAttribute("for") ?? "") as HTMLInputElement;
};
const button = (name: string) => Array.from(document.querySelectorAll("button")).find((b) => b.textContent === name) as HTMLElement;
async function type(el: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const click = (b: HTMLElement) =>
  act(async () => {
    b.click();
    await new Promise((r) => setTimeout(r, 100));
  });

it("shows Profile with a read-only email and Change password", async () => {
  const root = await mount(me);
  expect(document.querySelector("h1")?.textContent).toBe("Account settings");
  expect(input("Name (required)").value).toBe("Pat Lee");
  expect(document.body.textContent).toContain("pat@example.com");
  expect(document.querySelector('input[type="email"]')).toBeNull();
  expect(input("Name (required)").getAttribute("aria-required")).toBe("true");
  for (const l of ["Current password (required)", "New password (required)", "Confirm new password (required)"]) expect(input(l)).toBeTruthy();
  await act(async () => root.unmount());
});

it("saves the name, announces it and updates the cached user", async () => {
  const root = await mount(me, async () => Response.json({ ...me, name: "New Name" }));
  await type(input("Name (required)"), "New Name");
  await click(button("Save name"));
  expect(document.body.textContent).toContain("Name saved.");
  expect((queryClient.getQueryData(["me"]) as Me).name).toBe("New Name");
  await act(async () => root.unmount());
});

it("shows the trimmed name after saving and clears the message when edited again", async () => {
  const root = await mount(me, async () => Response.json({ ...me, name: "Trim Me" }));
  await type(input("Name (required)"), "  Trim Me  ");
  await click(button("Save name"));
  expect(input("Name (required)").value).toBe("Trim Me");
  expect(document.body.textContent).toContain("Name saved.");
  await type(input("Name (required)"), "Trim Me 2");
  expect(document.body.textContent).not.toContain("Name saved.");
  await act(async () => root.unmount());
});

it("keeps keyboard focus on the Save name button after saving", async () => {
  const root = await mount(me, async () => Response.json(me));
  const save = button("Save name");
  save.focus();
  await click(save);
  expect(document.body.textContent).toContain("Name saved.");
  expect(document.activeElement).toBe(save);
  await act(async () => root.unmount());
});

it("refuses a new password equal to the current one", async () => {
  const fetchMock = vi.fn(async () => Response.json({}));
  const root = await mount(me, fetchMock);
  for (const l of ["Current password (required)", "New password (required)", "Confirm new password (required)"]) {
    await type(input(l), "Same-password-0001");
  }
  await click(button("Change password"));
  expect(document.body.textContent).toContain("New password must be different from your current password.");
  expect(fetchMock).not.toHaveBeenCalled();
  await act(async () => root.unmount());
});

it("clears the Name saved message when the password is changed", async () => {
  const root = await mount(me, async () => Response.json(me));
  await click(button("Save name"));
  expect(document.body.textContent).toContain("Name saved.");
  await type(input("Current password (required)"), "Old-password-0001");
  await type(input("New password (required)"), "Next-password-00001");
  await type(input("Confirm new password (required)"), "Next-password-00001");
  await click(button("Change password"));
  expect(document.body.textContent).toContain("Password changed.");
  expect(document.body.textContent).not.toContain("Name saved.");
  await act(async () => root.unmount());
});

it("validates the new password length and confirmation before calling the server", async () => {
  const fetchMock = vi.fn(async () => Response.json({}));
  const root = await mount(me, fetchMock);
  await type(input("Current password (required)"), "Old-password-0001");
  await type(input("New password (required)"), "short2");
  await type(input("Confirm new password (required)"), "short2");
  await click(button("Change password"));
  expect(document.body.textContent).toContain("Password must be at least 12 characters.");
  await type(input("New password (required)"), "Long-enough-password-1");
  await type(input("Confirm new password (required)"), "Long-enough-password-3");
  await click(button("Change password"));
  expect(document.body.textContent).toContain("Passwords don't match.");
  expect(fetchMock).not.toHaveBeenCalled();
  await act(async () => root.unmount());
});

it("shows 'Current password is incorrect.' when the server refuses", async () => {
  const root = await mount(me, async () => Response.json({ code: "INVALID_PASSWORD" }, { status: 400 }));
  await type(input("Current password (required)"), "Not-my-password-01");
  await type(input("New password (required)"), "Next-password-00001");
  await type(input("Confirm new password (required)"), "Next-password-00001");
  await click(button("Change password"));
  expect(document.body.textContent).toContain("Current password is incorrect.");
  expect(document.body.textContent).not.toContain("Password changed.");
  await act(async () => root.unmount());
});

it("says 'Password changed.' and clears the fields on success, asking other sessions to be revoked", async () => {
  const fetchMock = vi.fn(async () => Response.json({}));
  const root = await mount(me, fetchMock);
  await type(input("Current password (required)"), "Old-password-0001");
  await type(input("New password (required)"), "Next-password-00001");
  await type(input("Confirm new password (required)"), "Next-password-00001");
  await click(button("Change password"));
  expect(document.body.textContent).toContain("Password changed.");
  expect(input("New password (required)").value).toBe("");
  const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
  expect(body).toEqual({ currentPassword: "Old-password-0001", newPassword: "Next-password-00001", revokeOtherSessions: true });
  await act(async () => root.unmount());
});

it("hides the forms from the Smoke user", async () => {
  const root = await mount({ ...me, role: "smoke" });
  expect(button("Save name")).toBeUndefined();
  expect(button("Change password")).toBeUndefined();
  await act(async () => root.unmount());
});
