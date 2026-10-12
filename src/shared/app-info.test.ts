import { describe, expect, it } from "vitest";
import { APP_NAME, appBanner } from "./app-info";

describe("appBanner", () => {
  it("names the app and the process", () => {
    expect(appBanner("web")).toBe(`${APP_NAME} web`);
  });
});
