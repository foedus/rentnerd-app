// @vitest-environment happy-dom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { ConfirmDialog, DataTable, MoneyInput, Pagination, ReasonButton } from "./ui";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function mount(node: React.ReactNode) {
  document.body.innerHTML = '<div id="root"></div>';
  await act(async () => {
    createRoot(document.getElementById("root") as HTMLElement).render(node);
  });
}
const click = (el: Element | null) =>
  act(async () => {
    (el as HTMLElement).click();
  });
const byText = (sel: string, text: string) => [...document.querySelectorAll(sel)].find((e) => e.textContent === text) ?? null;
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 20))));

function DialogDemo({ onConfirm }: { onConfirm: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Delete owner</button>
      <ConfirmDialog isOpen={open} onOpenChange={setOpen} title="Delete Ann?" confirmLabel="Delete" onConfirm={onConfirm}>
        This cannot be undone.
      </ConfirmDialog>
    </>
  );
}

describe("ConfirmDialog", () => {
  it("focuses Cancel, closes on Escape and returns focus to the opener", async () => {
    await mount(<DialogDemo onConfirm={() => {}} />);
    const opener = byText("button", "Delete owner") as HTMLButtonElement;
    opener.focus();
    await click(opener);
    await settle();
    const dialog = document.querySelector("[role=dialog]");
    expect(dialog?.textContent).toContain("Delete Ann?");
    expect(document.activeElement?.textContent).toBe("Cancel");
    await act(async () => {
      document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      document.activeElement?.dispatchEvent(new KeyboardEvent("keyup", { key: "Escape", bubbles: true }));
    });
    await settle();
    expect(document.querySelector("[role=dialog]")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("Cancel closes without confirming; the confirm button confirms", async () => {
    const onConfirm = vi.fn();
    await mount(<DialogDemo onConfirm={onConfirm} />);
    await click(byText("button", "Delete owner"));
    await settle();
    await click(byText("button", "Cancel"));
    await settle();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(document.querySelector("[role=dialog]")).toBeNull();
    await click(byText("button", "Delete owner"));
    await settle();
    await click(byText("button", "Delete"));
    await settle();
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(document.querySelector("[role=dialog]")).toBeNull();
  });
});

describe("ReasonButton", () => {
  it("is aria-disabled, focusable, described and inert when unavailable", async () => {
    const onPress = vi.fn();
    await mount(
      <ReasonButton onPress={onPress} unavailableReason="Owners used by properties or units can only be archived">
        Delete owner
      </ReasonButton>,
    );
    const b = document.querySelector("button") as HTMLButtonElement;
    expect(b.getAttribute("aria-disabled")).toBe("true");
    expect(b.disabled).toBe(false);
    const desc = document.getElementById(b.getAttribute("aria-describedby") ?? "");
    expect(desc?.textContent).toBe("Owners used by properties or units can only be archived");
    b.focus();
    expect(document.activeElement).toBe(b);
    await click(b);
    expect(onPress).not.toHaveBeenCalled();
  });

  it("works normally when available", async () => {
    const onPress = vi.fn();
    await mount(<ReasonButton onPress={onPress}>Delete owner</ReasonButton>);
    const b = document.querySelector("button") as HTMLButtonElement;
    expect(b.hasAttribute("aria-disabled")).toBe(false);
    expect(b.hasAttribute("aria-describedby")).toBe(false);
    await click(b);
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe("MoneyInput", () => {
  function Demo({ onValue }: { onValue: (c: number | null) => void }) {
    const [v, setV] = useState<number | null>(null);
    return (
      <MoneyInput
        id="rent"
        label="Monthly rent"
        required
        value={v}
        onChange={(c) => {
          setV(c);
          onValue(c);
        }}
      />
    );
  }
  const type = async (input: HTMLInputElement, text: string) => {
    await act(async () => {
      input.focus();
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, text);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      input.blur();
    });
  };

  it.each(["2150", "2,150", "2150.00"])("turns %s into $2,150.00 (215000 cents)", async (text) => {
    const onValue = vi.fn();
    await mount(<Demo onValue={onValue} />);
    const input = document.getElementById("rent") as HTMLInputElement;
    expect(document.querySelector("label")?.textContent).toBe("Monthly rent (required)");
    await type(input, text);
    expect(onValue).toHaveBeenLastCalledWith(215000);
    expect(input.value).toBe("$2,150.00");
  });

  it("reports null and leaves invalid text alone", async () => {
    const onValue = vi.fn();
    await mount(<Demo onValue={onValue} />);
    const input = document.getElementById("rent") as HTMLInputElement;
    await type(input, "abc");
    expect(onValue).toHaveBeenLastCalledWith(null);
    expect(input.value).toBe("abc");
  });
});

describe("DataTable", () => {
  it("names the table and wraps it in a focusable scrollable region", async () => {
    await mount(
      <DataTable name="Owners" columns={[{ key: "n", header: "Name", cell: (r: { n: string }) => r.n }]} rows={[{ n: "Ann" }, { n: "Bo" }]} rowKey={(r) => r.n} />,
    );
    const table = document.querySelector("table");
    expect(table?.getAttribute("aria-label")).toBe("Owners");
    const region = table?.parentElement as HTMLElement;
    expect(region.getAttribute("role")).toBe("region");
    expect(region.tabIndex).toBe(0);
    expect(region.className).toContain("overflow-x-auto");
    expect([...document.querySelectorAll("tbody td")].map((c) => c.textContent)).toEqual(["Ann", "Bo"]);
    expect(document.querySelector("th")?.getAttribute("scope")).toBe("col");
  });

  it("shows the empty message", async () => {
    await mount(<DataTable name="Owners" columns={[{ key: "n", header: "Name", cell: (r: { n: string }) => r.n }]} rows={[]} rowKey={(r) => r.n} emptyMessage="No owners yet." />);
    expect(document.querySelector("tbody")?.textContent).toBe("No owners yet.");
  });
});

describe("Pagination", () => {
  it("shows Page X of Y and gates Previous/Next at the ends", async () => {
    const onPage = vi.fn();
    await mount(<Pagination page={1} pageSize={50} total={120} onPageChange={onPage} />);
    expect(document.body.textContent).toContain("Page 1 of 3");
    const prev = byText("button", "Previous") as HTMLElement;
    const next = byText("button", "Next") as HTMLElement;
    expect(prev.getAttribute("aria-disabled")).toBe("true");
    expect(next.hasAttribute("aria-disabled")).toBe(false);
    await click(prev);
    expect(onPage).not.toHaveBeenCalled();
    await click(next);
    expect(onPage).toHaveBeenCalledWith(2);
  });

  it("disables Next on the last page and shows Page 1 of 1 when empty", async () => {
    const onPage = vi.fn();
    await mount(<Pagination page={3} pageSize={50} total={120} onPageChange={onPage} />);
    expect(byText("button", "Next")?.getAttribute("aria-disabled")).toBe("true");
    await click(byText("button", "Previous"));
    expect(onPage).toHaveBeenCalledWith(2);
    await mount(<Pagination page={1} pageSize={50} total={0} onPageChange={onPage} />);
    expect(document.body.textContent).toContain("Page 1 of 1");
  });
});
