import type { ScopeChain } from "../settings/service.js";

/**
 * The settings scopes that apply to an account. Only the instance level exists until accounts
 * have home organizations.
 */
export function accountScopeChain(_accountId: string): ScopeChain {
  return {};
}
