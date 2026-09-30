import { describe, expect, it } from "vitest";
import { editorSchemaVersion } from "./index.js";

describe("editorSchemaVersion", () => {
  it("is a positive integer", () => {
    expect(Number.isInteger(editorSchemaVersion)).toBe(true);
    expect(editorSchemaVersion).toBeGreaterThan(0);
  });
});
