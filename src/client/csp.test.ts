import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

// The CSP forbids inline styles, so React Aria's runtime <style> must be pre-empted (see index.html).
it("ships React Aria's pressable rule in styles.css and a placeholder that stops its inline <style>", () => {
  const html = readFileSync("src/client/index.html", "utf8");
  const css = readFileSync("src/client/styles.css", "utf8");
  expect(html).toContain('id="react-aria-pressable-style"');
  expect(html).not.toMatch(/<style[\s>]/);
  expect(css).toContain("[data-react-aria-pressable]");
});
