// @vitest-environment happy-dom
import { QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { queryClient } from "../App";
import { UnitDetail } from "./UnitDetail";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => vi.unstubAllGlobals());

const json = (v: unknown, status = 200) => Response.json(v, { status });
const unit = {
  id: "n1", propertyId: "p1", version: 1, label: "2R", use: "Residential", bedrooms: 2, bathrooms: 1.5, squareFeet: null, notes: null,
  ownerOverrideId: "o2", owner: { id: "o2", name: "Override Trust" }, archivedAt: null, property: { id: "p1", name: "Court Plaza" },
};

async function mount(role: string, unitResponse: Response = json(unit)) {
  vi.stubGlobal("fetch", async (url: string) => {
    if (url === "/api/me") return json({ id: "u", name: "Ann", email: "a@x.com", role, status: "active" });
    return unitResponse.clone();
  });
  queryClient.clear();
  document.body.innerHTML = '<div id="root"></div>';
  const root = createRoot(document.getElementById("root") as HTMLElement);
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/units/n1"]}>
          <Routes>
            <Route path="/units/:id" element={<UnitDetail />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await act(async () => void (await new Promise((r) => setTimeout(r, 30))));
}
const buttonNamed = (name: string) => Array.from(document.querySelectorAll("button")).find((b) => b.textContent === name);

it("shows the heading and summary, including the owner override and Vacant status", async () => {
  await mount("landlord");
  expect(document.querySelector("h1")?.textContent).toBe("Court Plaza – Unit 2R");
  const text = document.querySelector("dl")?.textContent ?? "";
  for (const s of ["UseResidential", "Bedrooms2", "Bathrooms1.5", "Square feet—", "OwnerOverride Trust", "StatusVacant"]) expect(text).toContain(s);
  expect(buttonNamed("Edit unit")).toBeTruthy();
});

it("hides Edit unit from the Smoke user", async () => {
  await mount("smoke");
  expect(buttonNamed("Edit unit")).toBeUndefined();
});

it("an archived unit has status Archived", async () => {
  await mount("landlord", json({ ...unit, archivedAt: "2026-01-01T00:00:00Z" }));
  expect(document.querySelector("dl")?.textContent).toContain("StatusArchived");
});

it("an unknown unit is Page not found", async () => {
  await mount("landlord", json({ error: { message: "x" } }, 404));
  expect(document.querySelector("h1")?.textContent).toBe("Page not found");
});

it("a failed load offers Try again", async () => {
  await mount("landlord", json({}, 500));
  expect(document.querySelector("[role=alert]")?.textContent).toContain("Something went wrong");
  expect(buttonNamed("Try again")).toBeTruthy();
});
