import { describe, expect, it } from "vitest";
import { fieldErrorId, fieldId, fieldLabel, savedMessage } from "./form-messages";

describe("form messages", () => {
  it("builds the saved message", () => expect(savedMessage("Owner")).toBe("Owner saved."));
  it("marks required labels", () => {
    expect(fieldLabel("City", true)).toBe("City (required)");
    expect(fieldLabel("Notes", false)).toBe("Notes");
  });
  it("makes safe ids from dotted paths", () => {
    expect(fieldId("tenants.0.name")).toBe("field-tenants-0-name");
    expect(fieldErrorId("city")).toBe("field-city-error");
  });
});
