import {
  bearer,
  decodeJwtPayload,
  type FakeRequest,
  type FakeResponse,
  formBody,
  issueToken,
  jsonBody,
  page,
  type RunningFake,
  serveFake,
} from "./http.js";

export interface FakeGraphUser {
  id: string;
  displayName: string;
  mail: string | null;
  userPrincipalName: string;
  accountEnabled: boolean;
}

export interface FakeGraphGroup {
  id: string;
  displayName: string;
  securityEnabled: boolean;
}

export interface FakeGraphData {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  users: FakeGraphUser[];
  groups: FakeGraphGroup[];
  members: Record<string, string[]>;
  mailScope: string[] | null;
  secretExpired: boolean;
}

export interface FakeSentMail {
  mailbox: string;
  message: {
    subject: string;
    body: { contentType: string; content: string };
    toRecipients: { emailAddress: { address: string } }[];
    from?: { emailAddress: { address: string; name?: string } };
  };
  saveToSentItems: boolean;
  mime?: string;
}

export const GRAPH_TENANT_ID = "0f1e2d3c-4b5a-4968-8776-655443322110";
export const GRAPH_CLIENT_ID = "6c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f";
export const GRAPH_CLIENT_SECRET = "pagehall-graph-secret";
export const GRAPH_OVERAGE_GROUP_COUNT = 250;

export const GRAPH_IDS = {
  alice: "1a1a1a1a-0000-4000-8000-00000000a11c",
  bob: "2b2b2b2b-0000-4000-8000-000000000b0b",
  carol: "3c3c3c3c-0000-4000-8000-0000000ca401",
  dave: "4d4d4d4d-0000-4000-8000-00000000da7e",
  frank: "5f5f5f5f-0000-4000-8000-00000000f4a2",
  olga: "6a6a6a6a-0000-4000-8000-0000000001ca",
  engineering: "7e7e7e7e-0000-4000-8000-000000000e01",
  platform: "8f8f8f8f-0000-4000-8000-000000000e02",
  admins: "9a9a9a9a-0000-4000-8000-000000000ad1",
} as const;

function overageGroupId(index: number): string {
  return `aa000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

export function defaultGraphData(): FakeGraphData {
  const user = (id: string, name: string, login: string, enabled = true): FakeGraphUser => ({
    id,
    displayName: name,
    mail: `${login}@example.org`,
    userPrincipalName: `${login}@example.onmicrosoft.com`,
    accountEnabled: enabled,
  });
  const overageGroups = Array.from({ length: GRAPH_OVERAGE_GROUP_COUNT }, (_, index) => ({
    id: overageGroupId(index + 1),
    displayName: `Team ${String(index + 1).padStart(3, "0")}`,
    securityEnabled: true,
  }));
  return {
    tenantId: GRAPH_TENANT_ID,
    clientId: GRAPH_CLIENT_ID,
    clientSecret: GRAPH_CLIENT_SECRET,
    users: [
      user(GRAPH_IDS.alice, "Alice Example", "alice"),
      user(GRAPH_IDS.bob, "Bob Example", "bob"),
      { ...user(GRAPH_IDS.carol, "Carol Example", "carol"), mail: null },
      user(GRAPH_IDS.dave, "Dave Example", "dave"),
      user(GRAPH_IDS.frank, "Frank Disabled", "frank", false),
      user(GRAPH_IDS.olga, "Olga Overage", "olga"),
    ],
    groups: [
      { id: GRAPH_IDS.engineering, displayName: "Engineering", securityEnabled: true },
      { id: GRAPH_IDS.platform, displayName: "Platform", securityEnabled: true },
      { id: GRAPH_IDS.admins, displayName: "Administrators", securityEnabled: true },
      ...overageGroups,
    ],
    members: {
      [GRAPH_IDS.engineering]: [GRAPH_IDS.bob, GRAPH_IDS.dave, GRAPH_IDS.platform],
      [GRAPH_IDS.platform]: [GRAPH_IDS.alice],
      [GRAPH_IDS.admins]: [GRAPH_IDS.alice, GRAPH_IDS.frank],
      ...Object.fromEntries(overageGroups.map((group) => [group.id, [GRAPH_IDS.olga]])),
    },
    mailScope: null,
    secretExpired: false,
  };
}

export interface FakeGraph extends RunningFake {
  readonly data: FakeGraphData;
  readonly requests: string[];
  readonly sentMail: FakeSentMail[];
  tokenEndpoint(): string;
  setAccountEnabled(userId: string, enabled: boolean): void;
  addMember(groupId: string, memberId: string): void;
  removeMember(groupId: string, memberId: string): void;
  renameGroup(groupId: string, displayName: string): void;
  deleteUser(userId: string): void;
  hold(): { reached: Promise<void>; release(): void };
}

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 999;

function graphError(status: number, code: string, message: string): FakeResponse {
  return { status, body: { error: { code, message } } };
}

export async function startFakeGraph(
  options: { port?: number; data?: FakeGraphData } = {},
): Promise<FakeGraph> {
  const data = options.data ?? defaultGraphData();
  const tokens = new Set<string>();
  const requests: string[] = [];
  const sentMail: FakeSentMail[] = [];
  let baseUrl = "";
  let gate: { reached: () => void; released: Promise<void> } | null = null;

  const findUser = (key: string) =>
    data.users.find(
      (user) =>
        user.id === key ||
        user.userPrincipalName.toLowerCase() === key.toLowerCase() ||
        user.mail?.toLowerCase() === key.toLowerCase(),
    );
  const findGroup = (id: string) => data.groups.find((group) => group.id === id);
  const directGroupsOf = (memberId: string) =>
    data.groups.filter((group) => (data.members[group.id] ?? []).includes(memberId));
  const transitiveGroupsOf = (memberId: string) => {
    const found = new Map<string, FakeGraphGroup>();
    const visit = (id: string) => {
      for (const group of directGroupsOf(id)) {
        if (found.has(group.id)) continue;
        found.set(group.id, group);
        visit(group.id);
      }
    };
    visit(memberId);
    return [...found.values()];
  };
  const transitiveMembersOf = (groupId: string) => {
    const found = new Map<string, string>();
    const visit = (id: string) => {
      for (const memberId of data.members[id] ?? []) {
        if (found.has(memberId)) continue;
        found.set(memberId, memberId);
        if (findGroup(memberId)) visit(memberId);
      }
    };
    visit(groupId);
    return [...found.keys()];
  };

  const asObject = (id: string): Record<string, unknown> | null => {
    const user = data.users.find((candidate) => candidate.id === id);
    if (user) return { "@odata.type": "#microsoft.graph.user", ...user };
    const group = findGroup(id);
    return group ? { "@odata.type": "#microsoft.graph.group", ...group } : null;
  };

  const select = (item: Record<string, unknown>, request: FakeRequest) => {
    const fields = request.url.searchParams.get("$select");
    if (!fields) return item;
    const wanted = new Set(["@odata.type", "id", ...fields.split(",").map((field) => field.trim())]);
    return Object.fromEntries(Object.entries(item).filter(([key]) => wanted.has(key)));
  };

  const list = (items: Record<string, unknown>[], request: FakeRequest): FakeResponse => {
    const top = Math.min(Number(request.url.searchParams.get("$top") ?? DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
    const offset = Number(request.url.searchParams.get("$skiptoken") ?? 0);
    const result = page(items, offset, top);
    const body: Record<string, unknown> = { value: result.items.map((item) => select(item, request)) };
    if (result.next !== null) {
      const next = new URL(request.url.pathname + request.url.search, baseUrl);
      next.searchParams.set("$skiptoken", String(result.next));
      body["@odata.nextLink"] = next.toString();
    }
    return { status: 200, body };
  };

  const filterGroups = (request: FakeRequest): FakeGraphGroup[] => {
    const search = request.url.searchParams.get("$search");
    const filter = request.url.searchParams.get("$filter");
    let groups = data.groups;
    const term =
      search?.match(/^"displayName:(.*)"$/)?.[1] ?? filter?.match(/^startswith\(displayName,'(.*)'\)$/)?.[1];
    if (term !== undefined) {
      const lower = term.toLowerCase();
      groups = groups.filter((group) =>
        search
          ? group.displayName.toLowerCase().includes(lower)
          : group.displayName.toLowerCase().startsWith(lower),
      );
    }
    return groups;
  };

  const token = (request: FakeRequest): FakeResponse => {
    const form = formBody(request);
    if (request.segments[0] !== data.tenantId) return graphError(400, "invalid_request", "Unknown tenant");
    if (form.get("grant_type") !== "client_credentials") {
      return { status: 400, body: { error: "unsupported_grant_type" } };
    }
    const assertion = form.get("client_assertion");
    const authenticated = assertion
      ? form.get("client_assertion_type") === "urn:ietf:params:oauth:client-assertion-type:jwt-bearer" &&
        decodeJwtPayload(assertion)?.iss === data.clientId &&
        decodeJwtPayload(assertion)?.sub === data.clientId
      : form.get("client_id") === data.clientId && form.get("client_secret") === data.clientSecret;
    if (authenticated && data.secretExpired && !assertion) {
      return {
        status: 401,
        body: {
          error: "invalid_client",
          error_description: `AADSTS7000222: The provided client secret keys for app '${data.clientId}' are expired.`,
        },
      };
    }
    if (!authenticated) {
      return {
        status: 401,
        body: {
          error: "invalid_client",
          error_description: "AADSTS7000215: Invalid client secret provided.",
        },
      };
    }
    if (!form.get("scope")?.endsWith("/.default")) {
      return { status: 400, body: { error: "invalid_scope" } };
    }
    const issued = issueToken();
    tokens.add(issued);
    return { status: 200, body: { token_type: "Bearer", expires_in: 3599, access_token: issued } };
  };

  const admin = (request: FakeRequest): FakeResponse => {
    const [, kind, id, member, memberId] = request.segments;
    if (kind === "state" && request.method === "GET") return { status: 200, body: data };
    if (kind === "users" && id && member === "enabled" && request.method === "POST") {
      fake.setAccountEnabled(id, jsonBody<{ enabled: boolean }>(request).enabled);
      return { status: 204 };
    }
    if (kind === "users" && id && request.method === "DELETE") {
      fake.deleteUser(id);
      return { status: 204 };
    }
    if (kind === "groups" && id && member === "members" && request.method === "POST") {
      fake.addMember(id, jsonBody<{ id: string }>(request).id);
      return { status: 204 };
    }
    if (kind === "groups" && id && member === "members" && memberId && request.method === "DELETE") {
      fake.removeMember(id, memberId);
      return { status: 204 };
    }
    if (kind === "groups" && id && !member && request.method === "PATCH") {
      fake.renameGroup(id, jsonBody<{ displayName: string }>(request).displayName);
      return { status: 204 };
    }
    return graphError(404, "Request_ResourceNotFound", "Unknown fake administration request");
  };

  const graph = (request: FakeRequest): FakeResponse => {
    const access = bearer(request);
    if (!access || !tokens.has(access)) {
      return graphError(401, "InvalidAuthenticationToken", "Access token is empty or invalid.");
    }
    const [, collection, id, relation, cast] = request.segments;
    if (cast && cast !== "microsoft.graph.group") return graphError(400, "BadRequest", "Unsupported cast");
    if (collection === "users") {
      if (!id) return list(data.users as unknown as Record<string, unknown>[], request);
      const user = findUser(id);
      if (!user && relation === "sendMail") {
        return graphError(404, "ErrorInvalidUser", `The requested user '${id}' is invalid.`);
      }
      if (!user) return graphError(404, "Request_ResourceNotFound", `Resource '${id}' does not exist.`);
      if (!relation) return { status: 200, body: select({ ...user }, request) };
      if (relation === "sendMail" && request.method === "POST") {
        const inScope =
          data.mailScope === null ||
          data.mailScope.some((mailbox) => mailbox.toLowerCase() === (user.mail ?? "").toLowerCase());
        if (!inScope) {
          return graphError(
            403,
            "ErrorAccessDenied",
            "Access to OData is disabled: [RAOP] : Blocked by tenant configured AppOnly AccessPolicy settings.",
          );
        }
        const mailbox = user.mail ?? user.userPrincipalName;
        if (request.headers["content-type"]?.startsWith("text/plain")) {
          const mime = Buffer.from(request.body, "base64").toString("utf8");
          if (!mime.includes(String.fromCharCode(13, 10, 13, 10))) {
            return graphError(
              400,
              "ErrorMimeContentInvalidBase64String",
              "Invalid base64 string for MIME content.",
            );
          }
          sentMail.push({
            mailbox,
            mime,
            saveToSentItems: true,
            message: { subject: "", body: { contentType: "MIME", content: mime }, toRecipients: [] },
          });
          return { status: 202 };
        }
        sentMail.push({ mailbox, ...jsonBody<Omit<FakeSentMail, "mailbox">>(request) });
        return { status: 202 };
      }
      if (relation === "memberOf" || relation === "transitiveMemberOf") {
        const groups = relation === "memberOf" ? directGroupsOf(user.id) : transitiveGroupsOf(user.id);
        return list(
          groups.map((group) => ({ "@odata.type": "#microsoft.graph.group", ...group })),
          request,
        );
      }
      if ((relation === "getMemberGroups" || relation === "getMemberObjects") && request.method === "POST") {
        const securityOnly =
          jsonBody<{ securityEnabledOnly?: boolean }>(request).securityEnabledOnly === true;
        const groups = transitiveGroupsOf(user.id).filter((group) => !securityOnly || group.securityEnabled);
        return { status: 200, body: { value: groups.map((group) => group.id) } };
      }
    }
    if (collection === "directoryObjects" && id === "getByIds" && request.method === "POST") {
      const ids = jsonBody<{ ids: string[] }>(request).ids;
      const groups = ids.flatMap((groupId) => {
        const group = findGroup(groupId);
        return group ? [{ "@odata.type": "#microsoft.graph.group", ...group }] : [];
      });
      return { status: 200, body: { value: groups.map((group) => select(group, request)) } };
    }
    if (collection === "groups") {
      if (!id) return list(filterGroups(request) as unknown as Record<string, unknown>[], request);
      const group = findGroup(id);
      if (!group) return graphError(404, "Request_ResourceNotFound", `Resource '${id}' does not exist.`);
      if (!relation) return { status: 200, body: select({ ...group }, request) };
      if (relation === "members" || relation === "transitiveMembers") {
        const ids = relation === "members" ? (data.members[group.id] ?? []) : transitiveMembersOf(group.id);
        return list(
          ids.map(asObject).filter((item): item is Record<string, unknown> => item !== null),
          request,
        );
      }
    }
    return graphError(400, "BadRequest", `Unsupported request ${request.method} ${request.url.pathname}`);
  };

  const running = await serveFake((request) => {
    requests.push(`${request.method} ${request.url.pathname}${request.url.search}`);
    if (request.segments[0] === "_fake") return admin(request);
    if (
      request.segments[1] === "oauth2" &&
      request.segments[2] === "v2.0" &&
      request.segments[3] === "token"
    ) {
      return token(request);
    }
    if (request.segments[0] === "v1.0") {
      const held = gate;
      if (held) {
        held.reached();
        return held.released.then(() => graph(request));
      }
      return graph(request);
    }
    return graphError(404, "NotFound", "Unknown endpoint");
  }, options.port);
  baseUrl = running.url;

  const fake: FakeGraph = {
    ...running,
    data,
    requests,
    sentMail,
    tokenEndpoint: () => `${running.url}/${data.tenantId}/oauth2/v2.0/token`,
    setAccountEnabled(userId, enabled) {
      const user = data.users.find((candidate) => candidate.id === userId);
      if (user) user.accountEnabled = enabled;
    },
    addMember(groupId, memberId) {
      const members = data.members[groupId] ?? [];
      if (!members.includes(memberId)) data.members[groupId] = [...members, memberId];
    },
    removeMember(groupId, memberId) {
      data.members[groupId] = (data.members[groupId] ?? []).filter((id) => id !== memberId);
    },
    renameGroup(groupId, displayName) {
      const group = findGroup(groupId);
      if (group) group.displayName = displayName;
    },
    deleteUser(userId) {
      data.users = data.users.filter((user) => user.id !== userId);
      for (const groupId of Object.keys(data.members)) fake.removeMember(groupId, userId);
    },
    hold() {
      let reached = () => {};
      let release = () => {};
      const reachedPromise = new Promise<void>((resolve) => {
        reached = resolve;
      });
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      gate = { reached, released };
      return {
        reached: reachedPromise,
        release: () => {
          gate = null;
          release();
        },
      };
    },
  };
  return fake;
}
