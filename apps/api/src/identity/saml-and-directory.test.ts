import { inflateRawSync } from "node:zlib";
import { createFakeSamlIdp, type FakeSamlIdp } from "@pagehall/server/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addTotp, completeConfiguredSetup, configuredSetupEnv, OWNER } from "../testing/accounts.js";
import {
  type AuthTestApp,
  createAuthTestApp,
  databaseBaseUrl,
  TEST_ORIGIN,
  TestClient,
} from "../testing/auth-app.js";

describe.skipIf(!databaseBaseUrl)("SAML and directory providers through the API", () => {
  let test: AuthTestApp;
  let owner: TestClient;
  let idp: FakeSamlIdp;
  let samlId: string;
  let ldapId: string;

  beforeAll(async () => {
    test = await createAuthTestApp({ ...configuredSetupEnv, PAGEHALL_INSECURE_IDENTITY_PROVIDERS: "true" });
    await completeConfiguredSetup(test);
    idp = await createFakeSamlIdp();
    owner = new TestClient(test.app);
    await owner.post("/api/v1/auth/sign-in", OWNER);
    await addTotp(owner);
    const saml = await owner.post("/api/v1/instance/identity-providers", {
      type: "saml",
      name: "Company SAML",
      config: {
        preset: "generic",
        metadata: { source: "file" },
        domains: ["saml.pagehall.test"],
        accountCreation: { enabled: true, requiredGroups: [] },
        attributes: { email: "email" },
      },
      metadataXml: idp.metadata(),
    });
    expect(saml.statusCode, saml.body).toBe(201);
    samlId = saml.json().provider.id;
    expect(saml.json().provider).toMatchObject({
      type: "saml",
      redirectUri: `${TEST_ORIGIN}/api/v1/auth/providers/${samlId}/saml/acs`,
      saml: {
        entityId: `${TEST_ORIGIN}/api/v1/auth/providers/${samlId}/saml/metadata`,
        identityProvider: { entityId: idp.entityId, ssoUrl: idp.ssoUrl },
      },
    });
    expect(saml.json().credential).toMatchObject({ kind: "samlSigning" });
    const ldap = await owner.post("/api/v1/instance/identity-providers", {
      type: "ldap",
      name: "Directory",
      config: {
        preset: "activeDirectory",
        url: "ldaps://127.0.0.1:1",
        bindDn: "CN=pagehall,OU=Service,DC=corp,DC=example",
        userBaseDn: "OU=People,DC=corp,DC=example",
        groupBaseDn: "OU=Groups,DC=corp,DC=example",
        domains: ["corp.pagehall.test"],
      },
      credential: { kind: "bindPassword", secret: "service password" },
    });
    expect(ldap.statusCode, ldap.body).toBe(201);
    ldapId = ldap.json().provider.id;
    expect(ldap.body).not.toContain("service password");
  });

  afterAll(async () => {
    await test?.close();
  });

  function postResponse(samlResponse: string, relayState: string | null) {
    const form = new URLSearchParams({ SAMLResponse: samlResponse });
    if (relayState) form.set("RelayState", relayState);
    return test.app.inject({
      method: "POST",
      url: `/api/v1/auth/providers/${samlId}/saml/acs`,
      headers: { "content-type": "application/x-www-form-urlencoded", origin: "https://idp.saml.test" },
      payload: form.toString(),
    });
  }

  it("publishes Pagehall's metadata with the signing certificate", async () => {
    const response = await new TestClient(test.app).get(`/api/v1/auth/providers/${samlId}/saml/metadata`);
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("application/samlmetadata+xml");
    expect(response.body).toContain(
      `entityID="${TEST_ORIGIN}/api/v1/auth/providers/${samlId}/saml/metadata"`,
    );
    expect(response.body).toContain(`Location="${TEST_ORIGIN}/api/v1/auth/providers/${samlId}/saml/acs"`);
    expect(response.body).toContain("X509Certificate");
    expect(response.body).toContain('AuthnRequestsSigned="true"');
  });

  it("receives the response the identity provider posts and finishes in the browser that started", async () => {
    const browser = new TestClient(test.app);
    const discovered = await browser.post("/api/v1/auth/sign-in/discover", {
      email: "ada@saml.pagehall.test",
    });
    expect(discovered.json()).toMatchObject({ step: "provider", providerId: samlId });
    const started = await browser.post(`/api/v1/auth/providers/${samlId}/start`, {});
    const url = new URL(started.json().url);
    const request = inflateRawSync(
      Buffer.from(url.searchParams.get("SAMLRequest") ?? "", "base64"),
    ).toString();
    const requestId = /ID="([^"]+)"/.exec(request)?.[1] ?? "";
    const samlResponse = await idp.response({
      nameId: "ada",
      attributes: { email: ["ada@saml.pagehall.test"] },
      audience: `${TEST_ORIGIN}/api/v1/auth/providers/${samlId}/saml/metadata`,
      recipient: `${TEST_ORIGIN}/api/v1/auth/providers/${samlId}/saml/acs`,
      requestId,
    });
    const received = await postResponse(samlResponse, url.searchParams.get("RelayState"));
    expect(received.statusCode).toBe(303);
    const location = String(received.headers.location);
    expect(location).toMatch(new RegExp(`^/api/v1/auth/providers/${samlId}/callback\\?state=`));

    const stolen = await new TestClient(test.app).get(location);
    expect(stolen.headers.location).toBe("/sign-in?error=challengeExpired");

    const replayed = await postResponse(samlResponse, url.searchParams.get("RelayState"));
    expect(replayed.headers.location).toBe("/sign-in?error=providerInitiatedSignIn");
  });

  it("signs a person in when the browser follows the redirect", async () => {
    const browser = new TestClient(test.app);
    const started = await browser.post(`/api/v1/auth/providers/${samlId}/start`, {});
    const url = new URL(started.json().url);
    const request = inflateRawSync(
      Buffer.from(url.searchParams.get("SAMLRequest") ?? "", "base64"),
    ).toString();
    const received = await postResponse(
      await idp.response({
        nameId: "bea",
        attributes: { email: ["bea@saml.pagehall.test"] },
        audience: `${TEST_ORIGIN}/api/v1/auth/providers/${samlId}/saml/metadata`,
        recipient: `${TEST_ORIGIN}/api/v1/auth/providers/${samlId}/saml/acs`,
        requestId: /ID="([^"]+)"/.exec(request)?.[1] ?? "",
      }),
      url.searchParams.get("RelayState"),
    );
    const callback = await browser.get(String(received.headers.location));
    expect(callback.statusCode).toBe(303);
    expect(callback.headers.location).toBe("/");
    expect((await browser.get("/api/v1/auth/session")).json()).toMatchObject({
      account: { email: "bea@saml.pagehall.test" },
    });
  });

  it("asks for the directory password and refuses an empty one", async () => {
    const browser = new TestClient(test.app, { remoteAddress: "198.51.100.77" });
    const discovered = await browser.post("/api/v1/auth/sign-in/discover", {
      email: "ada@corp.pagehall.test",
    });
    expect(discovered.json()).toEqual({
      step: "directory",
      providerId: ldapId,
      name: "Directory",
      preset: "activeDirectory",
      signInName: "userPrincipalName",
    });
    const empty = await browser.post(`/api/v1/auth/providers/${ldapId}/password`, {
      signInName: "ada@corp.pagehall.test",
      password: "",
    });
    expect(empty.statusCode).toBe(401);
    expect(empty.json()).toMatchObject({ code: "invalidCredentials" });
    const unreachable = await browser.post(`/api/v1/auth/providers/${ldapId}/password`, {
      signInName: "ada@corp.pagehall.test",
      password: "secret",
    });
    expect(unreachable.statusCode).toBe(502);
    expect(unreachable.json()).toMatchObject({ code: "providerUnavailable" });
    expect(unreachable.body).not.toContain("secret");
  });

  it("reports each step of the directory test", async () => {
    const response = await owner.post(`/api/v1/instance/identity-providers/${ldapId}/directory-test`, {});
    expect(response.statusCode).toBe(200);
    expect(response.json().steps[0]).toMatchObject({ step: "connection", ok: false });
  });

  it("refuses a server certificate as uploaded certificate authority", async () => {
    const response = await owner.put(`/api/v1/instance/identity-providers/${ldapId}/ca-certificate`, {
      certificate: "-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----",
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: "invalidCertificate" });
  });
});
