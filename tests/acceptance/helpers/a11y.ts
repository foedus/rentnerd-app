/** Accessibility helpers: axe scans, keyboard-only driving, focus indicator and target size checks. */
import AxeBuilder from '@axe-core/playwright';
import { expect, type Locator, type Page } from '@playwright/test';

export async function expectNoAxeViolations(page: Page, label: string) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const summary = r.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')})`);
  expect(summary, `axe violations on ${label}`).toEqual([]);
}

export type FocusReport = { ok: boolean; desc: string };

/**
 * Checks the focused element's indicator: ≥ 2 px outline (or box-shadow ring) with ≥ 3:1 contrast
 * against the background. Colours are resolved through a canvas, so any CSS colour syntax works
 * (rgb, hex, oklch, …). A visually hidden native input (custom checkbox, radio or switch, as React
 * Aria renders them) shows its focus on its label, so the label and its children are checked instead.
 */
export async function focusIndicator(page: Page): Promise<FocusReport | null> {
  return await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body || el === document.documentElement) return null;
    const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
    const rgba = (c: string): [number, number, number, number] => {
      if (!c || c === 'transparent') return [0, 0, 0, 0];
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = 'rgba(0, 0, 0, 0)';
      ctx.fillStyle = c;
      ctx.fillRect(0, 0, 1, 1);
      const d = ctx.getImageData(0, 0, 1, 1).data;
      return [d[0], d[1], d[2], d[3] / 255];
    };
    const lum = ([r, g, b]: number[]) => {
      const f = (v: number) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const background = (node: Element | null): number[] => {
      for (let n = node; n; n = n.parentElement) {
        const c = rgba(getComputedStyle(n).backgroundColor);
        if (c[3] > 0.5) return c;
      }
      return [255, 255, 255, 1];
    };
    const blend = (fg: number[], bg: number[]) => [0, 1, 2].map((i) => fg[i] * fg[3] + bg[i] * (1 - fg[3]));
    const ratio = (a: number[], b: number[]) => {
      const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
      return (l1 + 0.05) / (l2 + 0.05);
    };
    const COLOR = /(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^)]*\)|#[0-9a-f]{3,8}\b/i;
    const indicators = (node: Element) => {
      const cs = getComputedStyle(node);
      const bg = background(node.parentElement);
      const found: { width: number; contrast: number }[] = [];
      const add = (width: number, color: string) => found.push({ width, contrast: ratio(blend(rgba(color), bg), bg) });
      if (cs.outlineStyle !== 'none') add(parseFloat(cs.outlineWidth) || 0, cs.outlineColor);
      for (const shadow of cs.boxShadow === 'none' ? [] : cs.boxShadow.split(/,(?![^(]*\))/)) {
        const color = shadow.match(COLOR)?.[0] ?? 'rgb(0, 0, 0)';
        const lengths = shadow.replace(COLOR, '').replace('inset', '').trim().split(/\s+/).map((x) => parseFloat(x));
        const [x = 0, y = 0, blur = 0, spread = 0] = lengths;
        if (!shadow.includes('inset') && x === 0 && y === 0 && blur === 0) add(spread, color);
      }
      return found;
    };
    // Visually hidden: the input or a wrapper within two levels is clipped to ≤ 2 px (React Aria's VisuallyHidden).
    const tiny = (n: Element | null) => !!n && (n.getBoundingClientRect().width <= 2 || n.getBoundingClientRect().height <= 2);
    let nodes: Element[] = [el];
    if (tiny(el) || tiny(el.parentElement) || tiny(el.parentElement?.parentElement ?? null)) {
      const label = (el as HTMLInputElement).labels?.[0] ?? el.closest('label');
      if (label) nodes = [label, ...Array.from(label.querySelectorAll('*')).slice(0, 30)];
    }
    const best = nodes
      .flatMap(indicators)
      .sort((a, b) => b.width * Math.min(b.contrast, 3) - a.width * Math.min(a.contrast, 3))[0];
    const name = `${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 40)}"`;
    if (!best) return { ok: false, desc: `${name}: no focus indicator` };
    return { ok: best.width >= 2 && best.contrast >= 3, desc: `${name}: width ${best.width}px contrast ${best.contrast.toFixed(2)}` };
  });
}

/** Keyboard-only driver that also checks the focus indicator of every element it tabs through. */
export class Keyboard {
  failures: string[] = [];
  constructor(private page: Page) {}

  private async check() {
    const r = await focusIndicator(this.page);
    if (r && !r.ok) this.failures.push(r.desc);
  }

  async tabTo(target: Locator, max = 200) {
    for (let i = 0; i < max; i++) {
      if (await target.evaluate((el) => el === document.activeElement || el.contains(document.activeElement)).catch(() => false)) return;
      await this.page.keyboard.press('Tab');
      await this.check();
    }
    throw new Error(`Could not reach ${target} with Tab`);
  }

  async type(target: Locator, value: string) {
    await this.tabTo(target);
    await this.page.keyboard.press('ControlOrMeta+A');
    await this.page.keyboard.type(value);
  }

  /** Native date inputs take digits in the US month/day/year order. */
  async date(target: Locator, iso: string) {
    const [y, m, d] = iso.split('-');
    await this.tabTo(target);
    await this.page.keyboard.type(`${m}${d}${y}`);
  }

  async press(target: Locator, key = 'Enter') {
    await this.tabTo(target);
    await this.page.keyboard.press(key);
  }

  /** Selects an option in a native select, radio group or listbox-based select using arrow keys. */
  async choose(target: Locator, option: string) {
    await this.tabTo(target);
    const kind = await target.evaluate((el) => (el.tagName === 'SELECT' ? 'select' : el.getAttribute('role') === 'radiogroup' || el.querySelector('input[type=radio]') ? 'radio' : 'popup'));
    const current = async () =>
      await this.page.evaluate(() => {
        const a = document.activeElement as HTMLElement | null;
        if (!a) return '';
        if (a instanceof HTMLSelectElement) return a.selectedOptions[0]?.textContent?.trim() ?? '';
        if (a instanceof HTMLInputElement && a.type === 'radio') return (a.labels?.[0]?.textContent ?? a.getAttribute('aria-label') ?? '').trim();
        const id = a.getAttribute('aria-activedescendant');
        const active = id ? document.getElementById(id) : a;
        return (active?.textContent ?? '').trim();
      });
    if (kind === 'popup') await this.page.keyboard.press('Enter');
    for (let i = 0; i < 60; i++) {
      if ((await current()) === option) break;
      await this.page.keyboard.press('ArrowDown');
    }
    expect(await current()).toBe(option);
    if (kind === 'popup') await this.page.keyboard.press('Enter');
  }

  expectIndicators() {
    expect(this.failures, 'focus indicators (≥ 2 px, ≥ 3:1)').toEqual([]);
  }
}

/** Targets smaller than 24×24 CSS px among buttons, form controls, nav links and table links. */
export async function smallTargets(page: Page): Promise<string[]> {
  return await page.evaluate(() => {
    const bad: string[] = [];
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return cs.visibility !== 'hidden' && cs.display !== 'none' && r.width > 0 && r.height > 0;
    };
    const els = Array.from(document.querySelectorAll('button, input:not([type=hidden]), select, textarea, [role=button], [role=checkbox], [role=switch], [role=radio], [role=combobox], [role=tab], nav a, td a, th a'));
    for (const el of els) {
      if (!visible(el)) continue;
      let r = el.getBoundingClientRect();
      // Visually hidden native inputs (custom checkboxes/radios, possibly inside a clipped
      // wrapper as React Aria renders them) are measured by their label.
      const tiny = (n: Element | null) => !!n && (n.getBoundingClientRect().width <= 2 || n.getBoundingClientRect().height <= 2);
      if (tiny(el) || tiny(el.parentElement) || tiny(el.parentElement?.parentElement ?? null)) {
        const label = (el as HTMLInputElement).labels?.[0] ?? el.closest('label');
        if (!label) continue;
        r = label.getBoundingClientRect();
      }
      if (r.width < 24 - 0.5 || r.height < 24 - 0.5) {
        bad.push(`${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30)}" ${r.width.toFixed(0)}×${r.height.toFixed(0)}`);
      }
    }
    return bad;
  });
}
