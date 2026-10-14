// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { TooManyRequestsError } from "../api";
import { AppForm, flattenErrors, TextFieldInput, useAppForm, VersionConflictError, withoutThousandsCommas } from "./forms";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const schema = z.object({
  name: z.string().trim().min(1, "Enter the owner name."),
  city: z.string().trim().min(1, "Enter the city."),
});

function Demo({ save, onReload }: { save: (v: z.output<typeof schema>) => Promise<void>; onReload?: () => void }) {
  const form = useAppForm(schema, { name: "", city: "" });
  return (
    <AppForm form={form} thing="Owner" save={save} submitLabel="Save owner" onReload={onReload}>
      <TextFieldInput name="name" label="Owner name" required />
      <TextFieldInput name="city" label="City" required />
    </AppForm>
  );
}

async function mount(save: (v: z.output<typeof schema>) => Promise<void>, onReload?: () => void) {
  document.body.innerHTML = '<div id="root"></div>';
  await act(async () => {
    createRoot(document.getElementById("root") as HTMLElement).render(<Demo save={save} onReload={onReload} />);
  });
}
const tick = () => act(async () => void (await new Promise((r) => setTimeout(r, 10))));
const submit = async () => {
  await act(async () => {
    (document.querySelector("button[type=submit]") as HTMLButtonElement).click();
  });
  await tick();
};
const type = async (id: string, v: string) => {
  const el = document.getElementById(id) as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

describe("form kit", () => {
  it("marks required labels", async () => {
    await mount(async () => {});
    expect(document.querySelector("label")?.textContent).toBe("Owner name (required)");
  });

  it("shows a focused summary linking to fields, and links errors with aria-describedby", async () => {
    const save = vi.fn(async () => {});
    await mount(save);
    await submit();
    expect(save).not.toHaveBeenCalled();
    const summary = document.querySelector("[role=alert] h2")?.parentElement as HTMLElement;
    expect(summary.textContent).toContain("There is a problem");
    expect(document.activeElement).toBe(summary);
    const links = [...summary.querySelectorAll("a")];
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["#field-name", "#field-city"]);
    const input = document.getElementById("field-name") as HTMLInputElement;
    expect(input.getAttribute("aria-invalid")).toBe("true");
    const err = document.getElementById(input.getAttribute("aria-describedby") ?? "");
    expect(err?.textContent).toBe("Enter the owner name.");
    await act(async () => links[1]?.click());
    expect(document.activeElement?.id).toBe("field-city");
  });

  it("announces '{Thing} saved.' in an existing polite live region", async () => {
    await mount(async () => {});
    const region = document.querySelector("[aria-live=polite]") as HTMLElement;
    expect(region.textContent).toBe("");
    await type("field-name", "Ann");
    await type("field-city", "Boston");
    await submit();
    expect(document.querySelector("[aria-live=polite]")).toBe(region);
    expect(region.textContent).toBe("Owner saved.");
    expect(document.body.textContent).not.toContain("There is a problem");
  });

  it("shows the conflict alert with Reload", async () => {
    const reload = vi.fn();
    await mount(async () => {
      throw new VersionConflictError();
    }, reload);
    await type("field-name", "Ann");
    await type("field-city", "Boston");
    await submit();
    const alert = document.querySelector("[role=alert]") as HTMLElement;
    expect(alert.textContent).toContain("Someone else changed this record. Reload to see the latest version.");
    expect(document.activeElement).toBe(alert);
    await act(async () => (alert.querySelector("button") as HTMLButtonElement).click());
    expect(reload).toHaveBeenCalled();
  });

  it("shows the unexpected-error and rate-limit messages", async () => {
    await mount(async () => {
      throw new Error("boom");
    });
    await type("field-name", "Ann");
    await type("field-city", "Boston");
    await submit();
    expect(document.querySelector("[role=alert]")?.textContent).toBe("Something went wrong. Please try again.");
    await mount(async () => {
      throw new TooManyRequestsError("Too many attempts. Try again in a few minutes.");
    });
    await type("field-name", "Ann");
    await type("field-city", "Boston");
    await submit();
    expect(document.querySelector("[role=alert]")?.textContent).toBe("Too many attempts. Try again in a few minutes.");
  });

  it("flattens nested errors", () => {
    expect(flattenErrors({ a: { message: "x", type: "t" }, b: [{ c: { message: "y", type: "t" } }] } as never)).toEqual([
      { path: "a", message: "x" },
      { path: "b.0.c", message: "y" },
    ]);
  });
});

it("reads thousands separators but leaves other comma use for the schema to refuse", () => {
  expect(withoutThousandsCommas("1,200")).toBe("1200");
  expect(withoutThousandsCommas("1,234,567.5")).toBe("1234567.5");
  expect(withoutThousandsCommas("1,5")).toBe("1,5");
  expect(withoutThousandsCommas("12,34")).toBe("12,34");
});
