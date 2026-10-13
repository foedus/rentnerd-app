// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { ResetPassword } from "./ResetPassword";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => vi.unstubAllGlobals());

async function mount(start: string) {
  document.body.innerHTML = '<div id="root"></div>';
  await act(async () => {
    createRoot(document.getElementById("root") as HTMLElement).render(
      <MemoryRouter initialEntries={[start]}>
        <Routes>
          <Route path="/reset-password" element={<ResetPassword />} />
        </Routes>
      </MemoryRouter>,
    );
  });
}

it("shows the invalid-link message and a request-a-new-link link when there is no token", async () => {
  await mount("/reset-password");
  expect(document.body.textContent).toContain("This reset link is invalid or has expired.");
  expect(document.querySelector("a")?.textContent).toBe("Request a new link");
});

it("shows the length and confirmation messages without calling the server", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  await mount("/reset-password?token=abc");
  const set = (el: HTMLInputElement, v: string) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const submit = async (a: string, b: string) => {
    const [p, c] = document.querySelectorAll("input") as unknown as HTMLInputElement[];
    await act(async () => {
      set(p as HTMLInputElement, a);
      set(c as HTMLInputElement, b);
    });
    await act(async () => {
      document.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
  };
  await submit("short1", "short1");
  expect(document.body.textContent).toContain("Password must be at least 12 characters.");
  await submit("Long-enough-password-1", "Long-enough-password-2");
  expect(document.body.textContent).toContain("Passwords don't match.");
  expect(fetchMock).not.toHaveBeenCalled();
});
