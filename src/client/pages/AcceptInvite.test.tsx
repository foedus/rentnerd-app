// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { AcceptInvite } from "./AcceptInvite";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => vi.unstubAllGlobals());

const INVALID = "This invitation is invalid or has expired. Ask the administrator to send a new one.";

async function mount(start: string) {
  document.body.innerHTML = '<div id="root"></div>';
  await act(async () => {
    createRoot(document.getElementById("root") as HTMLElement).render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={[start]}>
          <Routes>
            <Route path="/accept-invite" element={<AcceptInvite />} />
            <Route path="/" element={<h1>Dashboard</h1>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const set = (el: HTMLInputElement, v: string) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(el, v);
  el.dispatchEvent(new Event("input", { bubbles: true }));
};
const submit = async (values: [string, string, string]) => {
  const inputs = [...document.querySelectorAll("input")] as HTMLInputElement[];
  await act(async () => values.forEach((v, i) => set(inputs[i] as HTMLInputElement, v)));
  await act(async () => {
    document.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
};

it("shows the invalid message without a token", async () => {
  await mount("/accept-invite");
  expect(document.body.textContent).toContain(INVALID);
});

it("shows the invalid message when the server rejects the token", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(404, { error: { code: "NOT_FOUND", message: INVALID } })));
  await mount("/accept-invite?token=used");
  expect(document.body.textContent).toContain(INVALID);
  expect(document.querySelector("form")).toBeNull();
});

it("greets the invitee with a prefilled name, validates, then creates the account and opens the Dashboard", async () => {
  const fetchMock = vi.fn(async (url: string) =>
    url.startsWith("/api/invitations/lookup") ? json(200, { email: "pat@example.com", name: "Pat Lee" }) : json(200, { ok: true }),
  );
  vi.stubGlobal("fetch", fetchMock);
  await mount("/accept-invite?token=abc");
  expect(document.body.textContent).toContain("You're joining RentNerd as pat@example.com.");
  expect((document.querySelector("input") as HTMLInputElement).value).toBe("Pat Lee");

  await submit(["Pat Lee", "short", "short"]);
  expect(document.body.textContent).toContain("Password must be at least 12 characters.");
  await submit(["Pat Lee", "Long-enough-password-1", "Long-enough-password-2"]);
  expect(document.body.textContent).toContain("Passwords don't match.");
  expect(fetchMock).toHaveBeenCalledTimes(1);

  await submit(["Pat Lee", "Long-enough-password-1", "Long-enough-password-1"]);
  const post = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
  expect(post[0]).toBe("/api/invitations/accept");
  expect(JSON.parse(String(post[1].body))).toEqual({ token: "abc", name: "Pat Lee", password: "Long-enough-password-1" });
  expect(document.querySelector("h1")?.textContent).toBe("Dashboard");
});

it("shows the invalid message if the link is used up before submitting", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url.startsWith("/api/invitations/lookup") ? json(200, { email: "pat@example.com", name: "Pat" }) : json(404, {}),
    ),
  );
  await mount("/accept-invite?token=abc");
  await submit(["Pat", "Long-enough-password-1", "Long-enough-password-1"]);
  expect(document.body.textContent).toContain(INVALID);
});

it("shows a friendly message and focuses it when the network fails", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.startsWith("/api/invitations/lookup")) return json(200, { email: "pat@example.com", name: "Pat" });
      throw new TypeError("Failed to fetch");
    }),
  );
  await mount("/accept-invite?token=abc");
  await submit(["Pat", "Long-enough-password-1", "Long-enough-password-1"]);
  expect(document.body.textContent).toContain("Something went wrong. Please try again.");
  expect(document.body.textContent).not.toContain("Failed to fetch");
  expect(document.activeElement?.textContent).toBe("Something went wrong. Please try again.");
});
