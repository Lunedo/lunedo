import { describe, expect, it } from "vitest";
import type { OidcConfig, SamlConfig } from "../../api/identity-queries.js";
import { oidcConfigInput, samlConfigInput } from "./provider-config.js";

const common = {
  clientId: "pagehall",
  domains: ["example.org"],
  idTokenAlgorithm: "RS256" as const,
  accountCreation: { enabled: true, requiredGroups: [] },
  sync: { intervalMinutes: 240, deactivationLimitPercent: 20 },
  secondFactor: { mode: "providerProof" as const, proofValues: ["hwk"] },
};

describe("oidcConfigInput", () => {
  it("keeps the sync interval and the Google directory when another field is saved", () => {
    const input = oidcConfigInput({
      preset: "google",
      ...common,
      issuer: "https://accounts.google.com",
      directory: {
        method: "delegation",
        adminEmail: "admin@example.org",
        readUsers: false,
        url: "https://admin.googleapis.com",
        tokenUrl: "https://oauth2.googleapis.com/token",
      },
    } as OidcConfig);
    expect(input).toMatchObject({
      sync: { intervalMinutes: 240, deactivationLimitPercent: 20 },
      directory: { method: "delegation", adminEmail: "admin@example.org", readUsers: false },
    });
  });

  it("keeps the names claim of a generic provider", () => {
    const input = oidcConfigInput({
      preset: "generic",
      ...common,
      issuer: "https://keycloak.example.org/realms/pagehall",
      scopes: ["openid"],
      claims: {
        email: "email",
        signInName: "preferred_username",
        displayName: "name",
        groups: "groups",
        groupNames: "group_names",
      },
    } as OidcConfig);
    expect(input).toMatchObject({
      sync: { intervalMinutes: 240, deactivationLimitPercent: 20 },
      claims: { groupNames: "group_names" },
    });
  });
});

describe("samlConfigInput", () => {
  it("keeps the switches and sends the Entra ID addresses as text", () => {
    const input = samlConfigInput({
      preset: "entraId",
      domains: ["example.org"],
      metadata: { source: "url", url: "https://login.microsoftonline.com/tenant/federationmetadata.xml" },
      idpInitiated: true,
      requireSignedResponse: false,
      encryptedAssertions: true,
      accountCreation: { enabled: false, requiredGroups: [] },
      sync: { intervalMinutes: 240, deactivationLimitPercent: 20 },
      secondFactor: { mode: "provider", proofValues: ["mfa"] },
      tenantId: "3f2a9c1e-7b4d-4e8a-9c21-5d6f0a8b2e17",
      authority: "https://login.microsoftonline.com",
      graphUrl: "https://graph.microsoft.com",
      graphClientId: null,
      emailSource: "email",
    } as SamlConfig);
    expect(input).toMatchObject({
      idpInitiated: true,
      encryptedAssertions: true,
      sync: { intervalMinutes: 240, deactivationLimitPercent: 20 },
      authority: "https://login.microsoftonline.com",
      graphUrl: "https://graph.microsoft.com",
    });
  });
});
