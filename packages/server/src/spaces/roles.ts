import { type SpaceRole, spaceRoles } from "./schema.js";

export function spaceRoleRank(role: SpaceRole | null | undefined): number {
  return role ? spaceRoles.indexOf(role) + 1 : 0;
}

export function grantsSpaceRole(held: SpaceRole | null | undefined, required: SpaceRole): boolean {
  return spaceRoleRank(held) >= spaceRoleRank(required);
}

export function highestSpaceRole(roles: readonly (SpaceRole | null | undefined)[]): SpaceRole | null {
  let highest: SpaceRole | null = null;
  for (const role of roles) if (spaceRoleRank(role) > spaceRoleRank(highest)) highest = role ?? null;
  return highest;
}
