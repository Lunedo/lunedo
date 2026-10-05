import { Attribute, Change, Client } from "ldapts";

export const LDAP_URL = process.env.PAGEHALL_E2E_LDAP_URL || "ldap://localhost:3389";
export const LDAP_DOMAIN = "directory.example.org";
export const LDAP_PASSWORD = "pagehall-test-password";
export const LDAP_SERVICE = {
  dn: "cn=pagehall,ou=service,dc=example,dc=org",
  password: "pagehall-ldap-service-password",
};
export const LDAP_BASE = { users: "ou=people,dc=example,dc=org", groups: "ou=groups,dc=example,dc=org" };

export type LdapUser = "lena" | "max" | "nora" | "otto";
export type LdapGroup = "staff" | "platform" | "engineering";

export function userDn(user: LdapUser): string {
  return `uid=${user},${LDAP_BASE.users}`;
}

function groupDn(group: LdapGroup): string {
  return `cn=${group},${LDAP_BASE.groups}`;
}

async function withAdmin<T>(run: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ url: LDAP_URL, timeout: 10_000, connectTimeout: 10_000 });
  try {
    await client.bind("cn=admin,dc=example,dc=org", "admin");
    return await run(client);
  } finally {
    await client.unbind();
  }
}

export function groupId(group: LdapGroup): Promise<string> {
  return withAdmin(async (client) => {
    const { searchEntries } = await client.search(groupDn(group), {
      scope: "base",
      attributes: ["entryUUID"],
    });
    const id = searchEntries[0]?.entryUUID;
    if (typeof id !== "string") throw new Error(`The group ${group} has no entryUUID`);
    return id;
  });
}

async function modify(dn: string, change: Change): Promise<void> {
  await withAdmin((client) => client.modify(dn, change));
}

export async function addMember(group: LdapGroup, member: string): Promise<void> {
  await modify(
    groupDn(group),
    new Change({ operation: "add", modification: new Attribute({ type: "member", values: [member] }) }),
  ).catch((error: unknown) => {
    if ((error as { code?: number }).code !== 20) throw error;
  });
}

export async function removeMember(group: LdapGroup, member: string): Promise<void> {
  await modify(
    groupDn(group),
    new Change({ operation: "delete", modification: new Attribute({ type: "member", values: [member] }) }),
  ).catch((error: unknown) => {
    if ((error as { code?: number }).code !== 16) throw error;
  });
}

export async function setDisabled(user: LdapUser, disabled: boolean): Promise<void> {
  await modify(
    userDn(user),
    new Change({
      operation: "replace",
      modification: new Attribute({ type: "employeeType", values: disabled ? ["disabled"] : [] }),
    }),
  );
}
