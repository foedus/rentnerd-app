// @vitest-environment happy-dom
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { queryClient } from "../App";
import { fetchMe } from "../api";
import { Dashboard } from "./Dashboard";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => vi.unstubAllGlobals());

const stats = {
  units: 4,
  occupied: 3,
  vacant: 1,
  occupancyTenths: 750,
  monthlyRentRollCents: 600000,
  annualRentRollCents: 7200000,
  monthlyOtherIncomeCents: 10000,
  vacancyLossCents: 150000,
  valueCents: 100000000,
  grossYieldHundredths: 612,
  propertiesWithValue: 1,
  properties: 2,
};
const dashboard = {
  asOf: "2026-10-12",
  summary: { ...stats, yieldNote: "Based on 1 of 2 properties with a value." },
  byProperty: [
    {
      ...stats,
      propertyId: "p1",
      name: "Property A",
      propertyType: "Residential",
    },
    {
      ...stats,
      propertyId: "p2",
      name: "Property B",
      propertyType: "Commercial",
      valueCents: null,
      grossYieldHundredths: null,
    },
  ],
  leasesNeedingDecision: [],
  leasesEndingSoon: [
    {
      leaseId: "l1",
      propertyId: "p1",
      propertyName: "Property A",
      unitId: "u1",
      unitLabel: "A1",
      tenants: ["Ann Lee"],
      currentRentCents: 200000,
      endDate: "2026-11-26",
      daysLeft: 45,
    },
  ],
};

async function mount(fetchImpl: () => Promise<Response>) {
  vi.stubGlobal("fetch", fetchImpl);
  queryClient.clear();
  document.body.innerHTML = '<div id="root"></div>';
  await act(async () => {
    createRoot(document.getElementById("root") as HTMLElement).render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <Dashboard />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await vi.waitFor(() =>
    expect(document.querySelector('[role="status"]')).toBeNull(),
  );
}

const value = (term: string) =>
  [...document.querySelectorAll("dt")].find((d) => d.textContent === term)
    ?.nextElementSibling?.textContent;
const rowText = (table: string, text: string) =>
  [
    ...(document
      .querySelector(`table[aria-label="${table}"]`)
      ?.querySelectorAll("tbody tr") ?? []),
  ].find((r) => r.textContent?.includes(text));

it("shows the portfolio summary as a definition list with the yield note", async () => {
  await mount(async () => Response.json(dashboard));
  expect(document.querySelector("h1")?.textContent).toBe("Dashboard");
  expect(value("Occupancy")).toBe("75.0%");
  expect(value("Monthly rent roll")).toBe("$6,000.00");
  expect(value("Vacancy loss (monthly)")).toBe("$1,500.00");
  expect(value("Portfolio value")).toBe("$1,000,000.00");
  expect(value("Gross yield")).toBe("6.12%");
  expect(document.body.textContent).toContain(
    "Based on 1 of 2 properties with a value.",
  );
});

it("lists properties with links, a dash for a missing yield, and the lease tables", async () => {
  await mount(async () => Response.json(dashboard));
  const a = rowText("By property", "Property A");
  expect(a?.querySelector("a")?.getAttribute("href")).toBe("/properties/p1");
  expect(a?.querySelector("a")?.className).toContain("max-w-64");
  expect(a?.textContent).toContain("6.12%");
  expect(
    rowText("By property", "Property B")?.lastElementChild?.textContent,
  ).toBe("—");
  expect(
    rowText("Leases ending in the next 90 days", "A1")?.textContent,
  ).toContain("45");
  expect(
    document.querySelector('table[aria-label="Leases needing a decision"]')
      ?.textContent,
  ).toContain("None.");
});

it("lists a lease needing a decision with its end date and last rent, linking the unit to the lease", async () => {
  await mount(async () =>
    Response.json({
      ...dashboard,
      leasesNeedingDecision: [
        {
          leaseId: "l9",
          propertyId: "p1",
          propertyName: "Property A",
          unitId: "u9",
          unitLabel: "ND1",
          tenants: ["Ann Lee", "Bo Chan"],
          currentRentCents: 200000,
          endedOn: "2026-12-31",
        },
      ],
    }),
  );
  const row = rowText("Leases needing a decision", "ND1");
  expect(
    [...(row?.querySelectorAll("td") ?? [])].map((c) => c.textContent),
  ).toEqual([
    "Property A",
    "ND1",
    "Ann Lee, Bo Chan",
    "Dec 31, 2026",
    "$2,000.00",
  ]);
  expect(row?.querySelectorAll("a")[1]?.getAttribute("href")).toBe(
    "/leases/l9",
  );
  expect(document.body.textContent).not.toContain("None.");
});

it("shows an error with Try again when loading fails", async () => {
  await mount(async () => new Response("", { status: 500 }));
  expect(document.querySelector('[role="alert"]')?.textContent).toBe(
    "Something went wrong. Please try again.",
  );
  expect(document.body.textContent).toContain("Try again");
  expect(document.querySelector("table")).toBeNull();
});

it("shows the table headers while the data is still loading", async () => {
  vi.stubGlobal("fetch", () => new Promise<Response>(() => {}));
  queryClient.clear();
  document.body.innerHTML = '<div id="root"></div>';
  await act(async () => {
    createRoot(document.getElementById("root") as HTMLElement).render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <Dashboard />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  const headers = [
    ...document.querySelectorAll('table[aria-label="By property"] th'),
  ].map((h) => h.textContent);
  expect(headers).toContain("Gross yield");
  expect(document.body.textContent).not.toContain("None.");
});

/** Stands in for the app Shell, which keeps watching the signed-in user. */
function MeWatcher() {
  useQuery({ queryKey: ["me"], queryFn: fetchMe });
  return null;
}

async function mountSignedOutDashboard(signOutStatus: number) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${url}`);
    if (url === "/api/auth/sign-out")
      return new Response("{}", { status: signOutStatus });
    if (url === "/api/me")
      return Response.json({
        id: "u",
        name: "Ann",
        email: "a@x.com",
        role: "admin",
        status: "active",
      });
    return new Response("", { status: 401 });
  });
  queryClient.clear();
  document.body.innerHTML = '<div id="root"></div>';
  await act(async () => {
    createRoot(document.getElementById("root") as HTMLElement).render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/"]}>
          <MeWatcher />
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/login" element={<p>Sign in page</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  return calls;
}

it("ends the session and goes to the sign-in page when the dashboard answers 401", async () => {
  const calls = await mountSignedOutDashboard(200);
  await vi.waitFor(() =>
    expect(document.body.textContent).toContain("Sign in page"),
  );
  expect(calls).toContain("POST /api/auth/sign-out");
});

it("stays put and re-checks the signed-in user when signing out fails", async () => {
  const calls = await mountSignedOutDashboard(500);
  await vi.waitFor(() =>
    expect(calls.filter((c) => c === "GET /api/me").length).toBeGreaterThan(1),
  );
  expect(document.body.textContent).not.toContain("Sign in page");
  expect(document.querySelector('[role="alert"]')?.textContent).toBe(
    "Something went wrong. Please try again.",
  );
});
