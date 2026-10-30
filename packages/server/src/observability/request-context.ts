import { AsyncLocalStorage } from "node:async_hooks";
import type { Principal } from "../accounts/principal.js";

export interface RequestContext {
  requestId: string;
  clientIp?: string;
  userAgent?: string;
  actor?: Principal;
  cache?: Map<string, unknown>;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

/** Sets the context for the rest of the current asynchronous execution, e.g. in a request hook. */
export function enterRequestContext(context: RequestContext): void {
  storage.enterWith(context);
}

export function currentRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

export function clearRequestCache(): void {
  storage.getStore()?.cache?.clear();
}

/** Runs `fn` with an empty request cache, so it reads every fact again but each only once. */
export function withFreshRequestCache<T>(fn: () => T): T {
  const current = storage.getStore();
  if (!current) return fn();
  return storage.run({ ...current, cache: new Map() }, fn);
}
