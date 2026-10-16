// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { TemplateEditor } from "./TemplateEditor";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOTICE = "Some content was removed: images, headers and other unsupported items aren't allowed in templates.";
const wait = () => act(async () => void (await new Promise((r) => setTimeout(r, 60))));

function pasteHtml(target: Element, html: string) {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: { getData: (t: string) => (t === "text/html" ? html : ""), types: ["text/html"], files: [], items: [] } });
  target.dispatchEvent(event);
}

it("shows the removal notice after a paste that strips content and clears it after a clean paste", async () => {
  document.body.innerHTML = '<div id="root"></div>';
  const root = createRoot(document.getElementById("root") as HTMLElement);
  await act(async () => root.render(<TemplateEditor kind="master_lease" onChange={() => undefined} />));
  await wait();
  const surface = document.querySelector('[aria-label="Template content"]') as HTMLElement;
  await act(async () => pasteHtml(surface, '<p>Hi <a href="https://e.com">link</a></p>'));
  await wait();
  expect(document.body.textContent).toContain(NOTICE);
  await act(async () => pasteHtml(surface, "<p>plain</p>"));
  await wait();
  expect(document.body.textContent).not.toContain(NOTICE);
  await act(async () => root.unmount());
});
