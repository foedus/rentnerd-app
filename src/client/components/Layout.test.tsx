import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";
import type { Me } from "../api";
import { Layout } from "./Layout";
import { NoAccess, NotFound } from "./Notices";
import { Page } from "./Page";

const me = (role: Me["role"]): Me => ({ id: "1", name: "Ada Lovelace", email: "a@example.com", role, status: "active" });

function render(role: Me["role"]) {
  return renderToString(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={["/properties"]}>
        <Routes>
          <Route element={<Layout me={me(role)} />}>
            <Route path="/properties" element={<Page title="Properties" />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Layout", () => {
  it("starts with the skip link and has a home link, Menu button, user menu button and one h1", () => {
    const html = render("landlord");
    expect(html.indexOf("Skip to main content")).toBeLessThan(html.indexOf("RentNerd"));
    expect(html).toContain('href="#main"');
    expect(html).toContain(">Menu<");
    expect(html).toContain("Ada Lovelace");
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain('<main id="main" tabindex="-1"');
  });
  it("shows Users and Activity log to the Admin only", () => {
    expect(render("admin")).toContain(">Activity log<");
    expect(render("landlord")).not.toContain(">Users<");
    expect(render("smoke")).not.toContain(">Activity log<");
  });
});

describe("notices", () => {
  it("renders the exact copy", () => {
    const wrap = (el: React.ReactNode) => renderToString(<MemoryRouter>{el}</MemoryRouter>);
    expect(wrap(<NotFound />)).toContain("Page not found");
    expect(wrap(<NotFound />)).toContain("Go to dashboard");
    expect(wrap(<NoAccess />)).toContain("You don&#x27;t have access to this page.");
  });
});
