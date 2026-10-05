import { afterEach, describe, expect, it } from "vitest";
import {
  type FakeGoogleDirectory,
  type FakeGraph,
  GOOGLE_IDS,
  GOOGLE_SCOPES,
  GOOGLE_SERVICE_ACCOUNT,
  GRAPH_IDS,
  GRAPH_OVERAGE_GROUP_COUNT,
  startFakeGoogleDirectory,
  startFakeGraph,
} from "./index.js";

function unsignedJwt(claims: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "RS256", typ: "JWT" })}.${encode(claims)}.signature`;
}

describe("Microsoft Graph fake", () => {
  let graph: FakeGraph | undefined;

  afterEach(async () => {
    await graph?.close();
    graph = undefined;
  });

  async function token(fake: FakeGraph, secret = fake.data.clientSecret): Promise<Response> {
    return fetch(fake.tokenEndpoint(), {
      method: "POST",
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: fake.data.clientId,
        client_secret: secret,
        scope: "https://graph.microsoft.com/.default",
      }),
    });
  }

  async function signedIn(fake: FakeGraph) {
    const { access_token } = (await (await token(fake)).json()) as { access_token: string };
    return (path: string, init: RequestInit = {}) =>
      fetch(new URL(path, fake.url), {
        ...init,
        headers: { authorization: `Bearer ${access_token}`, "content-type": "application/json" },
      });
  }

  it("issues application tokens only for the right client secret", async () => {
    graph = await startFakeGraph();
    expect((await token(graph, "wrong")).status).toBe(401);
    expect((await fetch(new URL("/v1.0/users", graph.url))).status).toBe(401);
    expect((await token(graph)).status).toBe(200);
  });

  it("pages through all groups of a person with too many groups for a token", async () => {
    graph = await startFakeGraph();
    const get = await signedIn(graph);
    const ids: string[] = [];
    let next: string | undefined =
      `/v1.0/users/${GRAPH_IDS.olga}/transitiveMemberOf/microsoft.graph.group?$top=100`;
    let pages = 0;
    while (next) {
      const body = (await (await get(next)).json()) as {
        value: { id: string }[];
        "@odata.nextLink"?: string;
      };
      ids.push(...body.value.map((group) => group.id));
      next = body["@odata.nextLink"];
      pages++;
    }
    expect(pages).toBe(3);
    expect(new Set(ids).size).toBe(GRAPH_OVERAGE_GROUP_COUNT);
    const objects = await get(`/v1.0/users/${GRAPH_IDS.olga}/getMemberObjects`, {
      method: "POST",
      body: JSON.stringify({ securityEnabledOnly: true }),
    });
    expect(((await objects.json()) as { value: string[] }).value).toHaveLength(GRAPH_OVERAGE_GROUP_COUNT);
  });

  it("resolves nested groups, disabled accounts and renamed groups by ID", async () => {
    graph = await startFakeGraph();
    const get = await signedIn(graph);
    const groups = (await (await get(`/v1.0/users/${GRAPH_IDS.alice}/transitiveMemberOf`)).json()) as {
      value: { id: string }[];
    };
    expect(groups.value.map((group) => group.id).sort()).toEqual(
      [GRAPH_IDS.platform, GRAPH_IDS.engineering, GRAPH_IDS.admins].sort(),
    );
    const frank = (await (await get(`/v1.0/users/${GRAPH_IDS.frank}?$select=accountEnabled`)).json()) as {
      accountEnabled: boolean;
    };
    expect(frank.accountEnabled).toBe(false);

    graph.renameGroup(GRAPH_IDS.engineering, "Engineering and Product");
    const renamed = (await (await get(`/v1.0/groups/${GRAPH_IDS.engineering}`)).json()) as {
      displayName: string;
    };
    expect(renamed.displayName).toBe("Engineering and Product");

    await fetch(new URL(`/_fake/users/${GRAPH_IDS.dave}/enabled`, graph.url), {
      method: "POST",
      body: JSON.stringify({ enabled: false }),
    });
    const dave = (await (await get(`/v1.0/users/${GRAPH_IDS.dave}`)).json()) as { accountEnabled: boolean };
    expect(dave.accountEnabled).toBe(false);
    graph.deleteUser(GRAPH_IDS.dave);
    expect((await get(`/v1.0/users/${GRAPH_IDS.dave}`)).status).toBe(404);
  });

  it("pages through users and searches groups", async () => {
    graph = await startFakeGraph();
    const get = await signedIn(graph);
    const first = (await (await get("/v1.0/users?$top=4&$select=displayName")).json()) as {
      value: Record<string, unknown>[];
      "@odata.nextLink"?: string;
    };
    expect(first.value).toHaveLength(4);
    expect(Object.keys(first.value[0] ?? {}).sort()).toEqual(["displayName", "id"]);
    const second = (await (await get(first["@odata.nextLink"] ?? "")).json()) as {
      value: unknown[];
      "@odata.nextLink"?: string;
    };
    expect(second.value).toHaveLength(2);
    expect(second["@odata.nextLink"]).toBeUndefined();
    const search = (await (await get(`/v1.0/groups?$search="displayName:platform"`)).json()) as {
      value: { id: string }[];
    };
    expect(search.value.map((group) => group.id)).toEqual([GRAPH_IDS.platform]);
  });
});

describe("Google Directory fake", () => {
  let google: FakeGoogleDirectory | undefined;

  afterEach(async () => {
    await google?.close();
    google = undefined;
  });

  async function signedIn(fake: FakeGoogleDirectory) {
    const response = await fetch(fake.tokenEndpoint(), {
      method: "POST",
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: unsignedJwt({
          iss: GOOGLE_SERVICE_ACCOUNT,
          sub: "admin@example.org",
          scope: GOOGLE_SCOPES.join(" "),
        }),
      }),
    });
    const { access_token } = (await response.json()) as { access_token: string };
    return (path: string) =>
      fetch(new URL(path, fake.url), { headers: { authorization: `Bearer ${access_token}` } });
  }

  it("issues tokens only to the configured service account", async () => {
    google = await startFakeGoogleDirectory();
    const refused = await fetch(google.tokenEndpoint(), {
      method: "POST",
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: unsignedJwt({ iss: "someone@else.example", scope: GOOGLE_SCOPES[0] }),
      }),
    });
    expect(refused.status).toBe(400);
    expect((await fetch(new URL("/admin/directory/v1/groups?domain=example.org", google.url))).status).toBe(
      401,
    );
  });

  it("pages through group members with derived membership and marks suspended people", async () => {
    google = await startFakeGoogleDirectory();
    const get = await signedIn(google);
    const members: { id: string; status: string }[] = [];
    let token: string | undefined = "";
    let pages = 0;
    do {
      const query = new URLSearchParams({ includeDerivedMembership: "true", maxResults: "2" });
      if (token) query.set("pageToken", token);
      const body = (await (
        await get(`/admin/directory/v1/groups/${GOOGLE_IDS.engineering}/members?${query}`)
      ).json()) as {
        members: { id: string; status: string }[];
        nextPageToken?: string;
      };
      members.push(...body.members);
      token = body.nextPageToken;
      pages++;
    } while (token);
    expect(pages).toBe(2);
    expect(members.map((member) => member.id).sort()).toEqual(
      [GOOGLE_IDS.alice, GOOGLE_IDS.bob, GOOGLE_IDS.dave, GOOGLE_IDS.sam].sort(),
    );
    expect(members.find((member) => member.id === GOOGLE_IDS.sam)?.status).toBe("SUSPENDED");
  });

  it("lists the groups of a person and follows changes", async () => {
    google = await startFakeGoogleDirectory();
    const get = await signedIn(google);
    const groups = (await (await get(`/admin/directory/v1/groups?userKey=alice@example.org`)).json()) as {
      groups: { id: string }[];
    };
    expect(groups.groups.map((group) => group.id).sort()).toEqual(
      [GOOGLE_IDS.admins, GOOGLE_IDS.platform].sort(),
    );
    google.setSuspended(GOOGLE_IDS.dave, true);
    const dave = (await (await get(`/admin/directory/v1/users/${GOOGLE_IDS.dave}`)).json()) as {
      suspended: boolean;
    };
    expect(dave.suspended).toBe(true);
    google.renameGroup(GOOGLE_IDS.admins, "Admins");
    const admins = (await (await get(`/admin/directory/v1/groups/${GOOGLE_IDS.admins}`)).json()) as {
      name: string;
    };
    expect(admins.name).toBe("Admins");
    expect((await get("/admin/directory/v1/groups?domain=other.example")).status).toBe(403);
  });
});
