import { describe, expect, it } from "vitest";
import { genericOidcConfigSchema } from "./identity-providers.js";

describe("genericOidcConfigSchema", () => {
  it("keeps the issuer exactly as given, because OpenID Connect compares it character by character", () => {
    const config = genericOidcConfigSchema.parse({
      preset: "generic",
      clientId: "pagehall",
      issuer: "https://authentik.example.org/application/o/pagehall/",
    });
    expect(config.issuer).toBe("https://authentik.example.org/application/o/pagehall/");
  });
});
