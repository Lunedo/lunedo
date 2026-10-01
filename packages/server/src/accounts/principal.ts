/**
 * Who performed an action (ADR 0015). Anonymous stands for visitors who are not signed in,
 * system for automated actions such as cleanup jobs and configuration applied at startup.
 */
export type Principal = { type: "account"; id: string } | { type: "anonymous" } | { type: "system" };

export type PrincipalType = Principal["type"];

export const principalTypes = ["account", "anonymous", "system"] as const satisfies readonly PrincipalType[];

export const ANONYMOUS: Principal = { type: "anonymous" };
export const SYSTEM: Principal = { type: "system" };

export function accountPrincipal(id: string): Principal {
  return { type: "account", id };
}
