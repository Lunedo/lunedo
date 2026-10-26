import { CLIENT_API_HEADER, CLIENT_API_LEVEL, CLIENT_BUILD_HEADER } from "@lunedo/shared";
import createClient, { type Middleware } from "openapi-fetch";
import { noteServerBuild } from "../app-update/app-update.js";
import type { components, paths } from "./generated/schema.js";

export type Schemas = components["schemas"];

export const CSRF_HEADER = "X-Lunedo-Request";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export const csrfMiddleware: Middleware = {
  onRequest({ request }) {
    if (!SAFE_METHODS.has(request.method)) request.headers.set(CSRF_HEADER, "1");
    return request;
  },
};

export const versionMiddleware: Middleware = {
  onRequest({ request }) {
    request.headers.set(CLIENT_API_HEADER, String(CLIENT_API_LEVEL));
    return request;
  },
  onResponse({ response }) {
    noteServerBuild(response.headers.get(CLIENT_BUILD_HEADER));
    return response;
  },
};

export function createApiClient(fetchImplementation?: typeof fetch) {
  const client = createClient<paths>({
    baseUrl: globalThis.location?.origin ?? "http://localhost",
    credentials: "same-origin",
    fetch: fetchImplementation ?? ((input: Request) => globalThis.fetch(input)),
  });
  client.use(csrfMiddleware);
  client.use(versionMiddleware);
  return client;
}

export type ApiClient = ReturnType<typeof createApiClient>;

export const api = createApiClient();
