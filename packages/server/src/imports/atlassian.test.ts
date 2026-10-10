import { describe, expect, it } from "vitest";
import { AtlassianDirectory, atlassianSite } from "./atlassian.js";

const CREDENTIALS = { site: "example.atlassian.net", email: "alex@example.com", token: "secret-token-1" };

function recording(respond: (url: URL, init: RequestInit | undefined) => Response | Promise<Response>) {
  const calls: { url: URL; init: RequestInit | undefined }[] = [];
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    calls.push({ url, init });
    return respond(url, init);
  }) as typeof fetch;
  return { calls, fetcher };
}

describe("atlassianSite", () => {
  it.each([
    ["example.atlassian.net", "example.atlassian.net"],
    ["https://Example.atlassian.net/wiki/spaces/IT", "example.atlassian.net"],
    ["  team-1.atlassian.net  ", "team-1.atlassian.net"],
  ])("accepts %s", (input, host) => {
    expect(atlassianSite(input, "")).toBe(host);
  });

  it.each([
    "http://example.atlassian.net",
    "atlassian.net",
    "example.atlassian.net.evil.example",
    "example.atlassian.net:444",
    "https://user:pass@example.atlassian.net",
    "wiki.example.com",
    "127.0.0.1",
    "",
    "ftp://example.atlassian.net",
  ])("refuses %s", (input) => {
    expect(() => atlassianSite(input, "")).toThrow(expect.objectContaining({ code: "invalidAtlassianSite" }));
  });

  it("accepts hosts the instance administrator allowed, and only those", () => {
    expect(atlassianSite("https://wiki.example.com", "intranet.example.org, wiki.example.com")).toBe(
      "wiki.example.com",
    );
    expect(() => atlassianSite("other.example.com", "wiki.example.com")).toThrow();
    expect(() => atlassianSite("http://wiki.example.com", "wiki.example.com")).toThrow();
  });
});

describe("AtlassianDirectory", () => {
  it("asks only the given site, with basic authentication and without following redirects", async () => {
    const { calls, fetcher } = recording((url) =>
      url.pathname.endsWith("/current")
        ? Response.json({ accountId: "557058:me", type: "known" })
        : Response.json({
            results: url.searchParams.getAll("accountId").map((id) => ({
              accountId: id,
              displayName: `Name ${id}`,
              email: id === "a" ? "a@example.org" : "",
            })),
          }),
    );
    const directory = new AtlassianDirectory({ fetch: fetcher });
    await directory.check(CREDENTIALS);
    const ids = Array.from({ length: 150 }, (_, index) => (index === 0 ? "a" : `id-${index}`));
    const people = await directory.people(CREDENTIALS, ids);
    expect(people).toHaveLength(150);
    expect(people[0]).toEqual({ accountId: "a", name: "Name a", email: "a@example.org" });
    expect(people[1]?.email).toBeNull();
    expect(calls).toHaveLength(3);
    for (const call of calls) {
      expect(call.url.origin).toBe("https://example.atlassian.net");
      expect(call.init?.redirect).toBe("error");
      expect(new Headers(call.init?.headers).get("authorization")).toBe(
        `Basic ${Buffer.from("alex@example.com:secret-token-1").toString("base64")}`,
      );
    }
    expect(calls[1]?.url.searchParams.getAll("accountId")).toHaveLength(100);
  });

  it.each([
    [401, "atlassianUnauthorized"],
    [403, "atlassianUnauthorized"],
    [429, "atlassianRateLimited"],
    [500, "atlassianUnreachable"],
  ])("explains a %s answer without the token", async (status, code) => {
    const { fetcher } = recording(() => new Response("secret-token-1 rejected", { status }));
    const failure = await new AtlassianDirectory({ fetch: fetcher })
      .check(CREDENTIALS)
      .catch((error: unknown) => error);
    expect(failure).toMatchObject({ code });
    expect(String((failure as Error).message)).not.toContain("secret-token-1");
  });

  it("refuses anonymous access, oversized and malformed answers and network failures", async () => {
    const anonymous = recording(() => Response.json({ accountId: "x", type: "anonymous" }));
    await expect(
      new AtlassianDirectory({ fetch: anonymous.fetcher }).check(CREDENTIALS),
    ).rejects.toMatchObject({
      code: "atlassianUnauthorized",
    });
    const huge = recording(() => new Response("x".repeat(3 * 1024 * 1024)));
    await expect(
      new AtlassianDirectory({ fetch: huge.fetcher }).people(CREDENTIALS, ["a"]),
    ).rejects.toMatchObject({
      code: "atlassianUnreachable",
    });
    const malformed = recording(() => Response.json({ results: "nope" }));
    await expect(
      new AtlassianDirectory({ fetch: malformed.fetcher }).people(CREDENTIALS, ["a"]),
    ).rejects.toMatchObject({ code: "atlassianUnreachable" });
    const offline = recording(() => {
      throw new Error("connect ECONNREFUSED with secret-token-1");
    });
    const failure = await new AtlassianDirectory({ fetch: offline.fetcher })
      .check(CREDENTIALS)
      .catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: "atlassianUnreachable" });
    expect(JSON.stringify(failure)).not.toContain("secret-token-1");
  });
});
