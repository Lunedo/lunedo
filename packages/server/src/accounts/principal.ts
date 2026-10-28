import type { Areas } from "../authorization/areas.js";

export interface TokenScopes {
  instance?: Areas;
  organization?: Areas;
}

export const contentLevels = ["read", "draft", "publish"] as const;
export type ContentLevel = (typeof contentLevels)[number];

export interface TokenGrant {
  id: string;
  organizationId: string | null;
  scopes: TokenScopes;
  contentLevel?: ContentLevel;
  knowledgeBaseIds?: readonly string[] | null;
}

export type Principal =
  | { type: "account"; id: string; token?: TokenGrant }
  | { type: "anonymous" }
  | { type: "system"; id?: SystemActorId };

export const systemActorIds = ["setupAssistant"] as const;
export type SystemActorId = (typeof systemActorIds)[number];

export function isSystemActorId(value: unknown): value is SystemActorId {
  return (systemActorIds as readonly unknown[]).includes(value);
}

export type PrincipalType = Principal["type"];

export const principalTypes = ["account", "anonymous", "system"] as const satisfies readonly PrincipalType[];

export const ANONYMOUS: Principal = { type: "anonymous" };
export const SYSTEM: Principal = { type: "system" };
export const SETUP_ASSISTANT: Principal = { type: "system", id: "setupAssistant" };

export function accountPrincipal(id: string): { type: "account"; id: string } {
  return { type: "account", id };
}
