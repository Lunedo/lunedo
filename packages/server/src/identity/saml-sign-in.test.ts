import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { inflateRawSync } from "node:zlib";
import { ENTRA_SAML_CLAIMS } from "@pagehall/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { instanceUrlSetting } from "../accounts/instance-settings.js";
import { ANONYMOUS, SYSTEM } from "../accounts/principal.js";
import { ChallengeExpiredError } from "../auth/errors.js";
import { runWithRequestContext } from "../observability/request-context.js";
import { OrganizationError } from "../organizations/organizations.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import {
  GRAPH_CLIENT_ID,
  GRAPH_CLIENT_SECRET,
  GRAPH_IDS,
  GRAPH_TENANT_ID,
  startFakeGraph,
} from "../testing/fakes/microsoft-graph.js";
import { createFakeSamlIdp, type FakeSamlIdp } from "../testing/fakes/saml-idp.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { spaceFixtures } from "../testing/spaces.js";
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
  let metadataPrefix = "";
  const { organization } = spaceFixtures(() => test);

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
      response
        .writeHead(200, { "content-type": "application/samlmetadata+xml" })
        .end(`${metadataPrefix}${idp.metadata()}`);
    });
    await new Promise<void>((resolve) => metadataServer.listen(0, "127.0.0.1", resolve));
    metadataUrl = `http://127.0.0.1:${(metadataServer.address() as AddressInfo).port}/metadata`;
  });

  afterAll(async () => {
    await new Promise((resolve) => metadataServer?.close(resolve));
    await test?.close();
  });

  async function provider(options: { idpInitiated?: boolean; fromUrl?: boolean; groups?: string } = {}) {
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
        attributes: { email: "email", displayName: "name", groups: options.groups ?? null },
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
    extra: {
      sessionId?: string;
      accountId?: string;
      authnInstant?: Date;
      attributes?: Record<string, string[]>;
    } = {},
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
      attributes: { email: [person.email], ...extra.attributes },
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

  it("signs a person in to the placeholder an administrator created for them", async () => {
    const { id, domain } = await provider();
    const email = `dave@${domain}`;
    const placeholder = await test.services.accountLifecycle.createPlaceholder(SYSTEM, {
      name: "Dave",
      email,
    });
    const result = await runWithRequestContext({ requestId: randomUUID(), actor: ANONYMOUS }, () =>
      signIn(id, { nameId: randomUUID(), email }),
    );
    if (result.kind !== "signedIn") throw new Error(`Signed in expected, got ${result.kind}`);
    expect(result.signedIn.session.accountId).toBe(placeholder.id);
    expect((await test.services.accounts.get(placeholder.id))?.state).toBe("active");
  });

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

  it("keeps a draft with Pagehall's details from the first step and connects it later", async () => {
    const draft = await test.services.identityProviders.createDraft(SYSTEM, {
      type: "saml",
      preset: "entraId",
      name: "Entra SAML draft",
    });
    expect(draft.saml).toMatchObject({
      acsPath: samlPaths(draft.id).acs,
      metadataPath: samlPaths(draft.id).metadata,
    });
    const signingId = draft.saml?.signingCredentialId ?? "";
    const certificate = await test.services.identityProviders.certificate(draft.id, signingId);
    const metadata = await test.services.providerSignIn.serviceProviderMetadata(draft.id, BASE);
    expect(metadata).toContain(samlEntityId(BASE, draft.id));
    expect(metadata).toContain(
      certificate
        .replace(/-----[A-Z ]+-----/g, "")
        .replace(/\s+/g, "")
        .slice(0, 40),
    );
    expect((await test.services.identityProviders.drafts()).map((entry) => entry.id)).toContain(draft.id);
    expect((await test.services.identityProviders.list()).map((entry) => entry.id)).not.toContain(draft.id);
    await expect(test.services.identityProviders.get(draft.id)).rejects.toMatchObject({ code: "notFound" });
    await expect(
      test.services.identityProviders.updateDraft(draft.id, { preset: "activeDirectory" }),
    ).rejects.toMatchObject({ code: "invalidProviderConfiguration" });
    const saved = await test.services.identityProviders.updateDraft(draft.id, {
      preset: "generic",
      fields: { metadataUrl: "https://idp.example.org/metadata", idpInitiated: false },
    });
    expect(saved).toMatchObject({
      preset: "generic",
      fields: { metadataUrl: "https://idp.example.org/metadata", idpInitiated: false },
    });

    const domain = `${randomUUID().slice(0, 8)}.example.org`;
    const { provider: connected } = await test.services.identityProviders.create(SYSTEM, {
      type: "saml",
      name: "SAML from a draft",
      draftId: draft.id,
      config: {
        preset: "generic",
        metadata: { source: "file" },
        domains: [domain],
        accountCreation: { enabled: true, requiredGroups: [] },
        attributes: { email: "email", displayName: "name", groups: null },
      },
      metadataXml: idp.metadata(),
    });
    expect(connected).toMatchObject({ id: draft.id, setupComplete: false });
    expect(connected.credentials.filter((credential) => credential.kind === "samlSigning")).toHaveLength(1);
    expect(await test.services.identityProviders.drafts()).not.toContainEqual(
      expect.objectContaining({ id: draft.id }),
    );
    expect((await test.services.identityProviders.signInProviders()).map((entry) => entry.id)).not.toContain(
      draft.id,
    );
    expect(await test.services.identityProviders.providerForDomain(domain)).toBeNull();
    await expect(
      test.services.providerSignIn.start({ providerId: draft.id, purpose: "signIn", baseUrl: BASE }),
    ).rejects.toMatchObject({ code: "providerDeactivated" });
    const tested = await test.services.providerSignIn.start({
      providerId: draft.id,
      purpose: "test",
      baseUrl: BASE,
    });
    expect(tested.url).toContain("SAMLRequest");

    const finished = await test.services.identityProviders.completeSetup(SYSTEM, draft.id);
    expect(finished.setupComplete).toBe(true);
    expect((await test.services.identityProviders.signInProviders()).map((entry) => entry.id)).toContain(
      draft.id,
    );
    const person = { nameId: randomUUID(), email: `ada@${domain}` };
    expect((await signIn(draft.id, person)).kind).toBe("signedIn");
    const events = await test.pool.query(
      "select name from audit_events where target_id = $1 and name like 'identityProvider.%' order by sequence",
      [draft.id],
    );
    expect(events.rows.map((row) => row.name)).toEqual(
      expect.arrayContaining([
        "identityProvider.created",
        "identityProvider.updated",
        "identityProvider.setupCompleted",
      ]),
    );
  });

  it("removes a draft together with its signing certificate", async () => {
    const draft = await test.services.identityProviders.createDraft(SYSTEM, {
      type: "saml",
      preset: "generic",
      name: "Draft to remove",
    });
    await test.services.identityProviders.remove(SYSTEM, draft.id);
    await expect(test.services.identityProviders.draft(draft.id)).rejects.toMatchObject({ code: "notFound" });
    const left = await test.pool.query("select 1 from identity_provider_credentials where provider_id = $1", [
      draft.id,
    ]);
    expect(left.rowCount).toBe(0);
  });

  it("accepts metadata that starts with a byte order mark, from an address and from a file", async () => {
    metadataPrefix = "﻿";
    try {
      const fromUrl = await provider({ fromUrl: true });
      const loaded = await test.services.identityProviders.get(fromUrl.id);
      if (loaded.type !== "saml") throw new Error("SAML provider expected");
      expect(loaded.saml.identityProvider?.entityId).toBe(idp.entityId);
      const refreshed = await test.services.identityProviders.refreshSamlMetadata(SYSTEM, fromUrl.id);
      expect(refreshed.warnings).not.toContain("metadataRefreshFailed");
    } finally {
      metadataPrefix = "";
    }
    const { provider: fromFile } = await test.services.identityProviders.create(SYSTEM, {
      type: "saml",
      name: "SAML with byte order mark",
      config: { preset: "generic", metadata: { source: "file" } },
      metadataXml: `﻿${idp.metadata()}`,
    });
    if (fromFile.type !== "saml") throw new Error("SAML provider expected");
    expect(fromFile.saml.identityProvider?.entityId).toBe(idp.entityId);
  });

  it("reads the names of Entra ID groups through Graph at sign-in and follows a rename", async () => {
    const graph = await startFakeGraph();
    try {
      const domain = `${randomUUID().slice(0, 8)}.example.org`;
      const { provider: created } = await test.services.identityProviders.create(SYSTEM, {
        type: "saml",
        name: "Entra SAML with Graph",
        config: {
          preset: "entraId",
          tenantId: GRAPH_TENANT_ID,
          authority: graph.url,
          graphUrl: graph.url,
          graphClientId: GRAPH_CLIENT_ID,
          metadata: { source: "file" },
          domains: [domain],
          accountCreation: { enabled: true, requiredGroups: [] },
        },
        metadataXml: idp.metadata(),
      });
      await test.services.identityProviders.addCredential(SYSTEM, created.id, {
        kind: "clientSecret",
        secret: GRAPH_CLIENT_SECRET,
        expiresAt: null,
      });
      const signInWithGroups = async () => {
        const started = await test.services.providerSignIn.start({
          providerId: created.id,
          purpose: "signIn",
          baseUrl: BASE,
        });
        const samlResponse = await idp.response({
          ...target(created.id),
          nameId: randomUUID(),
          attributes: {
            [ENTRA_SAML_CLAIMS.tenantId]: [GRAPH_TENANT_ID],
            [ENTRA_SAML_CLAIMS.objectId]: [GRAPH_IDS.olga],
            [ENTRA_SAML_CLAIMS.email]: [`olga@${domain}`],
            [ENTRA_SAML_CLAIMS.groups]: [GRAPH_IDS.engineering],
          },
          requestId: requestIdOf(started.url),
        });
        const receipt = await test.services.providerSignIn.receiveSamlResponse({
          providerId: created.id,
          samlResponse,
          relayState: new URL(started.url).searchParams.get("RelayState"),
        });
        const result = await test.services.providerSignIn.callback({
          providerId: created.id,
          query: new URLSearchParams({ state: receipt.state }),
          browserToken: started.browserToken,
          client: {},
        });
        expect(result.kind).toBe("signedIn");
      };
      const name = async () =>
        (
          await test.pool.query<{ name: string | null }>(
            "select name from provider_groups where provider_id = $1 and external_id = $2",
            [created.id, GRAPH_IDS.engineering],
          )
        ).rows[0]?.name;
      graph.renameGroup(GRAPH_IDS.engineering, "Engineering");
      await signInWithGroups();
      expect(await name()).toBe("Engineering");
      graph.renameGroup(GRAPH_IDS.engineering, "Engineering Department");
      await signInWithGroups();
      expect(await name()).toBe("Engineering Department");
    } finally {
      await graph.close();
    }
  });

  it("warns about Entra ID providers that cannot read groups through Graph", async () => {
    const { provider: created } = await test.services.identityProviders.create(SYSTEM, {
      type: "saml",
      name: "Entra SAML",
      config: { preset: "entraId", tenantId: randomUUID(), metadata: { source: "file" } },
      metadataXml: idp.metadata(),
    });
    expect(created.warnings).toContain("noGraphCredential");
    const withClient = await test.services.identityProviders.update(SYSTEM, created.id, {
      config: { ...created.config, graphClientId: "graph-client" },
    });
    expect(withClient.warnings).toContain("noGraphCredential");
    await test.services.identityProviders.addCredential(SYSTEM, created.id, {
      kind: "clientSecret",
      secret: "graph-secret",
      expiresAt: null,
    });
    const ready = await test.services.identityProviders.get(created.id);
    expect(ready.warnings).not.toContain("noGraphCredential");
    expect(ready.capabilities.directorySync).toBe(true);
  });

  describe("a provider that leaves out the groups attribute", () => {
    async function mappedProvider() {
      const org = await organization();
      const { id, domain } = await provider({ groups: "groups" });
      await test.services.mappingRules.create(SYSTEM, id, {
        target: "organization",
        group: { id: "staff", name: "staff" },
        organizationId: org.id,
        role: null,
        synchronizedGroup: false,
        homeOrganization: false,
      });
      return { id, domain, org: org.id };
    }

    async function memberOf(org: string, result: CallbackResult): Promise<boolean> {
      if (result.kind !== "signedIn") throw new Error(`Signed in expected, got ${result.kind}`);
      const rows = await test.pool.query(
        "select 1 from memberships where organization_id = $1 and account_id = $2",
        [org, result.signedIn.session.accountId],
      );
      return rows.rowCount === 1;
    }

    async function missingEvents(id: string): Promise<number> {
      const rows = await test.pool.query(
        "select 1 from audit_events where name = 'auth.groupsClaimMissing' and target_id = $1",
        [id],
      );
      return rows.rowCount ?? 0;
    }

    it("treats a person in no group as having no groups, records it and warns once groups were seen", async () => {
      const { id, domain, org } = await mappedProvider();
      const person = { nameId: randomUUID(), email: `p.${randomUUID().slice(0, 8)}@${domain}` };
      const staff = { attributes: { groups: ["staff"] } };
      expect(await memberOf(org, await signIn(id, person, "signIn", staff))).toBe(true);
      expect(await missingEvents(id)).toBe(0);
      expect((await test.services.identityProviders.get(id)).warnings).not.toContain("groupsClaimMissing");

      expect(await memberOf(org, await signIn(id, person))).toBe(false);
      expect(await missingEvents(id)).toBe(1);
      const warned = await test.services.identityProviders.get(id);
      expect(warned.warnings).toContain("groupsClaimMissing");
      expect(warned.groupsClaimMissingSince).toBeInstanceOf(Date);

      expect(await memberOf(org, await signIn(id, person, "signIn", staff))).toBe(true);
      const cleared = await test.services.identityProviders.get(id);
      expect(cleared.warnings).not.toContain("groupsClaimMissing");
      expect(cleared.groupsClaimMissingSince).toBeNull();
    });

    it("treats an empty groups attribute as no groups without a warning", async () => {
      const { id, domain, org } = await mappedProvider();
      const person = { nameId: randomUUID(), email: `e.${randomUUID().slice(0, 8)}@${domain}` };
      await signIn(id, person, "signIn", { attributes: { groups: ["staff"] } });
      const result = await signIn(id, person, "signIn", { attributes: { groups: [""] } });
      expect(await memberOf(org, result)).toBe(false);
      expect(await missingEvents(id)).toBe(0);
      expect((await test.services.identityProviders.get(id)).warnings).not.toContain("groupsClaimMissing");
    });

    it("tracks nothing while no groups attribute is configured", async () => {
      const { id, domain } = await provider();
      await signIn(id, { nameId: randomUUID(), email: `n.${randomUUID().slice(0, 8)}@${domain}` });
      expect(await missingEvents(id)).toBe(0);
    });

    it("forgets what it saw when the groups attribute setting changes", async () => {
      const { id, domain } = await mappedProvider();
      const person = { nameId: randomUUID(), email: `c.${randomUUID().slice(0, 8)}@${domain}` };
      await signIn(id, person, "signIn", { attributes: { groups: ["staff"] } });
      await signIn(id, person);
      expect((await test.services.identityProviders.get(id)).warnings).toContain("groupsClaimMissing");
      const current = (await test.services.identityProviders.get(id)).config;
      if (!("attributes" in current)) throw new Error("A provider with an attributes setting is expected");
      await test.services.identityProviders.update(SYSTEM, id, {
        config: { ...current, attributes: { ...current.attributes, groups: "memberOf" } },
      });
      const updated = await test.services.identityProviders.get(id);
      expect(updated.warnings).not.toContain("groupsClaimMissing");
      expect(updated.groupsClaimMissingSince).toBeNull();
    });

    it("applies the same rule to Entra ID and keeps the groups unknown when they are too many", async () => {
      const org = await organization();
      const domain = `${randomUUID().slice(0, 8)}.example.org`;
      const tenantId = randomUUID();
      const { provider: created } = await test.services.identityProviders.create(SYSTEM, {
        type: "saml",
        name: "Entra SAML groups",
        config: {
          preset: "entraId",
          tenantId,
          metadata: { source: "file" },
          domains: [domain],
          accountCreation: { enabled: true, requiredGroups: [] },
        },
        metadataXml: idp.metadata(),
      });
      const group = randomUUID();
      await test.services.mappingRules.create(SYSTEM, created.id, {
        target: "organization",
        group: { id: group, name: "Staff" },
        organizationId: org.id,
        role: null,
        synchronizedGroup: false,
        homeOrganization: false,
      });
      const objectId = randomUUID();
      const person = { nameId: randomUUID(), email: `o.${objectId.slice(0, 8)}@${domain}` };
      const entra = (extra: Record<string, string[]>) => ({
        attributes: {
          [ENTRA_SAML_CLAIMS.tenantId]: [tenantId],
          [ENTRA_SAML_CLAIMS.objectId]: [objectId],
          [ENTRA_SAML_CLAIMS.email]: [person.email],
          ...extra,
        },
      });
      const grouped = entra({ [ENTRA_SAML_CLAIMS.groups]: [group] });
      expect(await memberOf(org.id, await signIn(created.id, person, "signIn", grouped))).toBe(true);
      const overage = entra({ [ENTRA_SAML_CLAIMS.groupsLink]: ["https://graph.microsoft.com/v1.0/groups"] });
      expect(await memberOf(org.id, await signIn(created.id, person, "signIn", overage))).toBe(true);
      expect(await missingEvents(created.id)).toBe(0);
      expect(await memberOf(org.id, await signIn(created.id, person, "signIn", entra({})))).toBe(false);
      expect(await missingEvents(created.id)).toBe(1);
      expect((await test.services.identityProviders.get(created.id)).warnings).toContain(
        "groupsClaimMissing",
      );
    });
  });
});
