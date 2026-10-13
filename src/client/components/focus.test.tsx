// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router";
import { describe, expect, it } from "vitest";
import type { Me } from "../api";
import { Layout } from "./Layout";
import { Page } from "./Page";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const me: Me = { id: "1", name: "Ada", email: "a@example.com", role: "landlord", status: "active" };
let go: (to: string) => void = () => {};

function Nav() {
  const navigate = useNavigate();
  go = (to) => void navigate(to);
  return null;
}

describe("Layout focus", () => {
  it("moves focus to <main> after a route change but not on first render", async () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = createRoot(document.getElementById("root") as HTMLElement);
    await act(async () => {
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <MemoryRouter initialEntries={["/properties"]}>
            <Nav />
            <Routes>
              <Route element={<Layout me={me} />}>
                <Route path="/properties" element={<Page title="Properties" />} />
                <Route path="/tenants" element={<Page title="Tenants" />} />
              </Route>
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });
    expect(document.activeElement).not.toBe(document.getElementById("main"));
    await act(async () => go("/tenants"));
    expect(document.activeElement).toBe(document.getElementById("main"));
    expect(document.title).toBe("Tenants – RentNerd");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(document.querySelector('[role="status"]')?.textContent).toBe("Tenants – RentNerd");
    await act(async () => root.unmount());
  });
});
