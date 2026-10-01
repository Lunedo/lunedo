import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestContext {
  requestId: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** Runs `fn` with a request context that log lines and enqueued jobs pick up. */
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
