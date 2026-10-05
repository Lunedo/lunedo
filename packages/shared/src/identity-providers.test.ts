import { describe, expect, it } from "vitest";
import { genericOidcConfigSchema, ldapConfigSchema, ldapServerAddress } from "./identity-providers.js";

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

describe("ldapConfigSchema", () => {
  const base = {
    url: "ldaps://dc.example.org",
    userBaseDn: "OU=Users,DC=example,DC=org",
    groupBaseDn: "OU=Groups,DC=example,DC=org",
  };

  it.each([
    "CN=Pagehall Service,OU=Users,DC=example,DC=org",
    "svc-pagehall@example.org",
    "EXAMPLE\\svc-pagehall",
  ])("accepts %s as the Active Directory service account", (bindDn) => {
    const config = ldapConfigSchema.parse({ preset: "activeDirectory", ...base, bindDn });
    expect(config.bindDn).toBe(bindDn);
  });

  it.each(["svc-pagehall", "svc@", "\\svc", "EXAMPLE\\"])("refuses %s as a service account", (bindDn) => {
    expect(ldapConfigSchema.safeParse({ preset: "activeDirectory", ...base, bindDn }).success).toBe(false);
  });

  it("needs a distinguished name for other directories", () => {
    expect(
      ldapConfigSchema.safeParse({ preset: "generic", ...base, bindDn: "svc-pagehall@example.org" }).success,
    ).toBe(false);
  });
});

describe("ldapServerAddress", () => {
  it.each([
    ["dc01.pagehall.lab", "ldaps://dc01.pagehall.lab:636"],
    ["dc01.pagehall.lab:3269", "ldaps://dc01.pagehall.lab:3269"],
    [" ldaps://dc01.pagehall.lab/ ", "ldaps://dc01.pagehall.lab"],
    ["ldap://10.0.0.5:389", "ldap://10.0.0.5:389"],
  ])("understands %s as %s", (input, address) => {
    expect(ldapServerAddress(input)).toBe(address);
    expect(
      ldapConfigSchema.parse({
        preset: "activeDirectory",
        url: input,
        bindDn: "svc@example.org",
        userBaseDn: "DC=example,DC=org",
        groupBaseDn: "DC=example,DC=org",
      }).url,
    ).toBe(address);
  });

  it.each([
    "",
    "https://dc01.pagehall.lab",
    "ldaps://",
    "ldaps://dc01/path",
    "dc 01",
    "ldaps://user@dc01",
    "::",
  ])("refuses %j without throwing", (input) => {
    expect(ldapServerAddress(input)).toBeNull();
    expect(
      ldapConfigSchema.safeParse({
        preset: "activeDirectory",
        url: input,
        bindDn: "svc@example.org",
        userBaseDn: "DC=example,DC=org",
        groupBaseDn: "DC=example,DC=org",
      }).success,
    ).toBe(false);
  });
});
