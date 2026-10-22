import { z } from "zod";
import { defineSetting } from "../settings/definition.js";
import { ImportError } from "./errors.js";

const HOST_PATTERN =
  /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const ATLASSIAN_SUFFIX = ".atlassian.net";
const TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const BULK_SIZE = 100;
const MAX_HOSTS = 50;

export const atlassianHostsSetting = defineSetting({
  key: "imports.atlassianHosts",
  schema: z
    .string()
    .max(4000)
    .refine((value) => {
      const hosts = splitHosts(value);
      return hosts.length <= MAX_HOSTS && hosts.every((host) => HOST_PATTERN.test(host));
    }, "Enter host names separated by commas, such as wiki.example.com"),
  default: "",
  levels: ["instance"],
  lockable: false,
});

export function splitHosts(value: string): string[] {
  return value
    .split(/[\s,]+/)
    .map((host) => host.trim().toLowerCase())
    .filter((host) => host.length > 0);
}

export function atlassianSite(input: string, allowedHosts: string): string {
  let value = input.trim().toLowerCase();
  if (value.length === 0 || value.length > 300) throw invalidSite();
  if (!value.includes("://")) value = `https://${value}`;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalidSite();
  }
  if (url.protocol !== "https:" || url.port !== "" || url.username !== "" || url.password !== "") {
    throw invalidSite();
  }
  const host = url.hostname;
  if (!HOST_PATTERN.test(host)) throw invalidSite();
  const atlassian = host.endsWith(ATLASSIAN_SUFFIX) && host.length > ATLASSIAN_SUFFIX.length;
  if (!atlassian && !splitHosts(allowedHosts).includes(host)) throw invalidSite();
  return host;
}

export interface DataCenterBase {
  readonly site: string;
  readonly basePath: string;
}

const PATH_SEGMENT = /^[A-Za-z0-9._~-]{1,100}$/;

export function dataCenterBase(input: string, allowedHosts: string): DataCenterBase {
  const invalid = () =>
    new ImportError(
      "invalidDataCenterAddress",
      "Enter the https address of your Confluence Data Center, such as https://wiki.example.com/confluence. An instance administrator must allow its host first.",
    );
  let value = input.trim();
  if (value.length === 0 || value.length > 500) throw invalid();
  if (!value.includes("://")) value = `https://${value}`;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalid();
  }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.search || url.hash) {
    throw invalid();
  }
  const host = url.hostname.toLowerCase();
  if (!HOST_PATTERN.test(host) || !splitHosts(allowedHosts).includes(host)) throw invalid();
  const segments = url.pathname.split("/").filter((segment) => segment.length > 0);
  if (segments.length > 5 || !segments.every((segment) => PATH_SEGMENT.test(segment) && segment !== "..")) {
    throw invalid();
  }
  return {
    site: url.port ? `${host}:${url.port}` : host,
    basePath: segments.length > 0 ? `/${segments.join("/")}` : "",
  };
}

function invalidSite(): ImportError {
  return new ImportError(
    "invalidAtlassianSite",
    "Enter the address of your Confluence Cloud site, such as example.atlassian.net.",
  );
}

export interface AtlassianCredentials {
  readonly site: string;
  readonly email: string;
  readonly token: string;
}

export interface AtlassianPerson {
  readonly accountId: string;
  readonly name: string | null;
  readonly email: string | null;
  readonly app: boolean;
}

const currentUserSchema = z.object({ accountId: z.string().min(1).max(255), type: z.string().optional() });
const bulkSchema = z.object({
  results: z
    .array(
      z.object({
        accountId: z.string().min(1).max(255),
        displayName: z.string().max(500).nullish(),
        publicName: z.string().max(500).nullish(),
        email: z.string().max(320).nullish(),
        accountType: z.string().max(50).nullish(),
      }),
    )
    .max(1000),
});

export class AtlassianDirectory {
  readonly #fetch: typeof fetch;

  constructor(options: { fetch?: typeof fetch } = {}) {
    this.#fetch = options.fetch ?? fetch;
  }

  async check(credentials: AtlassianCredentials): Promise<void> {
    const current = currentUserSchema.safeParse(await this.#get(credentials, "/wiki/rest/api/user/current"));
    if (!current.success || current.data.type === "anonymous") {
      throw new ImportError(
        "atlassianUnauthorized",
        "Atlassian refused the e-mail address and API token. Check both and that the token is still valid.",
      );
    }
  }

  async people(credentials: AtlassianCredentials, accountIds: readonly string[]): Promise<AtlassianPerson[]> {
    const result: AtlassianPerson[] = [];
    const unique = [...new Set(accountIds)];
    for (let start = 0; start < unique.length; start += BULK_SIZE) {
      const ids = unique.slice(start, start + BULK_SIZE);
      const query = new URLSearchParams(ids.map((id): [string, string] => ["accountId", id]));
      query.set("limit", String(BULK_SIZE));
      const parsed = bulkSchema.safeParse(
        await this.#get(credentials, `/wiki/rest/api/user/bulk?${query.toString()}`),
      );
      if (!parsed.success) throw unreachable();
      for (const person of parsed.data.results) {
        const name = (person.displayName ?? person.publicName ?? "").trim();
        const email = (person.email ?? "").trim();
        result.push({
          accountId: person.accountId,
          name: name.length > 0 ? name.slice(0, 200) : null,
          email: email.includes("@") ? email : null,
          app: person.accountType === "app",
        });
      }
    }
    return result;
  }

  async #get(credentials: AtlassianCredentials, path: string): Promise<unknown> {
    const authorization = Buffer.from(`${credentials.email}:${credentials.token}`, "utf8").toString("base64");
    let response: Response;
    try {
      response = await this.#fetch(`https://${credentials.site}${path}`, {
        method: "GET",
        redirect: "error",
        headers: { Accept: "application/json", Authorization: `Basic ${authorization}` },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw unreachable();
    }
    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel();
      throw new ImportError(
        "atlassianUnauthorized",
        "Atlassian refused the e-mail address and API token. Check both and that the token is still valid.",
      );
    }
    if (response.status === 429) {
      await response.body?.cancel();
      throw new ImportError("atlassianRateLimited", "Atlassian asked to slow down. Try again in a minute.");
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw unreachable();
    }
    const text = await readLimited(response);
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw unreachable();
    }
  }
}

function unreachable(): ImportError {
  return new ImportError(
    "atlassianUnreachable",
    "Lunedo could not read the people from this Confluence site. Check the address and try again.",
  );
}

async function readLimited(response: Response): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw unreachable();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}
