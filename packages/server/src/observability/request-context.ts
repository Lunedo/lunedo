import { AsyncLocalStorage } from "node:async_hooks";
import type { Principal } from "../accounts/principal.js";

export interface RequestContext {
  requestId: string;
  clientIp?: string;
  userAgent?: string;
  actor?: Principal;
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
