import {
  type AccessLevel,
  type Area,
  type Areas,
  accessLevels,
  areasOf,
  areasSchema,
  type InstanceArea,
  instanceAreas,
  type OrganizationArea,
  organizationAreas,
} from "@pagehall/shared";
import type { BuiltInRoleKey, RoleScope } from "../organizations/access-schema.js";

export {
  type AccessLevel,
  type Area,
  type Areas,
  accessLevels,
  areasOf,
  areasSchema,
  type InstanceArea,
  instanceAreas,
  type OrganizationArea,
  organizationAreas,
};

function rank(level: AccessLevel | undefined): number {
  return level === "manage" ? 2 : level === "view" ? 1 : 0;
}

export function grantsLevel(held: AccessLevel | undefined, required: AccessLevel): boolean {
  return rank(held) >= rank(required);
}

export function coversAreas(held: Areas, required: Areas): boolean {
  return (Object.entries(required) as [Area, AccessLevel][]).every(([area, level]) =>
    grantsLevel(held[area], level),
  );
}

export function mergeAreas(...sets: Areas[]): Areas {
  const merged: Areas = {};
  for (const set of sets) {
    for (const [area, level] of Object.entries(set) as [Area, AccessLevel][]) {
      if (rank(level) > rank(merged[area])) merged[area] = level;
    }
  }
  return merged;
}

export function intersectAreas(left: Areas, right: Areas): Areas {
  const result: Areas = {};
  for (const [area, level] of Object.entries(left) as [Area, AccessLevel][]) {
    const other = right[area];
    if (other) result[area] = rank(level) <= rank(other) ? level : other;
  }
  return result;
}

function all(scope: RoleScope, level: AccessLevel): Areas {
  return Object.fromEntries(areasOf(scope).map((area) => [area, level]));
}

export const builtInRoles: Record<RoleScope, Partial<Record<BuiltInRoleKey, Areas>>> = {
  instance: {
    owner: all("instance", "manage"),
    administrator: all("instance", "manage"),
    securityAuditor: all("instance", "view"),
  },
  organization: {
    owner: all("organization", "manage"),
    administrator: all("organization", "manage"),
    member: { membersAndGroups: "view" },
  },
};

export function builtInRoleAreas(scope: RoleScope, role: BuiltInRoleKey): Areas {
  const areas = builtInRoles[scope][role];
  if (!areas) throw new Error(`The role ${role} does not exist at the ${scope} level`);
  return areas;
}
