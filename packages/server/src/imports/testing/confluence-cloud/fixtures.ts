import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { gunzipSync } from "node:zlib";
import type { ConfluenceTransport } from "../../confluence/api-client.js";
import { createZip } from "../zip-writer.js";
import { type BundleEntry, canonicalQuery, type RecordedEntry } from "./prepare.js";

const FIXTURES = process.env.LUNEDO_CONFLUENCE_FIXTURES ?? path.join(import.meta.dirname, "fixtures");

export const CLOUD_SPACES = ["PHIT", "PHKB", "PHPROJ", "PHGF", "PHEDGE"] as const;
export type CloudSpace = (typeof CLOUD_SPACES)[number];

export interface ExpectedPage {
  readonly space: string;
  readonly title: string;
}

export interface ExpectedSpace {
  readonly pages: number;
  readonly liveDocs: number;
  readonly archivedPages: number;
  readonly trashedPages: number;
  readonly blogPosts: number;
  readonly folders: number;
  readonly whiteboards: number;
  readonly databases: number;
  readonly smartLinks: number;
  readonly versions: number;
  readonly pageComments: number;
  readonly inlineComments: { readonly open: number; readonly resolved: number };
  readonly attachments: number;
  readonly attachmentVersions: number;
  readonly attachmentKiB: number;
  readonly labels: { readonly distinct: number; readonly assignments: number };
  readonly viewRestrictedPages: number;
  readonly editRestrictedPages: number;
  readonly templates: number;
}

export interface ExpectedAccount {
  readonly role: string;
  readonly displayName: string;
  readonly accountId: string;
  readonly email: string;
}

export interface Expected {
  readonly site: string;
  readonly accounts: readonly ExpectedAccount[];
  readonly spaces: Readonly<Record<CloudSpace, ExpectedSpace>>;
  readonly restrictions: readonly { space: string; view: string[]; edit: string[] }[];
  readonly macros: Readonly<Record<string, readonly ExpectedPage[]>>;
  readonly thirdParty: readonly { space: string; title: string; macros: string[] }[];
  readonly checks: readonly string[];
}

function lines<T>(name: string): T[] {
  return gunzipSync(readFileSync(path.join(FIXTURES, name)))
    .toString("utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as T);
}

export function expected(): Expected {
  return JSON.parse(readFileSync(path.join(FIXTURES, "expected.json"), "utf8")) as Expected;
}

export function cloudExport(name: CloudSpace | "site-backup"): Buffer {
  return createZip(
    lines<BundleEntry>(`${name}.jsonl.gz`).map((entry) => ({
      name: entry.name,
      data: entry.text ?? Buffer.from(entry.base64 ?? "", "base64"),
      deflate: true,
    })),
  );
}

export interface RecordedConfluence extends ConfluenceTransport {
  readonly missing: readonly string[];
  readonly requests: number;
}

export function recordedConfluence(actor = "admin"): RecordedConfluence {
  const entries = new Map(lines<RecordedEntry>("api-recording.jsonl.gz").map((entry) => [entry.key, entry]));
  const missing: string[] = [];
  let requests = 0;
  const admin = expected().accounts.find((account) => account.role === actor);
  const current = [...entries.values()].find(
    (entry) =>
      admin &&
      entry.key ===
        `${actor} GET /wiki/rest/api/user?accountId=${encodeURIComponent(admin.accountId)}&expand=operations%2CpersonalSpace`,
  );
  return {
    get missing() {
      return missing;
    },
    get requests() {
      return requests;
    },
    async get(url) {
      requests += 1;
      const parsed = new URL(url);
      const query: Record<string, string | string[]> = {};
      parsed.searchParams.forEach((value, name) => {
        const current = query[name];
        query[name] =
          current === undefined ? value : Array.isArray(current) ? [...current, value] : [current, value];
      });
      const key = `${actor} GET ${parsed.pathname}?${canonicalQuery(query)}`;
      const entry =
        entries.get(key) ?? (parsed.pathname === "/wiki/rest/api/user/current" ? current : undefined);
      if (!entry) {
        missing.push(key);
        return { status: 404, headers: { "content-type": "application/json" }, body: Readable.from(["{}"]) };
      }
      const headers: Record<string, string> = {};
      if (entry.contentType) headers["content-type"] = entry.contentType;
      if (entry.link) headers.link = entry.link;
      const body =
        entry.base64 !== undefined
          ? Buffer.from(entry.base64, "base64")
          : Buffer.from(
              typeof entry.body === "string" ? entry.body : JSON.stringify(entry.body ?? null),
              "utf8",
            );
      return { status: entry.status, headers, body: Readable.from([body]) };
    },
  };
}

export function fixturesAvailable(): boolean {
  return existsSync(path.join(FIXTURES, "expected.json"));
}

export function recordedDirectory(): typeof fetch {
  const users = recordedUsers();
  const admin = expected().accounts.find((account) => account.role === "admin");
  return (async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.pathname === "/wiki/rest/api/user/current") {
      return Response.json({ type: "known", accountId: admin?.accountId });
    }
    if (url.pathname === "/wiki/rest/api/user/bulk") {
      const results = url.searchParams.getAll("accountId").flatMap((id) => {
        const user = users.get(id);
        return user ? [user] : [];
      });
      return Response.json({ results });
    }
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
}

export function recordedUsers(): Map<string, Record<string, unknown>> {
  const users = new Map<string, Record<string, unknown>>();
  for (const entry of lines<RecordedEntry>("api-recording.jsonl.gz")) {
    if (!entry.key.startsWith("admin GET /wiki/rest/api/user?") || entry.status !== 200) continue;
    const user = entry.body as Record<string, unknown> | undefined;
    if (user && typeof user.accountId === "string") users.set(user.accountId, user);
  }
  return users;
}

export interface RecordedTrash {
  readonly titles: string[];
  readonly versions: number;
}

export function recordedTrash(space: CloudSpace): RecordedTrash {
  const entries = new Map(lines<RecordedEntry>("api-recording.jsonl.gz").map((entry) => [entry.key, entry]));
  const results = (first: string) => {
    const found: Record<string, unknown>[] = [];
    for (let next: string | undefined = first; next; ) {
      const url: URL = new URL(next, "https://recording.invalid");
      const query: Record<string, string | string[]> = {};
      url.searchParams.forEach((value, name) => {
        const current = query[name];
        query[name] =
          current === undefined ? value : Array.isArray(current) ? [...current, value] : [current, value];
      });
      const body = entries.get(`admin GET ${url.pathname}?${canonicalQuery(query)}`)?.body as
        | { results?: Record<string, unknown>[]; _links?: { next?: string } }
        | undefined;
      found.push(...(body?.results ?? []));
      const link = body?._links?.next;
      next = link ? (link.startsWith("/wiki") ? link : `/wiki${link}`) : undefined;
    }
    return found;
  };
  const [spaceRecord] = results(
    `/wiki/api/v2/spaces?description-format=plain&include-icon=true&keys=${space}`,
  );
  const spaceId = String(spaceRecord?.id ?? "");
  const trashed = [
    ...results(
      `/wiki/api/v2/spaces/${spaceId}/pages?depth=all&status=current&status=archived&status=trashed`,
    ).map((item) => ({ item, collection: "pages" })),
    ...results(`/wiki/api/v2/spaces/${spaceId}/blogposts?status=current&status=trashed`).map((item) => ({
      item,
      collection: "blogposts",
    })),
  ].filter(({ item }) => item.status === "trashed");
  return {
    titles: trashed.map(({ item }) => String(item.title)),
    versions: trashed.reduce(
      (sum, { item, collection }) =>
        sum + results(`/wiki/api/v2/${collection}/${String(item.id)}/versions?body-format=storage`).length,
      0,
    ),
  };
}

export function recordedHomeTitle(space: CloudSpace): string {
  const entries = new Map(lines<RecordedEntry>("api-recording.jsonl.gz").map((entry) => [entry.key, entry]));
  const spaces = entries.get(
    `admin GET /wiki/api/v2/spaces?description-format=plain&include-icon=true&keys=${space}`,
  )?.body as { results?: { homepageId?: string }[] } | undefined;
  const home = spaces?.results?.[0]?.homepageId ?? "";
  const page = entries.get(
    `admin GET /wiki/api/v2/pages/${home}?body-format=storage&include-labels=true&include-properties=true&include-version=true&include-versions=true`,
  )?.body as { title?: string } | undefined;
  return page?.title ?? "";
}
