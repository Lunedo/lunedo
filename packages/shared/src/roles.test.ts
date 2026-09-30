import { describe, expect, it } from "vitest";
import { isServiceRole } from "./roles.js";

describe("isServiceRole", () => {
  it("accepts the application roles", () => {
    expect(["api", "collab", "worker"].every(isServiceRole)).toBe(true);
  });

  it("rejects other values", () => {
    expect(isServiceRole("all")).toBe(false);
    expect(isServiceRole("API")).toBe(false);
  });
});
