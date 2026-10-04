import { describe, expect, it } from "vitest";
import { needsHttpsWarning } from "./addresses.js";

describe("the HTTPS warning for the instance address", () => {
  it("warns about plain HTTP on other hosts", () => {
    expect(needsHttpsWarning("http://wiki.example.org")).toBe(true);
    expect(needsHttpsWarning("http://192.168.1.20:8080")).toBe(true);
  });

  it("does not warn about HTTPS, loopback addresses or unfinished input", () => {
    for (const address of [
      "https://wiki.example.org",
      "http://localhost:5173",
      "http://127.0.0.1:3000",
      "http://[::1]:3000",
      "http://wiki.localhost",
      "wiki.example",
    ]) {
      expect(needsHttpsWarning(address)).toBe(false);
    }
  });
});
