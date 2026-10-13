import { describe, expect, it } from "vitest";
import { EMAIL_FOOTER, renderEmail } from "./email-layout";

describe("renderEmail", () => {
  const email = renderEmail({
    heading: "Hello <b>",
    paragraphs: ["Rent & fees"],
    action: { label: "Open", url: "https://rentnerd-app.fly.dev/x?a=1&b=2" },
  });

  it("produces text and html parts that both end with the footer", () => {
    expect(EMAIL_FOOTER).toBe("RentNerd · private landlord tools");
    expect(email.text.trimEnd().endsWith(EMAIL_FOOTER)).toBe(true);
    expect(email.html).toContain(EMAIL_FOOTER);
    expect(email.text).toContain("Open: https://rentnerd-app.fly.dev/x?a=1&b=2");
  });

  it("escapes html in the html part only", () => {
    expect(email.html).toContain("Hello &lt;b&gt;");
    expect(email.html).toContain("Rent &amp; fees");
    expect(email.html).toContain('href="https://rentnerd-app.fly.dev/x?a=1&amp;b=2"');
    expect(email.text).toContain("Hello <b>");
  });

  it("omits the action when there is none", () => {
    const plain = renderEmail({ heading: "H", paragraphs: ["p"] });
    expect(plain.html).not.toContain("<a ");
  });
});
