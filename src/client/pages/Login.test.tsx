// @vitest-environment happy-dom
import { QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { queryClient } from "../App";
import { Login, safeNext } from "./Login";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => vi.unstubAllGlobals());

it("accepts only same-site paths as the post-sign-in destination", () => {
  expect(safeNext("/properties?x=1")).toBe("/properties?x=1");
  for (const bad of [null, "", "https://evil.test", "//evil.test", "/\\evil.test", "evil", "/login", "/login?next=/x", "/login/", "/login#x", "/a\nb"]) {
    expect(safeNext(bad)).toBe("/");
  }
});

function Where() {
  const l = useLocation();
  return <p data-testid="where">{l.pathname + l.search}</p>;
}

async function mount(start: string, me?: object) {
  vi.stubGlobal("fetch", async () => (me ? Response.json(me) : new Response("{}", { status: 401 })));
  queryClient.clear();
  document.body.innerHTML = '<div id="root"></div>';
  const root = createRoot(document.getElementById("root") as HTMLElement);
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[start]}>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="*" element={null} />
          </Routes>
          <Where />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  return root;
}

async function submit(email: string, password: string) {
  const set = (el: HTMLInputElement, v: string) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const inputs = document.querySelectorAll("input");
  await act(async () => {
    set(inputs[0] as HTMLInputElement, email);
    set(inputs[1] as HTMLInputElement, password);
  });
  await act(async () => {
    document.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 20));
  });
}

it("sends someone who is already signed in to their destination instead of showing the form", async () => {
  const root = await mount("/login?next=%2Fproperties", { id: "1", name: "A", email: "a@example.com", role: "admin", status: "active" });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
  expect(document.querySelector('[data-testid="where"]')?.textContent).toBe("/properties");
  expect(document.querySelector("form")).toBeNull();
  await act(async () => root.unmount());
});

it("keeps one always-present alert region for sign-in errors", async () => {
  const root = await mount("/login");
  expect(document.querySelectorAll('[role="alert"]')).toHaveLength(1);
  expect(document.querySelector('[role="alert"]')?.textContent).toBe("");
  await act(async () => root.unmount());
});

it("has the labelled fields, a Sign in button, a forgot-password link and no sign-up link", async () => {
  const root = await mount("/login");
  const labels = [...document.querySelectorAll("label")].map((l) => l.textContent);
  expect(labels).toEqual(["Email (required)", "Password (required)"]);
  expect(document.querySelector("button")?.textContent).toBe("Sign in");
  expect(document.querySelector("a")?.getAttribute("href")).toBe("/forgot-password");
  expect(document.body.textContent).not.toMatch(/sign up|register|create account/i);
  expect(document.querySelectorAll("h1")).toHaveLength(1);
  await act(async () => root.unmount());
});

it("shows the generic error on a refusal and the rate-limit message on 429, staying on /login", async () => {
  const root = await mount("/login?next=%2Fproperties");
  vi.stubGlobal("fetch", async () => new Response("{}", { status: 401 }));
  await submit("a@example.com", "wrong");
  expect(document.querySelector('[role="alert"]')?.textContent).toBe("Incorrect email or password.");
  vi.stubGlobal("fetch", async () => new Response("{}", { status: 429 }));
  await submit("a@example.com", "wrong");
  expect(document.querySelector('[role="alert"]')?.textContent).toBe("Too many attempts. Try again in a few minutes.");
  expect(document.querySelector('[data-testid="where"]')?.textContent).toBe("/login?next=%2Fproperties");
  await act(async () => root.unmount());
});

it("goes to the originally requested page after a successful sign-in", async () => {
  const root = await mount("/login?next=%2Fproperties");
  const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  await submit("a@example.com", "right-password-1");
  expect(document.querySelector('[data-testid="where"]')?.textContent).toBe("/properties");
  expect(fetchMock).toHaveBeenCalledWith("/api/auth/sign-in/email", expect.objectContaining({ method: "POST" }));
  await act(async () => root.unmount());
});
