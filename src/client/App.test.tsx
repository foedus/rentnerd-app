// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { App, queryClient } from "./App";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => vi.unstubAllGlobals());

it("shows a titled page with one h1 while loading and when /api/me fails", async () => {
  vi.stubGlobal("fetch", () => new Promise(() => {}));
  document.body.innerHTML = '<div id="root"></div>';
  const root = createRoot(document.getElementById("root") as HTMLElement);
  await act(async () => {
    root.render(<MemoryRouter initialEntries={["/tenants"]}><App /></MemoryRouter>);
  });
  expect(document.querySelectorAll("h1")).toHaveLength(1);
  expect(document.title).toBe("Loading – RentNerd");
  await act(async () => root.unmount());

  queryClient.clear();
  vi.stubGlobal("fetch", async () => new Response("{}", { status: 500 }));
  document.body.innerHTML = '<div id="root"></div>';
  const root2 = createRoot(document.getElementById("root") as HTMLElement);
  await act(async () => {
    root2.render(<MemoryRouter initialEntries={["/tenants"]}><App /></MemoryRouter>);
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 50));
  });
  expect(document.querySelectorAll("h1")).toHaveLength(1);
  expect(document.title).toBe("Something went wrong – RentNerd");
  expect(document.body.textContent).toContain("Something went wrong. Please try again.");
  expect(document.querySelector("button")?.textContent).toBe("Try again");

  await act(async () => root2.unmount());
  queryClient.clear();
  vi.stubGlobal("fetch", async () => new Response("{}", { status: 429 }));
  document.body.innerHTML = '<div id="root"></div>';
  const root3 = createRoot(document.getElementById("root") as HTMLElement);
  await act(async () => {
    root3.render(<MemoryRouter initialEntries={["/tenants"]}><App /></MemoryRouter>);
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 50));
  });
  expect(document.body.textContent).toContain("Too many attempts. Try again in a few minutes.");
  await act(async () => root3.unmount());
});
