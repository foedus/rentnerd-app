// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { App, queryClient } from "./App";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => vi.unstubAllGlobals());

function Where() {
  const l = useLocation();
  return <p data-testid="where">{l.pathname + l.search}</p>;
}

it("shows a titled page with one h1 while loading and when /api/me fails", async () => {
  vi.stubGlobal("fetch", () => new Promise(() => {}));
  document.body.innerHTML = '<div id="root"></div>';
  const root = createRoot(document.getElementById("root") as HTMLElement);
  await act(async () => {
    root.render(<MemoryRouter initialEntries={["/tenants"]}><App /></MemoryRouter>);
  });
  expect(document.querySelectorAll("h1")).toHaveLength(1);
  // The title is already the requested page's, so it doesn't flash "Loading" before the page appears.
  expect(document.title).toBe("Tenants – RentNerd");
  expect(document.body.textContent).toContain("Loading…");
  await act(async () => root.unmount());

  queryClient.clear();
  document.body.innerHTML = '<div id="root"></div>';
  const root0 = createRoot(document.getElementById("root") as HTMLElement);
  await act(async () => {
    root0.render(<MemoryRouter initialEntries={["/nowhere"]}><App /></MemoryRouter>);
  });
  expect(document.title).toBe("Loading – RentNerd");
  await act(async () => root0.unmount());

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

it("strips line breaks from the path so the page doesn't render blank, and keeps the #fragment through the sign-in redirect", async () => {
  queryClient.clear();
  vi.stubGlobal("fetch", async () => new Response("{}", { status: 401 }));
  document.body.innerHTML = '<div id="root"></div>';
  const root = createRoot(document.getElementById("root") as HTMLElement);
  await act(async () => {
    root.render(<MemoryRouter initialEntries={["/tenants%0a"]}><App /><Where /></MemoryRouter>);
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 50));
  });
  expect(document.querySelectorAll("h1")).toHaveLength(1);
  expect(document.title).toBe("Sign in – RentNerd");
  await act(async () => root.unmount());

  queryClient.clear();
  document.body.innerHTML = '<div id="root"></div>';
  const root2 = createRoot(document.getElementById("root") as HTMLElement);
  await act(async () => {
    root2.render(<MemoryRouter initialEntries={["/properties?x=1#frag"]}><App /><Where /></MemoryRouter>);
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 50));
  });
  expect(document.querySelector('[data-testid="where"]')?.textContent).toBe("/login?next=%2Fproperties%3Fx%3D1%23frag");
  await act(async () => root2.unmount());
});

it("shows 'Page not found' to signed-out visitors for addresses that aren't pages, but still sends real pages to /login", async () => {
  queryClient.clear();
  vi.stubGlobal("fetch", async () => new Response("{}", { status: 401 }));
  const render = async (start: string) => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = createRoot(document.getElementById("root") as HTMLElement);
    await act(async () => {
      root.render(<MemoryRouter initialEntries={[start]}><App /><Where /></MemoryRouter>);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    return root;
  };
  const a = await render("/verify-email");
  expect(document.querySelector("h1")?.textContent).toBe("Page not found");
  expect(document.querySelector('[data-testid="where"]')?.textContent).toBe("/verify-email");
  await act(async () => a.unmount());
  queryClient.clear();
  const b = await render("/properties/");
  expect(document.querySelector('[data-testid="where"]')?.textContent).toBe("/login?next=%2Fproperties%2F");
  await act(async () => b.unmount());
});
