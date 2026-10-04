/**
 * Requests in the form Microsoft Entra ID provisioning sends them, with synthetic values:
 * capitalized operations, string booleans from older tenants, filters on userName and
 * externalId, groups without members in GET, and member changes in batches.
 */
export const ENTRA_SCHEMAS = {
  user: "urn:ietf:params:scim:schemas:core:2.0:User",
  enterprise: "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User",
  group: "urn:ietf:params:scim:schemas:core:2.0:Group",
  adGroup: "http://schemas.microsoft.com/2006/11/ResourceManagement/ADSCIM/2.0/Group",
  patch: "urn:ietf:params:scim:api:messages:2.0:PatchOp",
} as const;

export function testConnectionFilter(): string {
  return `userName eq "${crypto.randomUUID()}"`;
}

export function entraUser(input: {
  objectId: string;
  upn: string;
  mail: string;
  given: string;
  family: string;
}) {
  return {
    schemas: [ENTRA_SCHEMAS.user, ENTRA_SCHEMAS.enterprise],
    externalId: input.objectId,
    userName: input.upn,
    active: true,
    displayName: `${input.given} ${input.family}`,
    emails: [{ primary: true, type: "work", value: input.mail }],
    meta: { resourceType: "User" },
    name: { formatted: `${input.given} ${input.family}`, familyName: input.family, givenName: input.given },
    roles: [{ primary: true, type: "WindowsAzureActiveDirectoryRole", value: "Global Administrator" }],
    [ENTRA_SCHEMAS.enterprise]: { department: "Engineering", employeeNumber: "1001" },
  };
}

export function entraReplaceAttributes(mail: string, family: string) {
  return {
    schemas: [ENTRA_SCHEMAS.patch],
    Operations: [
      { op: "Replace", path: 'emails[type eq "work"].value', value: mail },
      { op: "Replace", path: "name.familyName", value: family },
      { op: "Add", path: `${ENTRA_SCHEMAS.enterprise}:department`, value: "Platform" },
    ],
  };
}

export function entraDisable(legacy = false) {
  return {
    schemas: [ENTRA_SCHEMAS.patch],
    Operations: [{ op: "Replace", path: "active", value: legacy ? "False" : false }],
  };
}

export function entraEnable() {
  return { schemas: [ENTRA_SCHEMAS.patch], Operations: [{ op: "Replace", path: "active", value: "True" }] };
}

export function entraGroup(objectId: string, displayName: string) {
  return {
    schemas: [ENTRA_SCHEMAS.group, ENTRA_SCHEMAS.adGroup],
    externalId: objectId,
    displayName,
    meta: { resourceType: "Group" },
  };
}

export function entraAddMembers(ids: string[]) {
  return {
    schemas: [ENTRA_SCHEMAS.patch],
    Operations: [
      { name: "addMember", op: "Add", path: "members", value: ids.map((value) => ({ $ref: null, value })) },
    ],
  };
}

export function entraRemoveMembers(ids: string[]) {
  return {
    schemas: [ENTRA_SCHEMAS.patch],
    Operations: [
      {
        name: "removeMember",
        op: "Remove",
        path: "members",
        value: ids.map((value) => ({ $ref: null, value })),
      },
    ],
  };
}

export function entraRenameGroup(displayName: string) {
  return {
    schemas: [ENTRA_SCHEMAS.patch],
    Operations: [{ op: "Replace", path: "displayName", value: displayName }],
  };
}
