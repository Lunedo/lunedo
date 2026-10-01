import type { Areas } from "../authorization/areas.js";

export interface TokenScopes {
  instance?: Areas;
  organization?: Areas;
}

export interface TokenGrant {
  id: string;
  organizationId: string | null;
  scopes: TokenScopes;
}

export type Principal =
  | { type: "account"; id: string; token?: TokenGrant }
  | { type: "anonymous" }
  | { type: "system" };

export type PrincipalType = Principal["type"];

export const principalTypes = ["account", "anonymous", "system"] as const satisfies readonly PrincipalType[];

export const ANONYMOUS: Principal = { type: "anonymous" };
export const SYSTEM: Principal = { type: "system" };

export function accountPrincipal(id: string): { type: "account"; id: string } {
  return { type: "account", id };
}
