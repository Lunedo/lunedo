import { describe, expect, it } from "vitest";
import { acceptsClientApiLevel, CLIENT_API_LEVEL, clientApiLevel } from "./client-build.js";

describe("client API level", () => {
  it("reads whole numbers only", () => {
    expect(clientApiLevel("3")).toBe(3);
    expect(clientApiLevel(" 12 ")).toBe(12);
    expect(clientApiLevel("1.5")).toBeNull();
    expect(clientApiLevel("abc")).toBeNull();
    expect(clientApiLevel(undefined)).toBeNull();
  });

  it("accepts the current and newer clients and requests without the header, and refuses older clients", () => {
    expect(acceptsClientApiLevel(String(CLIENT_API_LEVEL))).toBe(true);
    expect(acceptsClientApiLevel(String(CLIENT_API_LEVEL + 1))).toBe(true);
    expect(acceptsClientApiLevel(undefined)).toBe(true);
    expect(acceptsClientApiLevel("1", 2)).toBe(false);
  });
});
