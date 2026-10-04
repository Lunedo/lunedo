import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accountPrincipal, SYSTEM } from "../accounts/principal.js";
import { InvalidCredentialsError, LockedError, RateLimitedError } from "../auth/errors.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
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

  beforeAll(async () => {
    test = await createTestServices(baseUrl ?? "", { directoryConnector: directory.connector });
    await test.pool.query("insert into instance (id, setup_completed_at) values (1, now())");
  });

  afterAll(async () => {
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

  async function provider(secondFactor: "pagehall" | "provider" = "provider") {
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
    const { id, domain } = await provider();
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
    const { id, domain } = await provider();
    const gone = person(`gone-${randomUUID().slice(0, 6)}`, domain);
    directory.entries.push(gone);
    const first = await signIn(id, String(gone.attributes.mail?.[0]));
    if (first.kind !== "signedIn") throw new Error("Signed in expected");
    directory.entries.splice(directory.entries.indexOf(gone), 1);
    await test.services.providerSync.run(id, "manual");
    expect((await test.services.accounts.get(first.signedIn.session.accountId))?.state).toBe("deactivated");
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
