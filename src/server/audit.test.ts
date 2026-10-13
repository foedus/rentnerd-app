import { describe, expect, it } from "vitest";
import { describeChanges, diffChanges } from "./audit";

describe("diffChanges", () => {
  const labels = { name: "Name", rentCents: "Monthly rent" };
  it("lists only the fields that changed, under their people-friendly labels", () => {
    const changes = diffChanges({ name: "Ann", rentCents: 215000 }, { name: "Ann", rentCents: 220000 }, labels, (v) => `$${Number(v) / 100}`);
    expect(changes).toEqual({ "Monthly rent": ["$2150", "$2200"] });
  });
  it("keeps missing values as null", () => {
    expect(diffChanges({ name: null }, { name: "Bo" }, labels)).toEqual({ Name: [null, "Bo"] });
  });
  it("never includes password, hash, token or session fields", () => {
    const changes = diffChanges(
      { password: "a", passwordHash: "b", token: "c", sessionId: "d", name: "x" },
      { password: "e", passwordHash: "f", token: "g", sessionId: "h", name: "y" },
      { password: "Password", passwordHash: "Hash", token: "Token", sessionId: "Session", name: "Name" },
    );
    expect(changes).toEqual({ Name: ["x", "y"] });
  });
});

describe("describeChanges", () => {
  it("formats lines for people", () => {
    expect(describeChanges({ "Monthly rent": ["$2,150.00", "$2,200.00"], Notes: [null, "Hi"] })).toEqual([
      "Monthly rent: $2,150.00 → $2,200.00",
      "Notes: — → Hi",
    ]);
  });
});
