import { describe, expect, it } from "vitest";
import { pushText } from "./texts.js";

describe("push texts", () => {
  it("name the kind of an expiring provider credential", () => {
    const title = (language: "en" | "de", credential: string | null) =>
      pushText("identityProvider.credentialExpiring", language, {
        params: { providerName: "Entra", credential },
        actor: null,
        actorCount: 0,
      }).title;
    expect(title("en", "signingCertificate")).toBe(
      "A signing certificate for a sign-in provider expires soon",
    );
    expect(title("en", "graphCredential")).toBe(
      "A Microsoft Graph credential of a sign-in provider expires soon",
    );
    expect(title("en", null)).toBe("A sign-in provider credential expires soon");
    expect(title("de", "signingCertificate")).toBe(
      "Ein Signaturzertifikat für einen Anmeldeanbieter läuft bald ab",
    );
  });
});
