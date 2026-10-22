import { describe, expect, it } from "vitest";
import { publicAddress } from "./public-address.js";

describe("the public address of the development server", () => {
  it("serves a public HTTPS hostname with secure hot reload and forwarded headers", () => {
    expect(publicAddress("https://lunedo-test.example.org")).toEqual({
      hostname: "lunedo-test.example.org",
      port: 443,
      socketProtocol: "wss",
      forwardedHeaders: { "x-forwarded-proto": "https", "x-forwarded-host": "lunedo-test.example.org" },
    });
  });

  it("keeps the local defaults for loopback addresses, missing and invalid values", () => {
    for (const value of [
      undefined,
      "",
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "http://wiki.localhost",
      "not a url",
    ]) {
      expect(publicAddress(value)).toBeNull();
    }
  });
});
