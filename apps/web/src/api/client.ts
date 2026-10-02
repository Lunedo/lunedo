import createClient, { type Middleware } from "openapi-fetch";
import type { components, paths } from "./generated/schema.js";

export type Schemas = components["schemas"];

export const CSRF_HEADER = "X-Pagehall-Request";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export const csrfMiddleware: Middleware = {
  onRequest({ request }) {
    if (!SAFE_METHODS.has(request.method)) request.headers.set(CSRF_HEADER, "1");
    return request;
  },
};

export function createApiClient(fetchImplementation?: typeof fetch) {
  const client = createClient<paths>({
    baseUrl: globalThis.location?.origin ?? "http://localhost",
    credentials: "same-origin",
    fetch: fetchImplementation ?? ((input: Request) => globalThis.fetch(input)),
  });
  client.use(csrfMiddleware);
  return client;
}

export type ApiClient = ReturnType<typeof createApiClient>;

export const api = createApiClient();
