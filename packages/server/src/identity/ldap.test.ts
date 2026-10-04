import { randomUUID } from "node:crypto";
import { type LdapConfigInput, ldapConfigSchema } from "@pagehall/shared";
import { describe, expect, it } from "vitest";
import { FakeLdapDirectory, type FakeLdapEntry } from "../testing/fakes/ldap-directory.js";
import {
  DirectoryConnectionError,
  DirectorySignInError,
  type LdapProviderDefinition,
  type ProviderCredential,
} from "./adapter.js";
import { GROUP_DEPTH_LIMIT, guidFromBytes, guidToBytes, LdapAdapter } from "./ldap.js";

const SERVICE_DN = "cn=pagehall,ou=service,dc=corp,dc=example";
const SERVICE_PASSWORD = "service password";
const PASSWORD = "user password";

const credentials: ProviderCredential[] = [
  { id: randomUUID(), kind: "bindPassword", secret: SERVICE_PASSWORD, keyId: null, certificate: null },
];

function guid(): Buffer {
  return guidToBytes(randomUUID());
}

function windowsTime(date: Date): string {
  return String((BigInt(date.getTime()) + 11_644_473_600_000n) * 10_000n);
}

function adUser(
  name: string,
  extra: Record<string, (string | Buffer)[]> = {},
  entry: Partial<FakeLdapEntry> = {},
) {
  return {
    dn: `CN=${name},OU=People,DC=corp,DC=example`,
    password: PASSWORD,
    attributes: {
      objectClass: ["user"],
      objectCategory: ["person"],
      objectGUID: [guid()],
      userPrincipalName: [`${name}@corp.example`],
      sAMAccountName: [name],
      mail: [`${name}@corp.example`],
      displayName: [`${name[0]?.toUpperCase()}${name.slice(1)} Example`],
      userAccountControl: ["512"],
      accountExpires: ["0"],
      ...extra,
    },
    ...entry,
  };
}

function adGroup(name: string, members: string[]): FakeLdapEntry {
  return {
    dn: `CN=${name},OU=Groups,DC=corp,DC=example`,
    attributes: { objectClass: ["group"], objectGUID: [guid()], cn: [name], member: members },
  };
}

function activeDirectory(): FakeLdapDirectory {
  const alice = adUser("alice");
  const bob = adUser("bob", { userAccountControl: ["514"] });
  const carol = adUser("carol", { accountExpires: [windowsTime(new Date(Date.now() - 86_400_000))] });
  const staff = adGroup("Staff", [alice.dn]);
  const engineering = adGroup("Engineering", [staff.dn]);
  const loopA = adGroup("Loop A", [alice.dn, "CN=Loop B,OU=Groups,DC=corp,DC=example"]);
  const loopB = adGroup("Loop B", [loopA.dn]);
  return new FakeLdapDirectory([
    { dn: SERVICE_DN, password: SERVICE_PASSWORD, attributes: { objectClass: ["user"] } },
    alice,
    bob,
    carol,
    staff,
    engineering,
    loopA,
    loopB,
  ]);
}

function adProvider(config: Partial<LdapConfigInput> = {}): LdapProviderDefinition {
  return {
    id: randomUUID(),
    name: "Active Directory",
    directoryKey: null,
    type: "ldap",
    caCertificates: null,
    config: ldapConfigSchema.parse({
      preset: "activeDirectory",
      url: "ldaps://dc01.corp.example",
      bindDn: SERVICE_DN,
      userBaseDn: "OU=People,DC=corp,DC=example",
      groupBaseDn: "OU=Groups,DC=corp,DC=example",
      ...config,
    }),
  };
}

function openLdapUser(uid: string, extra: Record<string, string[]> = {}): FakeLdapEntry {
  return {
    dn: `uid=${uid},ou=people,dc=example,dc=org`,
    password: PASSWORD,
    attributes: {
      objectClass: ["inetOrgPerson"],
      entryUUID: [randomUUID()],
      uid: [uid],
      mail: [`${uid}@example.org`],
      cn: [`${uid} Example`],
      ...extra,
    },
  };
}

function openLdapGroup(name: string, members: string[]): FakeLdapEntry {
  return {
    dn: `cn=${name},ou=groups,dc=example,dc=org`,
    attributes: { objectClass: ["groupOfNames"], entryUUID: [randomUUID()], cn: [name], member: members },
  };
}

function genericProvider(config: Partial<LdapConfigInput> = {}): LdapProviderDefinition {
  return {
    id: randomUUID(),
    name: "OpenLDAP",
    directoryKey: null,
    type: "ldap",
    caCertificates: null,
    config: ldapConfigSchema.parse({
      preset: "generic",
      url: "ldaps://ldap.example.org",
      bindDn: "cn=pagehall,ou=service,dc=example,dc=org",
      userBaseDn: "ou=people,dc=example,dc=org",
      groupBaseDn: "ou=groups,dc=example,dc=org",
      ...config,
    }),
  };
}

function openLdap(extra: FakeLdapEntry[] = []): FakeLdapDirectory {
  return new FakeLdapDirectory([
    { dn: "cn=pagehall,ou=service,dc=example,dc=org", password: SERVICE_PASSWORD, attributes: {} },
    ...extra,
  ]);
}

describe("LDAP and Active Directory", () => {
  it("signs in with the user principal name and reads nested groups through the matching rule", async () => {
    const directory = activeDirectory();
    const adapter = new LdapAdapter({ allowInsecure: false, connector: directory.connector });
    const result = await adapter.authenticate(adProvider(), credentials, {
      signInName: "alice@corp.example",
      password: PASSWORD,
    });
    const alice = directory.find("CN=alice,OU=People,DC=corp,DC=example");
    expect(result.profile).toMatchObject({
      subject: guidFromBytes(alice?.attributes.objectGUID?.[0] as Buffer),
      email: "alice@corp.example",
      signInName: "alice@corp.example",
      displayName: "Alice Example",
    });
    expect(result.profile.groups?.map((group) => group.name).sort()).toEqual([
      "Engineering",
      "Loop A",
      "Loop B",
      "Staff",
    ]);
    expect(directory.binds.map((bind) => bind.dn)).toEqual([SERVICE_DN, alice?.dn]);
    expect(directory.filters.some((filter) => filter.includes("member:1.2.840.113556.1.4.1941:="))).toBe(
      true,
    );
  });

  it("signs in with sAMAccountName when the provider asks for it", async () => {
    const directory = activeDirectory();
    const adapter = new LdapAdapter({ allowInsecure: false, connector: directory.connector });
    const result = await adapter.authenticate(
      adProvider({ signInAttribute: "sAMAccountName" }),
      credentials,
      {
        signInName: "alice",
        password: PASSWORD,
      },
    );
    expect(result.profile.signInName).toBe("alice");
  });

  it("refuses an empty password before any bind", async () => {
    const directory = activeDirectory();
    const adapter = new LdapAdapter({ allowInsecure: false, connector: directory.connector });
    await expect(
      adapter.authenticate(adProvider(), credentials, { signInName: "alice@corp.example", password: "" }),
    ).rejects.toMatchObject({ reason: "invalidCredentials" });
    expect(directory.binds).toEqual([]);
    expect(await adapter.verifyPassword(adProvider(), credentials, randomUUID(), "")).toBe(false);
    expect(directory.binds).toEqual([]);
  });

  it("escapes the sign-in name in filters", async () => {
    const directory = activeDirectory();
    const adapter = new LdapAdapter({ allowInsecure: false, connector: directory.connector });
    for (const signInName of ["a*", "*", "alice@corp.example)(objectClass=*", "*)(|(userPrincipalName=*"]) {
      await expect(
        adapter.authenticate(adProvider(), credentials, { signInName, password: PASSWORD }),
      ).rejects.toMatchObject({ reason: "invalidCredentials" });
    }
    expect(directory.binds.filter((bind) => bind.dn !== SERVICE_DN)).toEqual([]);
    expect(directory.filters.some((filter) => filter.includes("(userPrincipalName=a\\2a)"))).toBe(true);
  });

  it("translates the messages of Active Directory", async () => {
    const cases = {
      "530": "outsideSignInHours",
      "532": "passwordExpired",
      "533": "accountDisabled",
      "701": "accountDisabled",
      "773": "passwordMustChange",
      "775": "accountLocked",
      "52e": "invalidCredentials",
    } as const;
    for (const [code, reason] of Object.entries(cases)) {
      const directory = activeDirectory();
      const alice = directory.find("CN=alice,OU=People,DC=corp,DC=example");
      if (alice)
        alice.bindError = `80090308: LdapErr: DSID-0C09044E, comment: AcceptSecurityContext error, data ${code}, v4563`;
      const adapter = new LdapAdapter({ allowInsecure: false, connector: directory.connector });
      const error = await adapter
        .authenticate(adProvider(), credentials, { signInName: "alice@corp.example", password: PASSWORD })
        .catch((caught: unknown) => caught);
      expect(error, code).toBeInstanceOf(DirectorySignInError);
      expect((error as DirectorySignInError).reason, code).toBe(reason);
    }
  });

  it("refuses disabled and expired Active Directory accounts", async () => {
    const directory = activeDirectory();
    const adapter = new LdapAdapter({ allowInsecure: false, connector: directory.connector });
    for (const name of ["bob", "carol"]) {
      await expect(
        adapter.authenticate(adProvider(), credentials, {
          signInName: `${name}@corp.example`,
          password: PASSWORD,
        }),
      ).rejects.toMatchObject({ reason: "accountDisabled" });
    }
  });

  it("walks member attributes with cycle detection and a depth limit", async () => {
    const ada = openLdapUser("ada");
    const loopA = openLdapGroup("loop-a", [ada.dn, "cn=loop-b,ou=groups,dc=example,dc=org"]);
    const loopB = openLdapGroup("loop-b", [loopA.dn]);
    const chain: FakeLdapEntry[] = [];
    let previous = ada.dn;
    for (let level = 0; level < GROUP_DEPTH_LIMIT + 3; level++) {
      const group = openLdapGroup(`level-${level}`, [previous]);
      chain.push(group);
      previous = group.dn;
    }
    const directory = openLdap([ada, loopA, loopB, ...chain]);
    const adapter = new LdapAdapter({ allowInsecure: false, connector: directory.connector });
    const result = await adapter.authenticate(genericProvider(), credentials, {
      signInName: "ada@example.org",
      password: PASSWORD,
    });
    const names = result.profile.groups?.map((group) => group.name) ?? [];
    expect(names).toContain("loop-a");
    expect(names).toContain("loop-b");
    expect(names).toContain(`level-${GROUP_DEPTH_LIMIT - 1}`);
    expect(names).not.toContain(`level-${GROUP_DEPTH_LIMIT}`);
    expect(result.profile.groups?.every((group) => /^[0-9a-f-]{36}$/.test(group.id))).toBe(true);
  });

  it("walks memberOf attributes with cycle detection", async () => {
    const groupA = "cn=a,ou=groups,dc=example,dc=org";
    const groupB = "cn=b,ou=groups,dc=example,dc=org";
    const ada = openLdapUser("ada", { memberOf: [groupA] });
    const a = {
      ...openLdapGroup("a", []),
      attributes: { ...openLdapGroup("a", []).attributes, memberOf: [groupB] },
    };
    const b = {
      ...openLdapGroup("b", []),
      attributes: { ...openLdapGroup("b", []).attributes, memberOf: [groupA] },
    };
    const directory = openLdap([ada, a, b]);
    const adapter = new LdapAdapter({ allowInsecure: false, connector: directory.connector });
    const result = await adapter.authenticate(genericProvider({ groupMembership: "memberOf" }), credentials, {
      signInName: "ada@example.org",
      password: PASSWORD,
    });
    expect(result.profile.groups?.map((group) => group.name).sort()).toEqual(["a", "b"]);
  });

  it("reports disabled, removed and enabled accounts in a synchronization", async () => {
    const ada = openLdapUser("ada");
    const ben = openLdapUser("ben", { employeeType: ["disabled"] });
    const staff = openLdapGroup("staff", [ada.dn]);
    const directory = openLdap([ada, ben, staff]);
    const adapter = new LdapAdapter({ allowInsecure: false, connector: directory.connector });
    const provider = genericProvider({ disabled: { attribute: "employeeType", values: ["disabled"] } });
    const gone = randomUUID();
    const subjects = [ada, ben].map((entry) => String(entry.attributes.entryUUID?.[0]));
    const results = [];
    for await (const result of adapter.synchronizeAccounts(provider, credentials, [...subjects, gone])) {
      results.push(result);
    }
    expect(results.map((result) => [result.subject, result.state])).toEqual([
      [subjects[0], "enabled"],
      [subjects[1], "disabled"],
      [gone, "deleted"],
    ]);
    expect(results[0]?.profile?.groups?.map((group) => group.name)).toEqual(["staff"]);
  });

  it("fails a synchronization whose user search base does not exist instead of reporting everyone as removed", async () => {
    const ada = openLdapUser("ada");
    const directory = openLdap([ada]);
    directory.missingBases.add("ou=people,dc=example,dc=org");
    const adapter = new LdapAdapter({ allowInsecure: false, connector: directory.connector });
    const results = async () => {
      const collected = [];
      for await (const result of adapter.synchronizeAccounts(genericProvider(), credentials, [
        String(ada.attributes.entryUUID?.[0]),
      ])) {
        collected.push(result);
      }
      return collected;
    };
    await expect(results()).rejects.toThrow(/does not exist/);
  });

  it("detects disabled and expired accounts of Active Directory in a synchronization", async () => {
    const directory = activeDirectory();
    const adapter = new LdapAdapter({ allowInsecure: false, connector: directory.connector });
    const subjects = ["alice", "bob", "carol"].map((name) =>
      guidFromBytes(
        directory.find(`CN=${name},OU=People,DC=corp,DC=example`)?.attributes.objectGUID?.[0] as Buffer,
      ),
    );
    const states = [];
    for await (const result of adapter.synchronizeAccounts(adProvider(), credentials, subjects)) {
      states.push(result.state);
    }
    expect(states).toEqual(["enabled", "disabled", "disabled"]);
  });

  it("refuses a plain connection unless insecure providers are allowed", async () => {
    const directory = activeDirectory();
    const plain = adProvider({ url: "ldap://dc01.corp.example" });
    const secure = new LdapAdapter({ allowInsecure: false, connector: directory.connector });
    await expect(
      secure.authenticate(plain, credentials, { signInName: "alice@corp.example", password: PASSWORD }),
    ).rejects.toMatchObject({ reason: "insecureConnection" } satisfies Partial<DirectoryConnectionError>);
    expect(directory.targets).toEqual([]);
    await expect(
      secure.authenticate(adProvider({ url: "ldap://dc01.corp.example", startTls: true }), credentials, {
        signInName: "alice@corp.example",
        password: PASSWORD,
      }),
    ).resolves.toBeTruthy();
    const insecure = new LdapAdapter({ allowInsecure: true, connector: directory.connector });
    await expect(
      insecure.authenticate(plain, credentials, { signInName: "alice@corp.example", password: PASSWORD }),
    ).resolves.toBeTruthy();
  });

  it("checks the password of a linked person for re-authentication", async () => {
    const directory = activeDirectory();
    const adapter = new LdapAdapter({ allowInsecure: false, connector: directory.connector });
    const alice = directory.find("CN=alice,OU=People,DC=corp,DC=example");
    const subject = guidFromBytes(alice?.attributes.objectGUID?.[0] as Buffer);
    expect(await adapter.verifyPassword(adProvider(), credentials, subject, PASSWORD)).toBe(true);
    expect(await adapter.verifyPassword(adProvider(), credentials, subject, "wrong")).toBe(false);
  });

  it("reports which step of the directory test failed", async () => {
    const directory = activeDirectory();
    const adapter = new LdapAdapter({ allowInsecure: false, connector: directory.connector });
    const passed = await adapter.testDirectory(adProvider(), credentials, "alice@corp.example");
    expect(passed.steps.map((step) => [step.step, step.ok])).toEqual([
      ["connection", true],
      ["certificate", true],
      ["serviceAccount", true],
      ["search", true],
    ]);
    expect(passed.sample?.email).toBe("alice@corp.example");
    expect(passed.attributes).toContainEqual({ name: "mail", values: ["alice@corp.example"] });
    expect(passed.attributes.find((attribute) => attribute.name === "objectGUID")?.values).toEqual([
      passed.sample?.subject,
    ]);
    const wrong = [{ ...credentials[0], secret: "wrong" } as ProviderCredential];
    const failed = await adapter.testDirectory(adProvider(), wrong, null);
    expect(failed.steps.map((step) => [step.step, step.ok])).toEqual([
      ["connection", true],
      ["certificate", true],
      ["serviceAccount", false],
    ]);
  });
});
