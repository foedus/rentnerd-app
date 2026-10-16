// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { Import } from "./Import";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => vi.unstubAllGlobals());

async function mount() {
  document.body.innerHTML = '<div id="root"></div>';
  await act(async () => createRoot(document.getElementById("root") as HTMLElement).render(<Import />));
}
const download = () => [...document.querySelectorAll("button")].find((b) => b.textContent === "Download template") as HTMLButtonElement;

it("shows the instructions, the heading and Download template", async () => {
  await mount();
  expect(document.querySelector("h1")?.textContent).toBe("Import");
  expect(document.body.textContent).toContain("Owners, Properties, Units, Tenants, Leases");
  expect(download()).toBeTruthy();
});

it("downloads rentnerd-import-template.xlsx", async () => {
  const fetchMock = vi.fn(async () => new Response(new Blob(["x"])));
  vi.stubGlobal("fetch", fetchMock);
  const created = vi.fn(() => "blob:x");
  Object.assign(URL, { createObjectURL: created, revokeObjectURL: vi.fn() });
  let name = "";
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    name = this.download;
  });
  await mount();
  await act(async () => download().click());
  await act(async () => void (await new Promise((r) => setTimeout(r, 20))));
  expect(fetchMock).toHaveBeenCalledWith("/api/import/template");
  expect(click).toHaveBeenCalled();
  expect(name).toBe("rentnerd-import-template.xlsx");
});

it("shows a message when the download fails", async () => {
  vi.stubGlobal("fetch", async () => new Response("x", { status: 500 }));
  await mount();
  await act(async () => download().click());
  await act(async () => void (await new Promise((r) => setTimeout(r, 20))));
  expect(document.querySelector('[role="alert"]')?.textContent).toBe("Something went wrong. Please try again.");
});
