import { describe, expect, it } from "vitest";
import { completeWebAddress, isWebAddress, needsHttpsWarning } from "./addresses.js";

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
