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

const checkButton = () => [...document.querySelectorAll("button")].find((b) => b.textContent === "Check file") as HTMLButtonElement;
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 20))));
async function choose(name = "portfolio.xlsx") {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  Object.defineProperty(input, "files", { configurable: true, value: [new File(["x"], name)] });
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

it("labels the file input and lets the user check the file", async () => {
  await mount();
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  expect(document.querySelector(`label[for="${input.id}"]`)?.textContent).toBe("Spreadsheet file");
  expect(input.accept).toBe(".xlsx");
  expect(checkButton()).toBeTruthy();
});

it("asks for a file when none is chosen", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  await mount();
  await act(async () => checkButton().click());
  await settle();
  expect(document.querySelector('[role="alert"]')?.textContent).toBe("Choose an .xlsx file.");
  expect(fetchMock).not.toHaveBeenCalled();
});

it("uploads the file and shows the Ready to import summary", async () => {
  const fetchMock = vi.fn(async () => json({ importRunId: "r1", errors: [], counts: { Owners: 1, Properties: 1, Units: 2, Tenants: 2, Leases: 1 } }));
  vi.stubGlobal("fetch", fetchMock);
  await mount();
  await choose();
  await act(async () => checkButton().click());
  await settle();
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("/api/import/validate");
  expect(init.method).toBe("POST");
  expect((init.body as FormData).get("file")).toBeInstanceOf(File);
  expect(document.body.textContent).toContain("Ready to import: 1 owners, 1 properties, 2 units, 2 tenants, 1 leases.");
});

it("lists problems in a table under the heading", async () => {
  const errors = [{ sheet: "Units", row: 3, column: "Property key", problem: "No property with key 'X' in the Properties sheet." }];
  vi.stubGlobal("fetch", async () => json({ importRunId: "r1", errors, counts: {} }));
  await mount();
  await choose();
  await act(async () => checkButton().click());
  await settle();
  expect(document.querySelector("h2")?.textContent).toBe("We found 1 problem. Fix them in the spreadsheet and check the file again.");
  const cells = [...document.querySelectorAll('table[aria-label="Problems"] tbody td')].map((td) => td.textContent);
  expect(cells).toEqual(["Units", "3", "Property key", "No property with key 'X' in the Properties sheet."]);
  expect(document.body.textContent).not.toContain("Ready to import");
});

it("shows the server's message for a rejected file or a rate limit", async () => {
  vi.stubGlobal("fetch", async () => json({ error: { code: "VALIDATION_ERROR", message: "The file must be 5 MB or smaller." } }, 422));
  await mount();
  await choose();
  await act(async () => checkButton().click());
  await settle();
  expect(document.querySelector('[role="alert"]')?.textContent).toBe("The file must be 5 MB or smaller.");
});

it("Cancel clears the summary", async () => {
  vi.stubGlobal("fetch", async () => json({ importRunId: "r1", errors: [], counts: {} }));
  await mount();
  await choose();
  await act(async () => checkButton().click());
  await settle();
  const cancel = [...document.querySelectorAll("button")].find((b) => b.textContent === "Cancel") as HTMLButtonElement;
  await act(async () => cancel.click());
  expect(document.body.textContent).not.toContain("Ready to import");
});

it("moves focus back to the file input on Cancel", async () => {
  vi.stubGlobal("fetch", async () => json({ importRunId: "r1", errors: [], counts: { Owners: 1 } }));
  await mount();
  await choose();
  await act(async () => checkButton().click());
  await settle();
  const cancel = [...document.querySelectorAll("button")].find((b) => b.textContent === "Cancel") as HTMLButtonElement;
  await act(async () => cancel.click());
  expect(document.activeElement).toBe(document.querySelector('input[type="file"]'));
});
