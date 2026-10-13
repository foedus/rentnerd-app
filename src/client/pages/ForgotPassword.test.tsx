// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { ForgotPassword } from "./ForgotPassword";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => vi.unstubAllGlobals());

async function mount() {
  document.body.innerHTML = '<div id="root"></div>';
  await act(async () => {
    createRoot(document.getElementById("root") as HTMLElement).render(
      <MemoryRouter>
        <ForgotPassword />
      </MemoryRouter>,
    );
  });
}

const setEmail = async (v: string) => {
  const el = document.querySelector("input") as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const submit = () =>
  act(async () => {
    (document.querySelector("form") as HTMLFormElement).dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });

it("shows a visible error for a bad email without calling the server, then works on the next try", async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  await mount();
  await setEmail("not-an-email");
  await submit();
  expect(fetchMock).not.toHaveBeenCalled();
  expect(document.querySelector('[role="alert"]')?.textContent).toBe("Enter a valid email address.");
  await setEmail("ok@example.test");
  await submit();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(document.body.textContent).toContain("If an account exists for that email, we've sent a reset link.");
  expect(document.querySelector('[role="alert"]')?.textContent).toBe("");
});
