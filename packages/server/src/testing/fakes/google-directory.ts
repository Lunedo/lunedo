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

export interface FakeGoogleUser {
  id: string;
  primaryEmail: string;
  name: { fullName: string; givenName: string; familyName: string };
  suspended: boolean;
  archived: boolean;
}

export interface FakeGoogleGroup {
  id: string;
  email: string;
  name: string;
  description: string;
}

export interface FakeGoogleMember {
  id: string;
  email: string;
  type: "USER" | "GROUP";
}

export interface FakeGoogleData {
  domain: string;
  serviceAccountEmail: string;
  users: FakeGoogleUser[];
  groups: FakeGoogleGroup[];
  members: Record<string, FakeGoogleMember[]>;
}

export const GOOGLE_DOMAIN = "example.org";
export const GOOGLE_SERVICE_ACCOUNT = "pagehall-directory@pagehall-test.iam.gserviceaccount.com";
export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/admin.directory.group.readonly",
  "https://www.googleapis.com/auth/admin.directory.user.readonly",
] as const;

export const GOOGLE_IDS = {
  alice: "100000000000000000001",
  bob: "100000000000000000002",
  carol: "100000000000000000003",
  dave: "100000000000000000004",
  sam: "100000000000000000005",
  engineering: "03x00000000000001",
  platform: "03x00000000000002",
  admins: "03x00000000000003",
} as const;

export function defaultGoogleData(): FakeGoogleData {
  const user = (id: string, given: string, family: string, suspended = false): FakeGoogleUser => ({
    id,
    primaryEmail: `${given.toLowerCase()}@${GOOGLE_DOMAIN}`,
    name: { fullName: `${given} ${family}`, givenName: given, familyName: family },
    suspended,
    archived: false,
  });
  const group = (id: string, local: string, name: string): FakeGoogleGroup => ({
    id,
    email: `${local}@${GOOGLE_DOMAIN}`,
    name,
    description: "",
  });
  const member = (id: string, email: string, type: "USER" | "GROUP" = "USER"): FakeGoogleMember => ({
    id,
    email,
    type,
  });
  return {
    domain: GOOGLE_DOMAIN,
    serviceAccountEmail: GOOGLE_SERVICE_ACCOUNT,
    users: [
      user(GOOGLE_IDS.alice, "Alice", "Example"),
      user(GOOGLE_IDS.bob, "Bob", "Example"),
      user(GOOGLE_IDS.carol, "Carol", "Example"),
      user(GOOGLE_IDS.dave, "Dave", "Example"),
      user(GOOGLE_IDS.sam, "Sam", "Suspended", true),
    ],
    groups: [
      group(GOOGLE_IDS.engineering, "engineering", "Engineering"),
      group(GOOGLE_IDS.platform, "platform", "Platform"),
      group(GOOGLE_IDS.admins, "admins", "Administrators"),
    ],
    members: {
      [GOOGLE_IDS.engineering]: [
        member(GOOGLE_IDS.bob, `bob@${GOOGLE_DOMAIN}`),
        member(GOOGLE_IDS.dave, `dave@${GOOGLE_DOMAIN}`),
        member(GOOGLE_IDS.sam, `sam@${GOOGLE_DOMAIN}`),
        member(GOOGLE_IDS.platform, `platform@${GOOGLE_DOMAIN}`, "GROUP"),
      ],
      [GOOGLE_IDS.platform]: [member(GOOGLE_IDS.alice, `alice@${GOOGLE_DOMAIN}`)],
      [GOOGLE_IDS.admins]: [member(GOOGLE_IDS.alice, `alice@${GOOGLE_DOMAIN}`)],
    },
  };
}

export interface FakeGoogleDirectory extends RunningFake {
  readonly data: FakeGoogleData;
  readonly requests: string[];
  tokenEndpoint(): string;
  setSuspended(userId: string, suspended: boolean): void;
  addMember(groupId: string, member: FakeGoogleMember): void;
  removeMember(groupId: string, memberId: string): void;
  renameGroup(groupId: string, name: string): void;
  deleteUser(userId: string): void;
}

const MAX_GROUPS = 200;
const MAX_MEMBERS = 200;
const MAX_USERS = 500;

function googleError(code: number, message: string): FakeResponse {
  return { status: code, body: { error: { code, message, errors: [{ message, reason: "fake" }] } } };
}

export async function startFakeGoogleDirectory(
  options: { port?: number; data?: FakeGoogleData } = {},
): Promise<FakeGoogleDirectory> {
  const data = options.data ?? defaultGoogleData();
  const tokens = new Set<string>();
  const requests: string[] = [];

  const findUser = (key: string) =>
    data.users.find((user) => user.id === key || user.primaryEmail.toLowerCase() === key.toLowerCase());
  const findGroup = (key: string) =>
    data.groups.find((group) => group.id === key || group.email.toLowerCase() === key.toLowerCase());
  const directGroupsOf = (memberId: string) =>
    data.groups.filter((group) => (data.members[group.id] ?? []).some((member) => member.id === memberId));
  const derivedMembers = (groupId: string): FakeGoogleMember[] => {
    const found = new Map<string, FakeGoogleMember>();
    const visit = (id: string) => {
      for (const member of data.members[id] ?? []) {
        if (member.type === "GROUP") visit(member.id);
        else if (!found.has(member.id)) found.set(member.id, member);
      }
    };
    visit(groupId);
    return [...found.values()];
  };

  const paged = <T>(items: readonly T[], request: FakeRequest, max: number, key: string, kind: string) => {
    const size = Math.min(Number(request.url.searchParams.get("maxResults") ?? max), max);
    const offset = Number(request.url.searchParams.get("pageToken") ?? 0);
    const result = page(items, offset, size);
    return {
      status: 200,
      body: {
        kind,
        [key]: result.items,
        ...(result.next === null ? {} : { nextPageToken: String(result.next) }),
      },
    };
  };

  const memberView = (groupId: string, member: FakeGoogleMember) => ({
    kind: "admin#directory#member",
    id: member.id,
    email: member.email,
    role: "MEMBER",
    type: member.type,
    status: member.type === "USER" && findUser(member.id)?.suspended ? "SUSPENDED" : "ACTIVE",
    groupId,
  });

  const token = (request: FakeRequest): FakeResponse => {
    const form = formBody(request);
    if (form.get("grant_type") !== "urn:ietf:params:oauth:grant-type:jwt-bearer") {
      return { status: 400, body: { error: "unsupported_grant_type" } };
    }
    const claims = decodeJwtPayload(form.get("assertion") ?? "");
    if (!claims || claims.iss !== data.serviceAccountEmail) {
      return { status: 400, body: { error: "invalid_grant", error_description: "Invalid JWT signature." } };
    }
    const scopes = String(claims.scope ?? "").split(" ");
    if (!scopes.some((scope) => (GOOGLE_SCOPES as readonly string[]).includes(scope))) {
      return { status: 400, body: { error: "invalid_scope" } };
    }
    const issued = issueToken();
    tokens.add(issued);
    return { status: 200, body: { access_token: issued, token_type: "Bearer", expires_in: 3599 } };
  };

  const admin = (request: FakeRequest): FakeResponse => {
    const [, kind, id, member, memberId] = request.segments;
    if (kind === "state" && request.method === "GET") return { status: 200, body: data };
    if (kind === "users" && id && member === "suspended" && request.method === "POST") {
      fake.setSuspended(id, jsonBody<{ suspended: boolean }>(request).suspended);
      return { status: 204 };
    }
    if (kind === "users" && id && request.method === "DELETE") {
      fake.deleteUser(id);
      return { status: 204 };
    }
    if (kind === "groups" && id && member === "members" && request.method === "POST") {
      fake.addMember(id, jsonBody<FakeGoogleMember>(request));
      return { status: 204 };
    }
    if (kind === "groups" && id && member === "members" && memberId && request.method === "DELETE") {
      fake.removeMember(id, memberId);
      return { status: 204 };
    }
    if (kind === "groups" && id && !member && request.method === "PATCH") {
      fake.renameGroup(id, jsonBody<{ name: string }>(request).name);
      return { status: 204 };
    }
    return googleError(404, "Unknown fake administration request");
  };

  const directory = (request: FakeRequest): FakeResponse => {
    const access = bearer(request);
    if (!access || !tokens.has(access))
      return googleError(401, "Request had invalid authentication credentials.");
    const [, , , collection, key, relation] = request.segments;
    if (collection === "groups") {
      if (!key) {
        const userKey = request.url.searchParams.get("userKey");
        const domain = request.url.searchParams.get("domain");
        const customer = request.url.searchParams.get("customer");
        if (!userKey && !domain && !customer) return googleError(400, "Bad Request");
        if (domain && domain !== data.domain)
          return googleError(403, "Not Authorized to access this resource/api");
        let groups = data.groups;
        if (userKey) {
          const user = findUser(userKey);
          if (!user) return googleError(404, `Resource Not Found: ${userKey}`);
          groups = directGroupsOf(user.id);
        }
        return paged(
          groups.map((group) => ({ kind: "admin#directory#group", ...group })),
          request,
          MAX_GROUPS,
          "groups",
          "admin#directory#groups",
        );
      }
      const group = findGroup(key);
      if (!group) return googleError(404, `Resource Not Found: ${key}`);
      if (!relation) return { status: 200, body: { kind: "admin#directory#group", ...group } };
      if (relation === "members") {
        const members =
          request.url.searchParams.get("includeDerivedMembership") === "true"
            ? derivedMembers(group.id)
            : (data.members[group.id] ?? []);
        return paged(
          members.map((member) => memberView(group.id, member)),
          request,
          MAX_MEMBERS,
          "members",
          "admin#directory#members",
        );
      }
    }
    if (collection === "users") {
      if (!key) {
        const domain = request.url.searchParams.get("domain");
        if (!domain && !request.url.searchParams.get("customer")) return googleError(400, "Bad Request");
        if (domain && domain !== data.domain)
          return googleError(403, "Not Authorized to access this resource/api");
        return paged(
          data.users.map((user) => ({ kind: "admin#directory#user", ...user })),
          request,
          MAX_USERS,
          "users",
          "admin#directory#users",
        );
      }
      const user = findUser(key);
      if (!user) return googleError(404, "Resource Not Found: userKey");
      return { status: 200, body: { kind: "admin#directory#user", ...user } };
    }
    return googleError(404, `Unsupported request ${request.method} ${request.url.pathname}`);
  };

  const running = await serveFake((request) => {
    requests.push(`${request.method} ${request.url.pathname}${request.url.search}`);
    if (request.segments[0] === "_fake") return admin(request);
    if (request.segments[0] === "token" && request.method === "POST") return token(request);
    if (
      request.segments[0] === "admin" &&
      request.segments[1] === "directory" &&
      request.segments[2] === "v1"
    ) {
      return directory(request);
    }
    return googleError(404, "Not Found");
  }, options.port);

  const fake: FakeGoogleDirectory = {
    ...running,
    data,
    requests,
    tokenEndpoint: () => `${running.url}/token`,
    setSuspended(userId, suspended) {
      const user = findUser(userId);
      if (user) user.suspended = suspended;
    },
    addMember(groupId, member) {
      const members = data.members[groupId] ?? [];
      if (!members.some((existing) => existing.id === member.id))
        data.members[groupId] = [...members, member];
    },
    removeMember(groupId, memberId) {
      data.members[groupId] = (data.members[groupId] ?? []).filter((member) => member.id !== memberId);
    },
    renameGroup(groupId, name) {
      const group = findGroup(groupId);
      if (group) group.name = name;
    },
    deleteUser(userId) {
      data.users = data.users.filter((user) => user.id !== userId);
      for (const groupId of Object.keys(data.members)) fake.removeMember(groupId, userId);
    },
  };
  return fake;
}
