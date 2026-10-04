import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { instanceUrlSetting } from "../accounts/instance-settings.js";
import { accountPrincipal, SYSTEM } from "../accounts/principal.js";
import { InvalidCredentialsError, LockedError, RateLimitedError } from "../auth/errors.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { type FakeOidcProvider, startFakeOidcProvider } from "../testing/fake-oidc.js";
import { FakeLdapDirectory, type FakeLdapEntry } from "../testing/fakes/ldap-directory.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { type CallbackResult, DirectorySignInRefusedError } from "./sign-in.js";

const baseUrl = testDatabaseBaseUrl();
const PASSWORD = "directory password";
const SERVICE_DN = "cn=pagehall,ou=service,dc=example,dc=org";
const SERVICE_PASSWORD = "service password";

function person(uid: string, domain: string, extra: Record<string, string[]> = {}): FakeLdapEntry {
  return {
    dn: `uid=${uid},ou=people,dc=example,dc=org`,
    password: PASSWORD,
    attributes: {
      objectClass: ["inetOrgPerson"],
      entryUUID: [randomUUID()],
      uid: [uid],
      mail: [`${uid}@${domain}`],
      cn: [`${uid} Example`],
      ...extra,
    },
  };
}

function group(name: string, members: string[]): FakeLdapEntry {
  return {
    dn: `cn=${name},ou=groups,dc=example,dc=org`,
    attributes: { objectClass: ["groupOfNames"], entryUUID: [randomUUID()], cn: [name], member: members },
  };
}

describe.skipIf(!baseUrl)("signing in through an LDAP directory", () => {
  const directory = new FakeLdapDirectory([{ dn: SERVICE_DN, password: SERVICE_PASSWORD, attributes: {} }]);
  let test: TestServices;
  let idp: FakeOidcProvider;

  beforeAll(async () => {
    test = await createTestServices(baseUrl ?? "", { directoryConnector: directory.connector });
    await test.pool.query("insert into instance (id, setup_completed_at) values (1, now())");
    await test.settings.set(instanceUrlSetting, {}, "instance", "https://wiki.example.org");
    idp = await startFakeOidcProvider();
  });

  afterAll(async () => {
    await idp?.close();
    await test?.close();
  });

  async function organization() {
    const owner = await test.database.transaction((tx) =>
      test.services.accounts.createStandard(tx, {
        email: `${randomUUID()}@owner.example`,
        name: "Owner",
        password: "a long test passphrase",
        homeOrganizationId: null,
      }),
    );
    const created = await test.services.organizations.createAsActor(SYSTEM, {
      name: `Organization ${randomUUID().slice(0, 8)}`,
      ownerAccountId: owner.id,
    });
    return { id: created.id, owner: owner.id };
  }

  async function provider(secondFactor: "pagehall" | "provider" = "provider", deactivationLimitPercent = 20) {
    const domain = `${randomUUID().slice(0, 8)}.example.org`;
    const { provider: created } = await test.services.identityProviders.create(SYSTEM, {
      type: "ldap",
      name: "Directory",
      config: {
        preset: "generic",
        url: "ldaps://ldap.example.org",
        bindDn: SERVICE_DN,
        userBaseDn: "ou=people,dc=example,dc=org",
        groupBaseDn: "ou=groups,dc=example,dc=org",
        domains: [domain],
        accountCreation: { enabled: true, requiredGroups: [] },
        secondFactor: { mode: secondFactor },
        disabled: { attribute: "employeeType", values: ["disabled"] },
        sync: { intervalMinutes: 60, deactivationLimitPercent },
      },
      credential: { kind: "bindPassword", secret: SERVICE_PASSWORD },
    });
    return { id: created.id, domain };
  }

  function signIn(providerId: string, signInName: string, password = PASSWORD): Promise<CallbackResult> {
    return test.services.providerSignIn.signInWithDirectory({
      providerId,
      signInName,
      password,
      client: { ip: `10.${Math.floor(Math.random() * 250)}.0.1` },
    });
  }

  async function membership(organizationId: string, accountId: string) {
    const result = await test.pool.query(
      "select 1 from memberships where organization_id = $1 and account_id = $2",
      [organizationId, accountId],
    );
    return result.rowCount === 1;
  }

  it("grants access through a nested group and removes it when the person leaves the group", async () => {
    const { id, domain } = await provider();
    const ada = person(`ada-${randomUUID().slice(0, 6)}`, domain);
    const staff = group(`staff-${randomUUID().slice(0, 6)}`, [ada.dn]);
    const engineering = group(`engineering-${randomUUID().slice(0, 6)}`, [staff.dn]);
    const everyone = group(`everyone-${randomUUID().slice(0, 6)}`, [ada.dn]);
    directory.entries.push(ada, staff, engineering, everyone);
    const home = await organization();
    await test.services.mappingRules.create(accountPrincipal(home.owner), id, {
      target: "organization",
      group: { id: String(everyone.attributes.entryUUID?.[0]), name: "Everyone" },
      organizationId: home.id,
      role: null,
      synchronizedGroup: false,
      homeOrganization: true,
    });
    const org = await organization();
    await test.services.mappingRules.create(accountPrincipal(org.owner), id, {
      target: "organization",
      group: { id: String(engineering.attributes.entryUUID?.[0]), name: "Engineering" },
      organizationId: org.id,
      role: null,
      synchronizedGroup: false,
      homeOrganization: false,
    });
    const first = await signIn(id, String(ada.attributes.mail?.[0]));
    if (first.kind !== "signedIn") throw new Error(`Signed in expected, got ${first.kind}`);
    const accountId = first.signedIn.session.accountId;
    expect(first.signedIn.session.kind).toBe("full");
    expect(await membership(org.id, accountId)).toBe(true);

    staff.attributes.member = [];
    const run = await test.services.providerSync.run(id, "manual");
    expect(run?.status).toBe("succeeded");
    expect(await membership(org.id, accountId)).toBe(false);
    expect(await membership(home.id, accountId)).toBe(true);
  });

  it("deactivates a disabled person at the next sync and reactivates them when enabled again", async () => {
    const { id, domain } = await provider("provider", 100);
    const ben = person(`ben-${randomUUID().slice(0, 6)}`, domain);
    directory.entries.push(ben);
    const first = await signIn(id, String(ben.attributes.mail?.[0]));
    if (first.kind !== "signedIn") throw new Error("Signed in expected");
    const accountId = first.signedIn.session.accountId;

    ben.attributes.employeeType = ["disabled"];
    await test.services.providerSync.run(id, "manual");
    expect((await test.services.accounts.get(accountId))?.state).toBe("deactivated");

    ben.attributes.employeeType = [];
    await test.services.providerSync.run(id, "manual");
    expect((await test.services.accounts.get(accountId))?.state).toBe("active");
  });

  it("deactivates a person who is no longer in the directory", async () => {
    const { id, domain } = await provider("provider", 100);
    const [gone] = await people(id, domain, 2);
    directory.entries.splice(directory.entries.indexOf(gone?.entry as FakeLdapEntry), 1);
    await test.services.providerSync.run(id, "manual");
    expect((await test.services.accounts.get(gone?.accountId ?? ""))?.state).toBe("deactivated");
  });

  async function people(providerId: string, domain: string, count: number) {
    const created: { entry: FakeLdapEntry; accountId: string }[] = [];
    for (let index = 0; index < count; index++) {
      const entry = person(`p${index}-${randomUUID().slice(0, 6)}`, domain);
      directory.entries.push(entry);
      const result = await signIn(providerId, String(entry.attributes.mail?.[0]));
      if (result.kind !== "signedIn") throw new Error("Signed in expected");
      created.push({ entry, accountId: result.signedIn.session.accountId });
    }
    return created;
  }

  async function states(accountIds: string[]) {
    return Promise.all(accountIds.map(async (id) => (await test.services.accounts.get(id))?.state));
  }

  async function heldNotices(providerId: string) {
    const result = await test.pool.query<{ recipient_id: string; params: Record<string, unknown> }>(
      "select recipient_id, params from notifications where type = 'identityProvider.syncHeld' and target_id = $1",
      [providerId],
    );
    return result.rows;
  }

  async function instanceOwner() {
    const owner = await test.database.transaction((tx) =>
      test.services.accounts.createStandard(tx, {
        email: `${randomUUID()}@owner.example`,
        name: "Instance owner",
        password: "a long test passphrase",
        homeOrganizationId: null,
      }),
    );
    await test.pool.query("update instance set owner_account_id = $1", [owner.id]);
    return owner.id;
  }

  it("fails a sync whose user search base does not exist and deactivates nobody", async () => {
    const { id, domain } = await provider("provider", 100);
    const linked = await people(id, domain, 2);
    directory.missingBases.add("ou=people,dc=example,dc=org");
    try {
      const run = await test.services.providerSync.run(id, "manual");
      expect(run?.status).toBe("failed");
      expect(run?.error).toContain("does not exist");
    } finally {
      directory.missingBases.clear();
    }
    expect(await states(linked.map((item) => item.accountId))).toEqual(["active", "active"]);
  });

  it("fails a sync that finds none of the linked people, deactivates nobody and notifies administrators", async () => {
    const owner = await instanceOwner();
    const { id, domain } = await provider("provider", 100);
    const linked = await people(id, domain, 2);
    for (const item of linked) directory.entries.splice(directory.entries.indexOf(item.entry), 1);

    const run = await test.services.providerSync.run(id, "manual");
    expect(run).toMatchObject({ status: "failed", heldDeactivations: 2, confirmedAt: null });
    const details = await test.services.providerSync.runDetails(id, run?.id ?? "");
    expect(details?.warnings).toEqual([expect.objectContaining({ kind: "noAccountsFound", detail: "2/2" })]);
    expect(await states(linked.map((item) => item.accountId))).toEqual(["active", "active"]);
    expect(await heldNotices(id)).toEqual([
      expect.objectContaining({ recipient_id: owner, params: expect.objectContaining({ deactivations: 2 }) }),
    ]);
  });

  it("holds a sync that would deactivate more than the share set for the provider until it is confirmed", async () => {
    const owner = await instanceOwner();
    const { id, domain } = await provider();
    const linked = await people(id, domain, 5);
    expect(await states(linked.map((item) => item.accountId))).toEqual(Array(5).fill("active"));
    directory.entries.splice(directory.entries.indexOf(linked[0]?.entry as FakeLdapEntry), 1);

    const allowed = await test.services.providerSync.run(id, "manual");
    expect(allowed?.status).toBe("succeeded");
    expect(await states([linked[0]?.accountId ?? ""])).toEqual(["deactivated"]);

    for (const item of linked.slice(1, 3)) directory.entries.splice(directory.entries.indexOf(item.entry), 1);
    const held = await test.services.providerSync.run(id, "manual");
    expect(held).toMatchObject({ status: "failed", heldDeactivations: 2 });
    const details = await test.services.providerSync.runDetails(id, held?.id ?? "");
    expect(details?.warnings).toEqual([
      expect.objectContaining({ kind: "deactivationLimit", detail: "2/4" }),
    ]);
    expect(await states(linked.slice(1).map((item) => item.accountId))).toEqual(Array(4).fill("active"));
    await expect(test.services.providerSync.run(id, "schedule")).resolves.toMatchObject({ status: "failed" });

    const confirmed = await test.services.providerSync.confirm(accountPrincipal(owner), id, held?.id ?? "");
    expect(await states(linked.slice(1).map((item) => item.accountId))).toEqual([
      "deactivated",
      "deactivated",
      "active",
      "active",
    ]);
    expect(confirmed.runId).not.toBeNull();
    const audit = await test.pool.query(
      "select 1 from audit_events where name = 'identityProvider.syncConfirmed' and target_id = $1",
      [id],
    );
    expect(audit.rowCount).toBe(1);
    await expect(
      test.services.providerSync.confirm(accountPrincipal(owner), id, held?.id ?? ""),
    ).rejects.toMatchObject({ code: "syncNotHeld" });
  });

  it("lets a confirmed run deactivate no more accounts than the run that was held", async () => {
    const owner = await instanceOwner();
    const { id, domain } = await provider();
    const linked = await people(id, domain, 5);
    directory.entries.splice(directory.entries.indexOf(linked[0]?.entry as FakeLdapEntry), 1);
    directory.entries.splice(directory.entries.indexOf(linked[1]?.entry as FakeLdapEntry), 1);
    const held = await test.services.providerSync.run(id, "manual");
    expect(held?.heldDeactivations).toBe(2);

    directory.entries.splice(directory.entries.indexOf(linked[2]?.entry as FakeLdapEntry), 1);
    const confirmed = await test.services.providerSync.confirm(accountPrincipal(owner), id, held?.id ?? "");
    const rerun = await test.services.providerSync.runDetails(id, confirmed.runId ?? "");
    expect(rerun).toMatchObject({ status: "failed", heldDeactivations: 3 });
    expect(await states(linked.map((item) => item.accountId))).toEqual(Array(5).fill("active"));
  });

  it("links a sign-in of another provider to a directory account after its directory password", async () => {
    const { id, domain } = await provider();
    const [moved] = await people(id, domain, 1);
    if (!moved) throw new Error("Account expected");
    await test.pool.query("delete from identity_provider_domains where domain = $1", [domain]);
    const { provider: entra } = await test.services.identityProviders.create(SYSTEM, {
      type: "oidc",
      name: "Cloud",
      config: { preset: "generic", issuer: idp.issuer, clientId: idp.clientId, domains: [domain] },
      credential: { kind: "clientSecret", secret: idp.clientSecret, expiresAt: null },
    });
    const started = await test.services.providerSignIn.start({
      providerId: entra.id,
      purpose: "signIn",
      baseUrl: "https://pagehall.test",
    });
    const callback = await idp.authorize(started.url, {
      sub: randomUUID(),
      email: String(moved.entry.attributes.mail?.[0]),
    });
    const result = await test.services.providerSignIn.callback({
      providerId: entra.id,
      query: callback.searchParams,
      browserToken: started.browserToken,
      client: {},
    });
    if (result.kind !== "linkRequired") throw new Error(`Linking expected, got ${result.kind}`);
    expect(await test.services.providerSignIn.linkInfo(result.pendingToken)).toMatchObject({
      password: false,
      providers: [{ id, name: "Directory", directory: true }],
    });
    await expect(
      test.services.providerSignIn.confirmLinkWithDirectory({
        pendingToken: result.pendingToken,
        providerId: id,
        password: "wrong password",
        client: {},
      }),
    ).rejects.toThrow(InvalidCredentialsError);
    const linked = await test.services.providerSignIn.confirmLinkWithDirectory({
      pendingToken: result.pendingToken,
      providerId: id,
      password: PASSWORD,
      client: {},
    });
    if (!("signedIn" in linked)) throw new Error("Signed in expected");
    expect(linked.signedIn.session).toMatchObject({ accountId: moved.accountId, kind: "full" });
    const identities = await test.pool.query("select 1 from identities where account_id = $1", [
      moved.accountId,
    ]);
    expect(identities.rowCount).toBe(2);
  });

  it("refuses an empty password before asking the directory", async () => {
    const { id, domain } = await provider();
    const before = directory.binds.length;
    await expect(signIn(id, `nobody@${domain}`, "")).rejects.toThrow(InvalidCredentialsError);
    expect(directory.binds.length).toBe(before);
  });

  it("applies Pagehall's rate limits before the bind", async () => {
    const { id, domain } = await provider();
    const cleo = person(`cleo-${randomUUID().slice(0, 6)}`, domain);
    directory.entries.push(cleo);
    const name = String(cleo.attributes.mail?.[0]);
    let blocked: unknown = null;
    for (let attempt = 0; attempt < 30 && !blocked; attempt++) {
      try {
        await signIn(id, name, "wrong password");
      } catch (error) {
        if (error instanceof LockedError || error instanceof RateLimitedError) blocked = error;
        else expect(error).toBeInstanceOf(InvalidCredentialsError);
      }
    }
    expect(blocked).not.toBeNull();
    const binds = directory.binds.filter((bind) => bind.dn === cleo.dn).length;
    await expect(signIn(id, name)).rejects.toSatisfy(
      (error) => error instanceof LockedError || error instanceof RateLimitedError,
    );
    expect(directory.binds.filter((bind) => bind.dn === cleo.dn).length).toBe(binds);
  });

  it("asks for a Pagehall second factor by default", async () => {
    const { id, domain } = await provider("pagehall");
    const dora = person(`dora-${randomUUID().slice(0, 6)}`, domain);
    directory.entries.push(dora);
    const result = await signIn(id, String(dora.attributes.mail?.[0]));
    if (result.kind !== "signedIn") throw new Error(`Signed in expected, got ${result.kind}`);
    expect(result.signedIn.session.kind).toBe("secondFactorSetup");
  });

  it("reports why the directory refused an account that cannot sign in", async () => {
    const { id, domain } = await provider();
    const eve = person(`eve-${randomUUID().slice(0, 6)}`, domain, { employeeType: ["disabled"] });
    directory.entries.push(eve);
    const error = await signIn(id, String(eve.attributes.mail?.[0])).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(DirectorySignInRefusedError);
    expect((error as DirectorySignInRefusedError).code).toBe("accountDisabled");
  });

  it("confirms the identity with the directory password", async () => {
    const { id, domain } = await provider();
    const finn = person(`finn-${randomUUID().slice(0, 6)}`, domain);
    directory.entries.push(finn);
    const result = await signIn(id, String(finn.attributes.mail?.[0]));
    if (result.kind !== "signedIn") throw new Error("Signed in expected");
    const session = result.signedIn.session;
    const input = { sessionId: session.id, accountId: session.accountId, providerId: id, client: {} };
    await expect(
      test.services.providerSignIn.reauthenticateWithDirectory({ ...input, password: "wrong" }),
    ).rejects.toThrow(InvalidCredentialsError);
    await expect(
      test.services.providerSignIn.reauthenticateWithDirectory({ ...input, password: "" }),
    ).rejects.toThrow(InvalidCredentialsError);
    const token = await test.services.providerSignIn.reauthenticateWithDirectory({
      ...input,
      password: PASSWORD,
    });
    expect(token).toBeTruthy();
  });

  it("audits changes of the uploaded CA certificate", async () => {
    const { id } = await provider();
    await expect(
      test.services.identityProviders.setCaCertificate(SYSTEM, id, "nonsense"),
    ).rejects.toMatchObject({
      code: "invalidCertificate",
    });
    const removed = await test.services.identityProviders.removeCaCertificate(SYSTEM, id);
    expect(removed.type === "ldap" && removed.ldap.caCertificate).toBeNull();
  });
});
