import { createHash } from "node:crypto";
import {
  ENTRA_AUTHORITY,
  GOOGLE_DIRECTORY,
  GOOGLE_TOKEN_URL,
  googleServiceAccountKeySchema,
  isUuid,
  MICROSOFT_GRAPH,
  type OidcConfig,
} from "@pagehall/shared";
import { importPKCS8, SignJWT } from "jose";
import { type ProviderCredential, type ProviderGroup, ProviderResponseError } from "./adapter.js";
import { requestGraphToken } from "./graph-token.js";

const REQUEST_TIMEOUT_MS = 10_000;
const GRAPH_PAGE_SIZE = 999;
const GOOGLE_PAGE_SIZE = 200;
const GOOGLE_GROUP_SCOPE = "https://www.googleapis.com/auth/admin.directory.group.readonly";
const GOOGLE_USER_SCOPE = "https://www.googleapis.com/auth/admin.directory.user.readonly";

export function googleReadsUsers(config: GoogleConfig): boolean {
  return (
    config.directory !== null && (config.directory.method === "delegation" || config.directory.readUsers)
  );
}

export interface GraphConfig {
  preset: "entraId";
  authority: string;
  tenantId: string;
  clientId: string;
  graphUrl: string;
  emailSource: "email" | "userPrincipalName" | "graphMail";
}

type EntraConfig = GraphConfig;
type GoogleConfig = Extract<OidcConfig, { preset: "google" }>;

export interface DirectoryAccount {
  enabled: boolean;
  email: string | null;
  signInName: string | null;
  displayName: string | null;
}

export interface DirectoryGroup extends ProviderGroup {
  members: number | null;
}

interface CachedToken {
  token: string;
  expiresAt: number;
}

const GRAPH_ENDPOINTS: Readonly<Record<string, readonly string[]>> = {
  [ENTRA_AUTHORITY]: [MICROSOFT_GRAPH],
  "https://login.microsoftonline.us": ["https://graph.microsoft.us", "https://dod-graph.microsoft.us"],
  "https://login.partner.microsoftonline.cn": ["https://microsoftgraph.chinacloudapi.cn"],
};

function withoutTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

export function foreignGraphEndpoint(authority: string, graphUrl: string): boolean {
  const allowed = GRAPH_ENDPOINTS[withoutTrailingSlash(authority)] ?? [];
  return !allowed.includes(withoutTrailingSlash(graphUrl));
}

export function foreignDirectoryEndpoint(config: OidcConfig | GraphConfig): string | null {
  if (config.preset === "entraId") {
    return foreignGraphEndpoint(config.authority, config.graphUrl) ? "graphUrl" : null;
  }
  if (config.preset === "google" && config.directory) {
    if (withoutTrailingSlash(config.directory.url) !== GOOGLE_DIRECTORY) return "directory.url";
    if (config.directory.tokenUrl !== GOOGLE_TOKEN_URL) return "directory.tokenUrl";
  }
  return null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

export class DirectoryClients {
  readonly #fetch: typeof fetch;
  readonly #allowInsecure: boolean;
  readonly #tokens = new Map<string, CachedToken>();

  constructor(options: { allowInsecure: boolean; fetch?: typeof fetch }) {
    this.#fetch = options.fetch ?? fetch;
    this.#allowInsecure = options.allowInsecure;
  }

  #checkTransport(url: string): void {
    if (new URL(url).protocol !== "https:" && !this.#allowInsecure) {
      throw new ProviderResponseError("Directories must be reached through HTTPS");
    }
  }

  #checkEndpoints(config: OidcConfig | GraphConfig): void {
    if (this.#allowInsecure) return;
    if (foreignDirectoryEndpoint(config)) {
      throw new ProviderResponseError("The directory endpoint is not one of the provider's own endpoints");
    }
  }

  async #request(url: string, init: RequestInit): Promise<Response> {
    this.#checkTransport(url);
    try {
      return await this.#fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch (error) {
      throw new ProviderResponseError(`The directory could not be reached: ${(error as Error).message}`);
    }
  }

  async #cachedToken(key: string, issue: () => Promise<{ token: string; expiresIn: number }>) {
    const cached = this.#tokens.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.token;
    const issued = await issue();
    this.#tokens.set(key, { token: issued.token, expiresAt: Date.now() + (issued.expiresIn - 60) * 1000 });
    return issued.token;
  }

  async #graphToken(
    providerId: string,
    config: EntraConfig,
    credentials: readonly ProviderCredential[],
  ): Promise<string> {
    this.#checkEndpoints(config);
    const key = JSON.stringify([
      "graph",
      providerId,
      config.authority,
      config.tenantId,
      config.clientId,
      config.graphUrl,
      credentials.map((credential) => credential.id),
    ]);
    return this.#cachedToken(key, async () => {
      let lastStatus = 0;
      for (const credential of credentials) {
        const result = await requestGraphToken({
          request: (url, init) => this.#request(url, init),
          authority: config.authority,
          tenantId: config.tenantId,
          clientId: config.clientId,
          graphUrl: config.graphUrl,
          credential,
        });
        if (result.ok) return { token: result.token, expiresIn: result.expiresIn };
        lastStatus = result.status;
        if (result.status !== 400 && result.status !== 401) break;
      }
      throw new ProviderResponseError(`Microsoft Graph refused the credentials (${lastStatus})`);
    });
  }

  async #graphGet(
    providerId: string,
    config: EntraConfig,
    credentials: readonly ProviderCredential[],
    url: string,
    headers: Record<string, string> = {},
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    if (new URL(url).origin !== new URL(config.graphUrl).origin) {
      throw new ProviderResponseError("Microsoft Graph pointed to another host");
    }
    const token = await this.#graphToken(providerId, config, credentials);
    const response = await this.#request(url, { headers: { authorization: `Bearer ${token}`, ...headers } });
    if (response.status === 404) return { status: 404, body: {} };
    if (!response.ok) throw new ProviderResponseError(`Microsoft Graph answered ${response.status}`);
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  }

  async #graphPages(
    providerId: string,
    config: EntraConfig,
    credentials: readonly ProviderCredential[],
    first: string,
    headers: Record<string, string> = {},
  ): Promise<Record<string, unknown>[] | null> {
    const items: Record<string, unknown>[] = [];
    let next: string | null = first;
    while (next) {
      const page = await this.#graphGet(providerId, config, credentials, next, headers);
      if (page.status === 404) return null;
      const value = page.body.value;
      if (Array.isArray(value)) items.push(...(value as Record<string, unknown>[]));
      next = stringValue(page.body["@odata.nextLink"]);
      if (next && new URL(next).origin !== new URL(config.graphUrl).origin) {
        throw new ProviderResponseError("Microsoft Graph returned a link to another host");
      }
    }
    return items;
  }

  async graphAccount(
    providerId: string,
    config: EntraConfig,
    credentials: readonly ProviderCredential[],
    objectId: string,
  ): Promise<DirectoryAccount | null> {
    const select = "accountEnabled,mail,userPrincipalName,displayName";
    const result = await this.#graphGet(
      providerId,
      config,
      credentials,
      `${config.graphUrl}/v1.0/users/${encodeURIComponent(objectId)}?$select=${select}`,
    );
    if (result.status === 404) return null;
    const upn = stringValue(result.body.userPrincipalName);
    const mail = stringValue(result.body.mail);
    return {
      enabled: result.body.accountEnabled !== false,
      email:
        config.emailSource === "graphMail"
          ? mail
          : config.emailSource === "userPrincipalName"
            ? upn
            : (mail ?? upn),
      signInName: upn,
      displayName: stringValue(result.body.displayName),
    };
  }

  async graphGroupsOf(
    providerId: string,
    config: EntraConfig,
    credentials: readonly ProviderCredential[],
    objectId: string,
  ): Promise<ProviderGroup[] | null> {
    const items = await this.#graphPages(
      providerId,
      config,
      credentials,
      `${config.graphUrl}/v1.0/users/${encodeURIComponent(objectId)}/transitiveMemberOf/microsoft.graph.group?$select=id,displayName&$top=${GRAPH_PAGE_SIZE}`,
    );
    if (!items) return null;
    return items.flatMap((item) => {
      const id = stringValue(item.id);
      return id ? [{ id, name: stringValue(item.displayName) }] : [];
    });
  }

  async graphGroup(
    providerId: string,
    config: EntraConfig,
    credentials: readonly ProviderCredential[],
    groupId: string,
  ): Promise<ProviderGroup | null> {
    const id = groupId.toLowerCase();
    if (!isUuid(id)) return null;
    const result = await this.#graphGet(
      providerId,
      config,
      credentials,
      `${config.graphUrl}/v1.0/groups/${id}?$select=id,displayName`,
    );
    if (result.status === 404) return null;
    return {
      id: stringValue(result.body.id)?.toLowerCase() ?? id,
      name: stringValue(result.body.displayName),
    };
  }

  async graphSearchGroups(
    providerId: string,
    config: EntraConfig,
    credentials: readonly ProviderCredential[],
    query: string,
  ): Promise<DirectoryGroup[]> {
    const escaped = query.replaceAll('"', "").replaceAll("\\", "");
    const items = await this.#graphPages(
      providerId,
      config,
      credentials,
      `${config.graphUrl}/v1.0/groups?$search=${encodeURIComponent(`"displayName:${escaped}"`)}&$select=id,displayName&$top=25`,
      { consistencylevel: "eventual" },
    );
    return (items ?? []).slice(0, 25).flatMap((item) => {
      const id = stringValue(item.id);
      return id ? [{ id, name: stringValue(item.displayName), members: null }] : [];
    });
  }

  async graphMemberCount(
    providerId: string,
    config: EntraConfig,
    credentials: readonly ProviderCredential[],
    groupId: string,
  ): Promise<number | null> {
    const items = await this.#graphPages(
      providerId,
      config,
      credentials,
      `${config.graphUrl}/v1.0/groups/${encodeURIComponent(groupId)}/transitiveMembers?$select=id&$top=${GRAPH_PAGE_SIZE}`,
    );
    if (!items) return null;
    return items.filter((item) => item["@odata.type"] !== "#microsoft.graph.group").length;
  }

  async #googleToken(providerId: string, config: GoogleConfig, keyJson: string): Promise<string> {
    const directory = config.directory;
    if (!directory) throw new ProviderResponseError("The Google directory is not configured");
    this.#checkEndpoints(config);
    const scopes = [GOOGLE_GROUP_SCOPE, ...(googleReadsUsers(config) ? [GOOGLE_USER_SCOPE] : [])];
    const subject = directory.method === "delegation" ? directory.adminEmail : null;
    const key = JSON.stringify([
      "google",
      providerId,
      directory.method,
      subject,
      scopes,
      directory.url,
      directory.tokenUrl,
      createHash("sha256").update(keyJson).digest("hex"),
    ]);
    return this.#cachedToken(key, async () => {
      let key: { client_email: string; private_key: string };
      try {
        key = googleServiceAccountKeySchema.parse(JSON.parse(keyJson));
      } catch {
        throw new ProviderResponseError("The service account key is not valid");
      }
      const signing = await importPKCS8(key.private_key, "RS256");
      const unsigned = new SignJWT({ scope: scopes.join(" ") })
        .setProtectedHeader({ alg: "RS256", typ: "JWT" })
        .setIssuer(key.client_email)
        .setAudience(directory.tokenUrl)
        .setIssuedAt()
        .setExpirationTime("1h");
      const assertion = await (subject ? unsigned.setSubject(subject) : unsigned).sign(signing);
      const response = await this.#request(directory.tokenUrl, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
          assertion,
        }),
      });
      if (!response.ok) {
        throw new ProviderResponseError(`Google refused the service account (${response.status})`);
      }
      const body = (await response.json()) as { access_token?: unknown; expires_in?: unknown };
      const token = stringValue(body.access_token);
      if (!token) throw new ProviderResponseError("Google issued no access token");
      return { token, expiresIn: typeof body.expires_in === "number" ? body.expires_in : 3600 };
    });
  }

  async #googleGet(
    providerId: string,
    config: GoogleConfig,
    keyJson: string,
    path: string,
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const directory = config.directory;
    if (!directory) throw new ProviderResponseError("The Google directory is not configured");
    const token = await this.#googleToken(providerId, config, keyJson);
    const response = await this.#request(`${directory.url}/admin/directory/v1/${path}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (response.status === 404) return { status: 404, body: {} };
    if (!response.ok) throw new ProviderResponseError(`The Google directory answered ${response.status}`);
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  }

  async #googlePages(
    providerId: string,
    config: GoogleConfig,
    keyJson: string,
    path: string,
    field: string,
  ): Promise<Record<string, unknown>[] | null> {
    const items: Record<string, unknown>[] = [];
    let pageToken: string | null = null;
    do {
      const separator = path.includes("?") ? "&" : "?";
      const page = await this.#googleGet(
        providerId,
        config,
        keyJson,
        `${path}${separator}maxResults=${GOOGLE_PAGE_SIZE}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`,
      );
      if (page.status === 404) return null;
      const value = page.body[field];
      if (Array.isArray(value)) items.push(...(value as Record<string, unknown>[]));
      pageToken = stringValue(page.body.nextPageToken);
    } while (pageToken);
    return items;
  }

  async googleAccount(
    providerId: string,
    config: GoogleConfig,
    keyJson: string,
    userId: string,
  ): Promise<DirectoryAccount | null> {
    const result = await this.#googleGet(providerId, config, keyJson, `users/${encodeURIComponent(userId)}`);
    if (result.status === 404) return null;
    const name = result.body.name as { fullName?: unknown } | undefined;
    const email = stringValue(result.body.primaryEmail);
    return {
      enabled: result.body.suspended !== true && result.body.archived !== true,
      email,
      signInName: email,
      displayName: stringValue(name?.fullName),
    };
  }

  async googleGroupsOf(
    providerId: string,
    config: GoogleConfig,
    keyJson: string,
    userId: string,
  ): Promise<ProviderGroup[] | null> {
    const items = await this.#googlePages(
      providerId,
      config,
      keyJson,
      `groups?userKey=${encodeURIComponent(userId)}`,
      "groups",
    );
    if (!items) return null;
    return items.flatMap((item) => {
      const id = stringValue(item.id);
      return id ? [{ id, name: stringValue(item.name) ?? stringValue(item.email) }] : [];
    });
  }

  async googleGroup(
    providerId: string,
    config: GoogleConfig,
    keyJson: string,
    groupId: string,
  ): Promise<ProviderGroup | null> {
    const result = await this.#googleGet(
      providerId,
      config,
      keyJson,
      `groups/${encodeURIComponent(groupId)}`,
    );
    if (result.status === 404) return null;
    return {
      id: stringValue(result.body.id) ?? groupId,
      name: stringValue(result.body.name) ?? stringValue(result.body.email),
    };
  }

  async googleSearchGroups(
    providerId: string,
    config: GoogleConfig,
    keyJson: string,
    query: string,
  ): Promise<DirectoryGroup[]> {
    const items = await this.#googlePages(
      providerId,
      config,
      keyJson,
      `groups?customer=my_customer`,
      "groups",
    );
    const needle = query.toLowerCase();
    return (items ?? [])
      .filter((item) =>
        [item.name, item.email].some((value) => stringValue(value)?.toLowerCase().includes(needle)),
      )
      .slice(0, 25)
      .flatMap((item) => {
        const id = stringValue(item.id);
        const members = Number(item.directMembersCount);
        return id
          ? [
              {
                id,
                name: stringValue(item.name) ?? stringValue(item.email),
                members: Number.isFinite(members) ? members : null,
              },
            ]
          : [];
      });
  }

  async googleMemberCount(
    providerId: string,
    config: GoogleConfig,
    keyJson: string,
    groupId: string,
  ): Promise<number | null> {
    const items = await this.#googlePages(
      providerId,
      config,
      keyJson,
      `groups/${encodeURIComponent(groupId)}/members?includeDerivedMembership=true`,
      "members",
    );
    if (!items) return null;
    return items.filter((item) => item.type !== "GROUP").length;
  }
}
