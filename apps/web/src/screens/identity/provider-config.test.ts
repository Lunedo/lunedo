import { describe, expect, it } from "vitest";
import type { ProviderConfig } from "../../api/identity-queries.js";
import { toConfigInput } from "./provider-config.js";

const common = {
  clientId: "pagehall",
  domains: ["example.org"],
  idTokenAlgorithm: "RS256" as const,
  accountCreation: { enabled: true, requiredGroups: [] },
  sync: { intervalMinutes: 240 },
};

describe("toConfigInput", () => {
  it("keeps the sync interval and the Google directory when another field is saved", () => {
    const input = toConfigInput({
      preset: "google",
      ...common,
      issuer: "https://accounts.google.com",
      directory: {
        adminEmail: "admin@example.org",
        url: "https://admin.googleapis.com",
        tokenUrl: "https://oauth2.googleapis.com/token",
      },
    } as ProviderConfig);
    expect(input).toMatchObject({
      sync: { intervalMinutes: 240 },
      directory: { adminEmail: "admin@example.org" },
    });
  });

  it("keeps the names claim of a generic provider", () => {
    const input = toConfigInput({
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
    } as ProviderConfig);
    expect(input).toMatchObject({ sync: { intervalMinutes: 240 }, claims: { groupNames: "group_names" } });
  });
});
