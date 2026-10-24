import { describe, expect, it } from "vitest";
import { completeWebAddress, isWebAddress } from "./addresses.js";

describe("completing web addresses", () => {
  it("adds https:// when the scheme is missing and keeps complete addresses", () => {
    expect(completeWebAddress(" status.example.org/vpn ")).toBe("https://status.example.org/vpn");
    expect(completeWebAddress("localhost:8080/hook")).toBe("https://localhost:8080/hook");
    expect(completeWebAddress("http://wiki.example.org")).toBe("http://wiki.example.org");
    expect(completeWebAddress("ftp://files.example.org")).toBe("ftp://files.example.org");
    expect(completeWebAddress("  ")).toBe("");
    for (const value of ["javascript:alert(1)", "data:text/html,x", "/spaces/X", "mailto:ops@example.org"]) {
      expect(completeWebAddress(value)).toBe(value);
    }
  });

  it("accepts only http and https addresses with a host", () => {
    expect(isWebAddress(completeWebAddress("wiki.example.org/maintenance"))).toBe(true);
    expect(isWebAddress("ftp://files.example.org")).toBe(false);
    expect(isWebAddress("https://hooks example")).toBe(false);
  });
});
