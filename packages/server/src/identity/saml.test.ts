import { randomUUID } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { ADFS_GROUP_CLAIMS, ENTRA_SAML_CLAIMS, type SamlConfigInput, samlConfigSchema } from "@lunedo/shared";
import { beforeAll, describe, expect, it } from "vitest";
import { createFakeSamlIdp, type FakeSamlIdp, PERSISTENT } from "../testing/fakes/saml-idp.js";
import type { ProviderCredential, SamlProviderDefinition } from "./adapter.js";
import { ProviderPolicyError, ProviderResponseError } from "./adapter.js";
import { generateCertificate } from "./certificates.js";
import { SamlAdapter, samlCapabilities, samlEntityId, samlPaths } from "./saml.js";
import { parseSamlMetadata, SamlMetadataError } from "./saml-metadata.js";

const BASE = "https://wiki.lunedo.test";

let idp: FakeSamlIdp;
let credentials: ProviderCredential[];
let signingCertificate: string;

beforeAll(async () => {
  idp = await createFakeSamlIdp();
  const signing = await generateCertificate({ commonName: "Lunedo test", validDays: 365 });
  signingCertificate = signing.certificate;
  credentials = [
    {
      id: randomUUID(),
      kind: "samlSigning",
      secret: signing.privateKey,
      keyId: signing.thumbprint,
      certificate: signing.certificate,
    },
  ];
});

function provider(config: Partial<SamlConfigInput> = {}): SamlProviderDefinition {
  return {
    id: randomUUID(),
    name: "Company SAML",
    directoryKey: null,
    type: "saml",
    config: samlConfigSchema.parse(
      config.preset && config.preset !== "generic"
        ? { metadata: { source: "file" }, ...config }
        : {
            preset: "generic",
            metadata: { source: "file" },
            attributes: { email: "email", displayName: "name", groups: "groups" },
            ...config,
          },
    ),
    metadata: parseSamlMetadata(idp.metadata()),
  };
}

async function start(definition: SamlProviderDefinition, reauthenticate = false) {
  const adapter = new SamlAdapter({ allowInsecure: false });
  const acs = `${BASE}${samlPaths(definition.id).acs}`;
  const started = await adapter.authorizationUrl(definition, credentials, {
    redirectUri: acs,
    state: "relay-state",
    nonce: "",
    codeChallenge: "",
    reauthenticate,
  });
  const requestId = started.requestId ?? "";
  return {
    adapter,
    acs,
    audience: samlEntityId(BASE, definition.id),
    requestId,
    url: started.url,
    complete: (samlResponse: string, flowRequestId: string | null = requestId) =>
      adapter.completeSignIn(definition, credentials, {
        callbackUrl: new URL(acs),
        redirectUri: acs,
        state: "relay-state",
        nonce: "",
        codeVerifier: "",
        requestId: flowRequestId,
        samlResponse,
      }),
  };
}

const person = { nameId: "person-1", attributes: { email: ["ada@lunedo.test"], groups: ["staff"] } };

describe("SAML sign-in", () => {
  it("signs the request with SHA-256 and asks for a fresh sign-in when re-authenticating", async () => {
    const definition = provider();
    const flow = await start(definition, true);
    expect(flow.url.origin + flow.url.pathname).toBe(idp.ssoUrl);
    expect(flow.url.searchParams.get("SigAlg")).toBe("http://www.w3.org/2001/04/xmldsig-more#rsa-sha256");
    expect(flow.url.searchParams.get("Signature")).toBeTruthy();
    expect(flow.url.searchParams.get("RelayState")).toBe("relay-state");
    const request = inflateRawSync(
      Buffer.from(flow.url.searchParams.get("SAMLRequest") ?? "", "base64"),
    ).toString();
    expect(request).toContain(`ID="${flow.requestId}"`);
    expect(request).toContain('ForceAuthn="true"');
    expect(request).toContain(`AssertionConsumerServiceURL="${flow.acs}"`);
  });

  it("accepts a response without its own signature when the assertion is signed", async () => {
    const definition = provider();
    const flow = await start(definition);
    const result = await flow.complete(
      await idp.response({
        ...person,
        audience: flow.audience,
        recipient: flow.acs,
        requestId: flow.requestId,
      }),
    );
    expect(result.profile).toEqual({
      subject: "person-1",
      email: "ada@lunedo.test",
      signInName: null,
      displayName: null,
      groups: [{ id: "staff", name: "staff" }],
      groupsClaimMissing: false,
    });
    expect(result.assertion?.id).toMatch(/^_/);
    expect(result.authTime).toBeGreaterThan(0);
  });

  it("accepts a signed response with a signed assertion", async () => {
    const flow = await start(provider());
    const result = await flow.complete(
      await idp.response({
        ...person,
        audience: flow.audience,
        recipient: flow.acs,
        requestId: flow.requestId,
        signResponse: true,
      }),
    );
    expect(result.profile.subject).toBe("person-1");
  });

  it("requires a signed response when the provider says so", async () => {
    const flow = await start(provider({ requireSignedResponse: true }));
    const response = { ...person, audience: flow.audience, recipient: flow.acs, requestId: flow.requestId };
    await expect(flow.complete(await idp.response(response))).rejects.toThrow(ProviderResponseError);
    await expect(
      flow.complete(await idp.response({ ...response, signResponse: true })),
    ).resolves.toBeTruthy();
  });

  it("refuses an unsigned assertion in a signed response", async () => {
    const flow = await start(provider());
    const response = await idp.response({
      ...person,
      audience: flow.audience,
      recipient: flow.acs,
      requestId: flow.requestId,
      signAssertion: false,
      signResponse: true,
    });
    await expect(flow.complete(response)).rejects.toThrow(ProviderResponseError);
  });

  it("refuses signature wrapping", async () => {
    const flow = await start(provider());
    const common = { audience: flow.audience, recipient: flow.acs, requestId: flow.requestId };
    const originalId = `_${randomUUID()}`;
    const original = idp.sign(idp.assertion({ ...common, id: originalId, nameId: "victim" }), originalId);
    const evil = idp.assertion({ ...common, id: `_${randomUUID()}`, nameId: "attacker" });
    const nested = evil.replace("</saml:Subject>", `</saml:Subject>${original}`);
    for (const assertions of [nested, `${evil}${original}`, `${original}${evil}`]) {
      const response = Buffer.from(idp.wrap(assertions, common)).toString("base64");
      await expect(flow.complete(response)).rejects.toThrow(ProviderResponseError);
    }
    const sameId = idp.assertion({ ...common, id: originalId, nameId: "attacker" });
    const duplicated = Buffer.from(
      idp.wrap(
        sameId.replace("</saml:Assertion>", `<saml:Advice>${original}</saml:Advice></saml:Assertion>`),
        common,
      ),
    ).toString("base64");
    await expect(flow.complete(duplicated)).rejects.toThrow(ProviderResponseError);
  });

  it("reads the whole NameID when it contains a comment", async () => {
    const flow = await start(provider());
    const response = await idp.response({
      ...person,
      nameIdXml: `<saml:NameID Format="${PERSISTENT}">admin@lunedo.test<!-- comment -->.evil.example</saml:NameID>`,
      audience: flow.audience,
      recipient: flow.acs,
      requestId: flow.requestId,
    });
    const result = await flow.complete(response);
    expect(result.profile.subject).toBe("admin@lunedo.test.evil.example");
  });

  it("refuses a response that does not answer the request Lunedo sent", async () => {
    const flow = await start(provider());
    const common = { ...person, audience: flow.audience, recipient: flow.acs };
    await expect(flow.complete(await idp.response({ ...common, requestId: "_other" }))).rejects.toThrow(
      ProviderResponseError,
    );
    await expect(flow.complete(await idp.response({ ...common, requestId: null }))).rejects.toThrow(
      ProviderResponseError,
    );
    await expect(
      flow.complete(await idp.response({ ...common, requestId: flow.requestId, inResponseTo: "_other" })),
    ).rejects.toThrow(ProviderResponseError);
    await expect(
      flow.complete(await idp.response({ ...common, requestId: flow.requestId }), null),
    ).rejects.toThrow(ProviderResponseError);
  });

  it("accepts an unsolicited response only without InResponseTo", async () => {
    const flow = await start(provider({ idpInitiated: true }));
    const common = { ...person, audience: flow.audience, recipient: flow.acs };
    await expect(
      flow.complete(await idp.response({ ...common, requestId: null }), null),
    ).resolves.toBeTruthy();
  });

  it("refuses a wrong audience, recipient, destination or issuer", async () => {
    const flow = await start(provider());
    const common = { ...person, audience: flow.audience, recipient: flow.acs, requestId: flow.requestId };
    for (const response of [
      await idp.response({ ...common, audience: "https://other.example/metadata" }),
      await idp.response({ ...common, recipient: "https://other.example/acs", destination: flow.acs }),
      await idp.response({ ...common, destination: "https://other.example/acs" }),
      await idp.response({ ...common, issuer: "https://other-idp.example" }),
    ]) {
      await expect(flow.complete(response)).rejects.toThrow(ProviderResponseError);
    }
  });

  it("refuses expired assertions and accepts two minutes of clock skew", async () => {
    const flow = await start(provider());
    const common = { ...person, audience: flow.audience, recipient: flow.acs, requestId: flow.requestId };
    const now = Date.now();
    await expect(
      flow.complete(
        await idp.response({
          ...common,
          notBefore: new Date(now - 10 * 60_000),
          notOnOrAfter: new Date(now - 3 * 60_000),
        }),
      ),
    ).rejects.toThrow(ProviderResponseError);
    await expect(
      flow.complete(await idp.response({ ...common, notBefore: new Date(now + 3 * 60_000) })),
    ).rejects.toThrow(ProviderResponseError);
    await expect(
      flow.complete(
        await idp.response({
          ...common,
          notBefore: new Date(now + 60_000),
          notOnOrAfter: new Date(now - 60_000 + 10 * 60_000),
        }),
      ),
    ).resolves.toBeTruthy();
  });

  it("refuses SHA-1 signatures", async () => {
    const flow = await start(provider());
    const common = { ...person, audience: flow.audience, recipient: flow.acs, requestId: flow.requestId };
    await expect(flow.complete(await idp.response({ ...common, algorithm: "sha1" }))).rejects.toThrow(
      ProviderResponseError,
    );
    await expect(
      flow.complete(await idp.response({ ...common, signResponse: true, algorithm: "sha1" })),
    ).rejects.toThrow(ProviderResponseError);
  });

  it("decrypts encrypted assertions and requires them when configured", async () => {
    const flow = await start(provider({ encryptedAssertions: true }));
    const common = { ...person, audience: flow.audience, recipient: flow.acs, requestId: flow.requestId };
    const result = await flow.complete(await idp.response({ ...common, encryptFor: signingCertificate }));
    expect(result.profile.subject).toBe("person-1");
    await expect(flow.complete(await idp.response(common))).rejects.toThrow(ProviderResponseError);
  });

  it("refuses a response the identity provider marked as failed", async () => {
    const flow = await start(provider());
    const response = await idp.response({
      ...person,
      audience: flow.audience,
      recipient: flow.acs,
      requestId: flow.requestId,
      status: "urn:oasis:names:tc:SAML:2.0:status:Requester",
    });
    await expect(flow.complete(response)).rejects.toThrow(ProviderResponseError);
  });

  it("requires a persistent NameID unless an identifier attribute is configured", async () => {
    const flow = await start(provider());
    const common = { ...person, audience: flow.audience, recipient: flow.acs, requestId: flow.requestId };
    await expect(
      flow.complete(
        await idp.response({
          ...common,
          nameIdFormat: "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
        }),
      ),
    ).rejects.toThrow(ProviderResponseError);
    const byAttribute = await start(provider({ identifierAttribute: "uid" }));
    const result = await byAttribute.complete(
      await idp.response({
        ...person,
        attributes: { ...person.attributes, uid: ["U-42"] },
        audience: byAttribute.audience,
        recipient: byAttribute.acs,
        requestId: byAttribute.requestId,
      }),
    );
    expect(result.profile.subject).toBe("u-42");
  });

  it("identifies Entra ID people by tenant and object ID and loads groups after an overage", async () => {
    const tenant = randomUUID();
    const definition = provider({ preset: "entraId", tenantId: tenant } as Partial<SamlConfigInput>);
    const flow = await start(definition);
    const common = { audience: flow.audience, recipient: flow.acs, requestId: flow.requestId, nameId: "x" };
    const objectId = randomUUID();
    const attributes = {
      [ENTRA_SAML_CLAIMS.tenantId]: [tenant],
      [ENTRA_SAML_CLAIMS.objectId]: [objectId],
      [ENTRA_SAML_CLAIMS.email]: ["ada@lunedo.test"],
      [ENTRA_SAML_CLAIMS.groups]: ["G1"],
    };
    const result = await flow.complete(await idp.response({ ...common, attributes }));
    expect(result.profile.subject).toBe(`${tenant}:${objectId}`);
    expect(result.profile.groups).toEqual([{ id: "g1", name: null }]);
    const overage = await flow.complete(
      await idp.response({
        ...common,
        attributes: { ...attributes, [ENTRA_SAML_CLAIMS.groupsLink]: ["link"] },
      }),
    );
    expect(overage.profile.groups).toBeNull();
    await expect(
      flow.complete(
        await idp.response({
          ...common,
          attributes: { ...attributes, [ENTRA_SAML_CLAIMS.tenantId]: [randomUUID()] },
        }),
      ),
    ).rejects.toThrow(ProviderPolicyError);
  });

  it("reads the objectGUID of ADFS as a GUID", async () => {
    const flow = await start(provider({ preset: "adfs" } as Partial<SamlConfigInput>));
    const guid = Buffer.from("00112233445566778899aabbccddeeff", "hex").toString("base64");
    const result = await flow.complete(
      await idp.response({
        nameId: "x",
        audience: flow.audience,
        recipient: flow.acs,
        requestId: flow.requestId,
        attributes: { objectGUID: [guid] },
      }),
    );
    expect(result.profile.subject).toBe("33221100-5544-7766-8899-aabbccddeeff");
  });

  it("reads ADFS groups as SIDs by default and treats names as names only when chosen", async () => {
    const guid = Buffer.from("00112233445566778899aabbccddeeff", "hex").toString("base64");
    const sid = "S-1-5-21-1004336348-1177238915-682003330-1105";
    const attributes = {
      objectGUID: [guid],
      [ADFS_GROUP_CLAIMS.sids]: [sid],
      [ADFS_GROUP_CLAIMS.names]: ["Editors"],
    };
    const bySid = await start(provider({ preset: "adfs" } as Partial<SamlConfigInput>));
    const result = await bySid.complete(
      await idp.response({
        nameId: "x",
        audience: bySid.audience,
        recipient: bySid.acs,
        requestId: bySid.requestId,
        attributes,
      }),
    );
    expect(result.profile.groups).toEqual([{ id: sid, name: null }]);
    const definition = provider({ preset: "adfs" } as Partial<SamlConfigInput>);
    expect(samlCapabilities(definition.config, false).groupsByName).toBe(false);

    const named = provider({
      preset: "adfs",
      groupValues: "names",
      attributes: {
        email: "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress",
        groups: ADFS_GROUP_CLAIMS.names,
      },
    } as Partial<SamlConfigInput>);
    expect(samlCapabilities(named.config, false).groupsByName).toBe(true);
    const byName = await start(named);
    const namedResult = await byName.complete(
      await idp.response({
        nameId: "x",
        audience: byName.audience,
        recipient: byName.acs,
        requestId: byName.requestId,
        attributes,
      }),
    );
    expect(namedResult.profile.groups).toEqual([{ id: "Editors", name: "Editors" }]);
  });

  it("reports the attributes it received without hashes, tokens or secrets", async () => {
    const flow = await start(provider());
    const result = await flow.complete(
      await idp.response({
        ...person,
        attributes: { ...person.attributes, access_token: ["secret-value"], passwordHash: ["x"] },
        audience: flow.audience,
        recipient: flow.acs,
        requestId: flow.requestId,
      }),
    );
    expect(result.claims).toEqual([
      { name: "email", values: ["ada@lunedo.test"] },
      { name: "groups", values: ["staff"] },
    ]);
    expect(JSON.stringify(result.claims)).not.toContain("secret-value");
  });
});

describe("SAML metadata", () => {
  it("reads the entity ID, the sign-in address and the signing certificates", () => {
    const parsed = parseSamlMetadata(idp.metadata());
    expect(parsed.entityId).toBe(idp.entityId);
    expect(parsed.ssoUrl).toBe(idp.ssoUrl);
    expect(parsed.certificates).toHaveLength(1);
  });

  it("refuses documents with a document type declaration and metadata without certificates", () => {
    expect(() => parseSamlMetadata(`<!DOCTYPE x [<!ENTITY a "b">]>${idp.metadata()}`)).toThrow(
      SamlMetadataError,
    );
    expect(() =>
      parseSamlMetadata(idp.metadata().replace(/<md:KeyDescriptor[\s\S]*<\/md:KeyDescriptor>/, "")),
    ).toThrow(SamlMetadataError);
    expect(() => parseSamlMetadata("<not-metadata/>")).toThrow(SamlMetadataError);
  });
});
