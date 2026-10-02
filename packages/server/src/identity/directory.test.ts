import { randomUUID } from "node:crypto";
import { oidcConfigSchema } from "@pagehall/shared";
import { describe, expect, it } from "vitest";
import { ProviderResponseError } from "./adapter.js";
import { DirectoryClients } from "./directory.js";

function entra(graphUrl: string) {
  const config = oidcConfigSchema.parse({
    preset: "entraId",
    tenantId: "0f1e2d3c-4b5a-4968-8776-655443322110",
    clientId: "client",
    graphUrl,
  });
  if (config.preset !== "entraId") throw new Error("Entra ID expected");
  return config;
}

function google(url: string, tokenUrl: string) {
  const config = oidcConfigSchema.parse({
    preset: "google",
    clientId: "client",
    domains: ["example.org"],
    directory: { adminEmail: "admin@example.org", url, tokenUrl },
  });
  if (config.preset !== "google") throw new Error("Google expected");
  return config;
}

function recordingFetch() {
  const requests: { url: string; authorization: string | null }[] = [];
  let issued = 0;
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    requests.push({ url, authorization: headers.get("authorization") });
    if (url.endsWith("/oauth2/v2.0/token")) {
      issued += 1;
      return Response.json({ access_token: `token-${issued}`, expires_in: 3600 });
    }
    return Response.json({ id: "group", displayName: "Engineering" });
  };
  return { requests, fetch: fetch as typeof globalThis.fetch };
}

const credentials = [{ id: randomUUID(), kind: "clientSecret" as const, secret: "secret", keyId: null }];

describe("directory clients", () => {
  it("never sends a cached token to a changed directory address", async () => {
    const recorded = recordingFetch();
    const clients = new DirectoryClients({ allowInsecure: true, fetch: recorded.fetch });
    const providerId = randomUUID();
    await clients.graphGroup(providerId, entra("https://graph.one.example"), credentials, "group");
    await clients.graphGroup(providerId, entra("https://graph.two.example"), credentials, "group");
    const reads = recorded.requests.filter((request) => request.url.includes("/v1.0/groups/"));
    expect(reads.map((read) => [new URL(read.url).host, read.authorization])).toEqual([
      ["graph.one.example", "Bearer token-1"],
      ["graph.two.example", "Bearer token-2"],
    ]);
  });

  it("refuses directory addresses outside the provider's own hosts", async () => {
    const recorded = recordingFetch();
    const clients = new DirectoryClients({ allowInsecure: false, fetch: recorded.fetch });
    await expect(
      clients.graphGroup(randomUUID(), entra("https://collector.example"), credentials, "group"),
    ).rejects.toThrow(ProviderResponseError);
    await expect(
      clients.googleGroup(
        randomUUID(),
        google("https://collector.example", "https://oauth2.googleapis.com/token"),
        "{}",
        "group",
      ),
    ).rejects.toThrow(ProviderResponseError);
    await expect(
      clients.googleGroup(
        randomUUID(),
        google("https://admin.googleapis.com", "https://collector.example/token"),
        "{}",
        "group",
      ),
    ).rejects.toThrow(ProviderResponseError);
    expect(recorded.requests).toEqual([]);
  });
});
