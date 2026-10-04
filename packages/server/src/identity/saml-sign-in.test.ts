import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { inflateRawSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { instanceUrlSetting } from "../accounts/instance-settings.js";
import { SYSTEM } from "../accounts/principal.js";
import { ChallengeExpiredError } from "../auth/errors.js";
import { OrganizationError } from "../organizations/organizations.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { createFakeSamlIdp, type FakeSamlIdp } from "../testing/fakes/saml-idp.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { samlEntityId, samlPaths } from "./saml.js";
import type { CallbackResult } from "./sign-in.js";

const baseUrl = testDatabaseBaseUrl();
const BASE = "https://pagehall.test";

describe.skipIf(!baseUrl)("signing in through a SAML provider", () => {
  let test: TestServices;
  let idp: FakeSamlIdp;
  let metadataServer: Server;
  let metadataUrl: string;
  let metadataAvailable = true;

  beforeAll(async () => {
    test = await createTestServices(baseUrl ?? "");
    await test.pool.query("insert into instance (id, setup_completed_at) values (1, now())");
    await test.settings.set(instanceUrlSetting, {}, "instance", BASE);
    idp = await createFakeSamlIdp();
    metadataServer = createServer((_request, response) => {
      if (!metadataAvailable) {
        response.writeHead(503).end();
        return;
      }
      response.writeHead(200, { "content-type": "application/samlmetadata+xml" }).end(idp.metadata());
    });
    await new Promise<void>((resolve) => metadataServer.listen(0, "127.0.0.1", resolve));
    metadataUrl = `http://127.0.0.1:${(metadataServer.address() as AddressInfo).port}/metadata`;
  });

  afterAll(async () => {
    await new Promise((resolve) => metadataServer?.close(resolve));
    await test?.close();
  });

  async function provider(options: { idpInitiated?: boolean; fromUrl?: boolean } = {}) {
    const domain = `${randomUUID().slice(0, 8)}.example.org`;
    const { provider: created } = await test.services.identityProviders.create(SYSTEM, {
      type: "saml",
      name: "SAML test",
      config: {
        preset: "generic",
        metadata: options.fromUrl ? { source: "url", url: metadataUrl } : { source: "file" },
        idpInitiated: options.idpInitiated ?? false,
        domains: [domain],
        accountCreation: { enabled: true, requiredGroups: [] },
        attributes: { email: "email", displayName: "name", groups: null },
      },
      metadataXml: options.fromUrl ? null : idp.metadata(),
    });
    return { id: created.id, domain };
  }

  function requestIdOf(url: string): string {
    const request = inflateRawSync(
      Buffer.from(new URL(url).searchParams.get("SAMLRequest") ?? "", "base64"),
    ).toString();
    return /ID="([^"]+)"/.exec(request)?.[1] ?? "";
  }

  function target(providerId: string) {
    return { audience: samlEntityId(BASE, providerId), recipient: `${BASE}${samlPaths(providerId).acs}` };
  }

  async function signIn(
    providerId: string,
    person: { nameId: string; email: string },
    purpose: "signIn" | "reauthentication" = "signIn",
    extra: { sessionId?: string; accountId?: string; authnInstant?: Date } = {},
  ): Promise<CallbackResult> {
    const started = await test.services.providerSignIn.start({
      providerId,
      purpose,
      baseUrl: BASE,
      ...(extra.sessionId ? { sessionId: extra.sessionId, accountId: extra.accountId ?? null } : {}),
    });
    const relayState = new URL(started.url).searchParams.get("RelayState");
    const samlResponse = await idp.response({
      ...target(providerId),
      nameId: person.nameId,
      attributes: { email: [person.email] },
      requestId: requestIdOf(started.url),
      ...(extra.authnInstant ? { authnInstant: extra.authnInstant } : {}),
    });
    const receipt = await test.services.providerSignIn.receiveSamlResponse({
      providerId,
      samlResponse,
      relayState,
    });
    expect(receipt.browserToken).toBeNull();
    return test.services.providerSignIn.callback({
      providerId,
      query: new URLSearchParams({ state: receipt.state }),
      browserToken: started.browserToken,
      client: {},
    });
  }

  it("signs a person in through a request Pagehall started and recognizes them again", async () => {
    const { id, domain } = await provider({ fromUrl: true });
    const person = { nameId: randomUUID(), email: `ada@${domain}` };
    const first = await signIn(id, person);
    if (first.kind !== "signedIn") throw new Error(`Signed in expected, got ${first.kind}`);
    const second = await signIn(id, person);
    if (second.kind !== "signedIn") throw new Error(`Signed in expected, got ${second.kind}`);
    expect(second.signedIn.session.accountId).toBe(first.signedIn.session.accountId);
    const stored = await test.pool.query(
      "select count(*)::int as count from provider_flows where saml_response is not null",
    );
    expect(stored.rows[0]?.count).toBe(0);
  });

  it("does not finish a sign-in in another browser", async () => {
    const { id, domain } = await provider();
    const started = await test.services.providerSignIn.start({
      providerId: id,
      purpose: "signIn",
      baseUrl: BASE,
    });
    const receipt = await test.services.providerSignIn.receiveSamlResponse({
      providerId: id,
      samlResponse: await idp.response({
        ...target(id),
        nameId: randomUUID(),
        attributes: { email: [`bob@${domain}`] },
        requestId: requestIdOf(started.url),
      }),
      relayState: new URL(started.url).searchParams.get("RelayState"),
    });
    await expect(
      test.services.providerSignIn.callback({
        providerId: id,
        query: new URLSearchParams({ state: receipt.state }),
        browserToken: "another-browser",
        client: {},
      }),
    ).rejects.toThrow(ChallengeExpiredError);
  });

  it("refuses sign-in started at the identity provider unless the provider allows it", async () => {
    const { id, domain } = await provider();
    await expect(
      test.services.providerSignIn.receiveSamlResponse({
        providerId: id,
        samlResponse: await idp.response({
          ...target(id),
          nameId: randomUUID(),
          attributes: { email: [`carol@${domain}`] },
          requestId: null,
        }),
        relayState: null,
      }),
    ).rejects.toMatchObject({ code: "providerInitiatedSignIn" } satisfies Partial<OrganizationError>);
  });

  it("uses each assertion once, also when two nodes receive it at the same time", async () => {
    const { id, domain } = await provider({ idpInitiated: true });
    const samlResponse = await idp.response({
      ...target(id),
      nameId: randomUUID(),
      attributes: { email: [`dave@${domain}`] },
      requestId: null,
    });
    const nodes = [test.services, test.anotherNode()];
    const results = await Promise.all(
      nodes.map(async (node) => {
        const receipt = await node.providerSignIn.receiveSamlResponse({
          providerId: id,
          samlResponse,
          relayState: null,
        });
        return node.providerSignIn.callback({
          providerId: id,
          query: new URLSearchParams({ state: receipt.state }),
          browserToken: receipt.browserToken ?? "",
          client: {},
        });
      }),
    );
    expect(results.map((result) => result.kind).sort()).toEqual(["refused", "signedIn"]);
    const replayed = await test.services.providerSignIn.receiveSamlResponse({
      providerId: id,
      samlResponse,
      relayState: null,
    });
    const third = await test.services.providerSignIn.callback({
      providerId: id,
      query: new URLSearchParams({ state: replayed.state }),
      browserToken: replayed.browserToken ?? "",
      client: {},
    });
    expect(third).toMatchObject({ kind: "refused", reason: "invalidResponse" });
  });

  it("checks unsolicited responses against the configured address of the instance, not the request", async () => {
    const { id, domain } = await provider({ idpInitiated: true });
    const elsewhere = "https://attacker.example";
    const samlResponse = await idp.response({
      audience: samlEntityId(elsewhere, id),
      recipient: `${elsewhere}${samlPaths(id).acs}`,
      nameId: randomUUID(),
      attributes: { email: [`frank@${domain}`] },
      requestId: null,
    });
    const receipt = await test.services.providerSignIn.receiveSamlResponse({
      providerId: id,
      samlResponse,
      relayState: null,
    });
    const result = await test.services.providerSignIn.callback({
      providerId: id,
      query: new URLSearchParams({ state: receipt.state }),
      browserToken: receipt.browserToken ?? "",
      client: {},
    });
    expect(result).toMatchObject({ kind: "refused", reason: "invalidResponse" });
    await test.settings.set(instanceUrlSetting, {}, "instance", "");
    try {
      await expect(
        test.services.providerSignIn.receiveSamlResponse({ providerId: id, samlResponse, relayState: null }),
      ).rejects.toMatchObject({ code: "providerInitiatedSignIn" });
    } finally {
      await test.settings.set(instanceUrlSetting, {}, "instance", BASE);
    }
  });

  it("accepts a re-authentication only with a fresh AuthnInstant", async () => {
    const { id, domain } = await provider();
    const person = { nameId: randomUUID(), email: `erin@${domain}` };
    const first = await signIn(id, person);
    if (first.kind !== "signedIn") throw new Error("Signed in expected");
    const session = first.signedIn.session;
    await expect(
      signIn(id, person, "reauthentication", {
        sessionId: session.id,
        accountId: session.accountId,
        authnInstant: new Date(Date.now() - 30 * 60_000),
      }),
    ).rejects.toThrow(ChallengeExpiredError);
    const fresh = await signIn(id, person, "reauthentication", {
      sessionId: session.id,
      accountId: session.accountId,
    });
    expect(fresh.kind).toBe("reauthenticated");
  });

  it("keeps the last good metadata when a refresh fails and warns about it", async () => {
    const { id } = await provider({ fromUrl: true });
    metadataAvailable = false;
    try {
      await expect(test.services.identityProviders.refreshSamlMetadata(SYSTEM, id)).rejects.toMatchObject({
        code: "invalidSamlMetadata",
      });
      const summary = await test.services.identityProviders.get(id);
      if (summary.type !== "saml") throw new Error("SAML provider expected");
      expect(summary.warnings).toContain("metadataRefreshFailed");
      expect(summary.saml.identityProvider?.entityId).toBe(idp.entityId);
      const events = await test.pool.query(
        "select name from audit_events where target_id = $1 and name = 'identityProvider.metadataRefreshFailed'",
        [id],
      );
      expect(events.rowCount).toBe(1);
    } finally {
      metadataAvailable = true;
    }
    const refreshed = await test.services.identityProviders.refreshSamlMetadata(SYSTEM, id);
    expect(refreshed.warnings).not.toContain("metadataRefreshFailed");
  });
});
