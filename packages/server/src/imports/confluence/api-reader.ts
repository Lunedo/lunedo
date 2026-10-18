import type { Readable } from "node:stream";
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { Encryption } from "../../crypto/envelope.js";
import type { Database } from "../../database/database.js";
import { readConnection } from "../credentials.js";
import { ImportFormatError } from "../errors.js";
import type { ByteSource } from "../formats/bytes.js";
import { signalImportChange } from "../signals.js";
import type { ReadContext, ScanContext } from "../source.js";
import { ConfluenceApi, type ConfluenceConnection, type ConfluenceTransport } from "./api-client.js";
import { scanCloud } from "./cloud-scan.js";
import { ListingGuard, type ListingStopped, reportStoppedListing } from "./paging.js";
import {
  confluenceDate,
  formerTitleRecord,
  keepRestricted,
  kinds,
  pageSort,
  StagedConfluenceReader,
  type StagedFile,
  titleKey,
  unlessInvalid,
  versionSort,
} from "./staged.js";

const text = (max: number) => z.string().max(max);
const id = z.union([z.string().regex(/^(att)?\d{1,19}$/), z.number().int().nonnegative()]).transform(String);

const userSchema = z.looseObject({
  type: text(50).optional(),
  accountId: text(255).nullish(),
  userKey: text(255).nullish(),
  username: text(255).nullish(),
  email: text(320).nullish(),
  displayName: text(500).nullish(),
  publicName: text(500).nullish(),
});
type ApiUser = z.infer<typeof userSchema>;

const linksSchema = z.looseObject({ next: text(4000).nullish(), download: text(4000).nullish() }).optional();

const contentSchema = z.looseObject({
  id,
  type: text(50),
  status: text(50).optional(),
  title: text(1000).default(""),
  ancestors: z
    .array(z.looseObject({ id, type: text(50).optional() }))
    .max(1000)
    .optional(),
  version: z
    .looseObject({
      number: z.number().int().min(0).max(1_000_000),
      when: text(64).nullish(),
      by: userSchema.nullish(),
    })
    .optional(),
  history: z.looseObject({ createdBy: userSchema.nullish(), createdDate: text(64).nullish() }).optional(),
  body: z.looseObject({ storage: z.looseObject({ value: z.string() }).optional() }).optional(),
  metadata: z
    .looseObject({
      labels: z
        .looseObject({
          results: z.array(z.looseObject({ name: text(255), prefix: text(50).nullish() })).max(1000),
        })
        .optional(),
    })
    .optional(),
  extensions: z
    .looseObject({
      position: z.union([z.number(), z.string()]).nullish(),
      fileSize: z.number().int().nonnegative().nullish(),
      location: text(50).nullish(),
      inlineProperties: z
        .looseObject({ markerRef: text(255).nullish(), originalSelection: text(10_000).nullish() })
        .nullish(),
      resolution: z
        .looseObject({
          status: text(50).nullish(),
          lastModifier: userSchema.nullish(),
          lastModifiedDate: text(64).nullish(),
        })
        .nullish(),
    })
    .optional(),
  _links: linksSchema,
});
type ApiContent = z.infer<typeof contentSchema>;

const listSchema = <T extends z.ZodType>(item: T) =>
  z.looseObject({ results: z.array(item).max(1000), _links: linksSchema });

const contentListSchema = listSchema(contentSchema);

const spaceSchema = z.looseObject({
  id,
  key: text(255),
  name: text(1000).default(""),
  homepage: z.looseObject({ id }).nullish(),
  permissions: z
    .array(
      z.looseObject({
        subjects: z
          .looseObject({
            user: z.looseObject({ results: z.array(userSchema).max(10_000) }).nullish(),
            group: z
              .looseObject({ results: z.array(z.looseObject({ name: text(255) })).max(10_000) })
              .nullish(),
          })
          .nullish(),
        operation: z.looseObject({ operation: text(50), targetType: text(50) }),
        anonymousAccess: z.boolean().nullish(),
      }),
    )
    .max(10_000)
    .optional(),
});

const spaceListSchema = listSchema(
  z.looseObject({ id, key: text(255), name: text(1000).default(""), type: text(50).optional() }),
);

const restrictionSchema = z.looseObject({
  restrictions: z
    .looseObject({
      user: z.looseObject({ results: z.array(userSchema).max(10_000) }).nullish(),
      group: z.looseObject({ results: z.array(z.looseObject({ name: text(255) })).max(10_000) }).nullish(),
    })
    .nullish(),
});
const restrictionsSchema = z.looseObject({
  read: restrictionSchema.nullish(),
  update: restrictionSchema.nullish(),
});

const versionListSchema = listSchema(
  z.looseObject({
    number: z.number().int().min(0).max(1_000_000),
    when: text(64).nullish(),
    by: userSchema.nullish(),
  }),
);

const templateListSchema = listSchema(
  z.looseObject({
    templateId: id,
    name: text(1000).default(""),
    description: text(10_000).nullish(),
    body: z.looseObject({ storage: z.looseObject({ value: z.string() }).optional() }).optional(),
  }),
);

const attachmentSearchSchema = listSchema(
  z.looseObject({
    id,
    container: z.looseObject({ id }).nullish(),
    extensions: z.looseObject({ fileSize: z.number().int().nonnegative().nullish() }).nullish(),
  }),
);

const currentUserSchema = userSchema;

const serverInfoSchema = z.looseObject({ version: text(50).nullish() });

const PERMISSION_TYPES: Readonly<Record<string, string>> = {
  "read/space": "VIEWSPACE",
  "create/page": "EDITSPACE",
  "create/blogpost": "EDITBLOG",
  "create/comment": "COMMENT",
  "create/attachment": "CREATEATTACHMENT",
  "delete/page": "REMOVEPAGE",
  "delete/blogpost": "REMOVEBLOG",
  "delete/comment": "REMOVECOMMENT",
  "delete/attachment": "REMOVEATTACHMENT",
  "delete/space": "REMOVEOWNCONTENT",
  "restrict_content/space": "SETPAGEPERMISSIONS",
  "administer/space": "SETSPACEPERMISSIONS",
  "export/space": "EXPORTSPACE",
  "archive/page": "ARCHIVEPAGE",
};

const SPACE_KEY = /^~?[A-Za-z0-9_-]{1,255}$/;
const PAGE_ID = /^\d{1,19}$/;
const LIST_LIMIT = 25;
const MAX_SPACES = 2000;
const MAX_TREES = 500;
const MAX_TREE_PAGES = 100_000;
const MAX_SIZED_ATTACHMENTS = 20_000;
const PROGRESS_STEP = 10;

export interface ConfluenceSpaceSummary {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly personal: boolean;
}

export interface ConfluenceTreeEntry {
  readonly id: string;
  readonly title: string;
  readonly pages: number;
  readonly attachmentBytes: number;
}

export interface ConfluenceTree {
  readonly spaceKey: string;
  readonly spaceName: string;
  readonly pages: number;
  readonly blogPosts: number;
  readonly attachmentBytes: number;
  readonly complete: boolean;
  readonly trees: readonly ConfluenceTreeEntry[];
}

export interface ConfluenceAccount {
  readonly name: string | null;
  readonly version: string | null;
}

export function isSpaceKey(value: string): boolean {
  return SPACE_KEY.test(value);
}

function apiPath(path: string): string {
  return `/rest/api${path}`;
}

function nextPath(next: string | null | undefined): string | null {
  if (!next) return null;
  if (next.startsWith("/rest/api/") || next.startsWith("/api/v2/")) return next;
  throw new ImportFormatError("confluenceInvalidResponse", "Confluence sent a link Pagehall cannot follow.");
}

function attachmentId(value: string): string {
  return value.startsWith("att") ? value.slice(3) : value;
}

function userKeyOf(user: ApiUser | null | undefined): string | null {
  if (!user || user.type === "anonymous") return null;
  return user.userKey?.trim() || null;
}

function apiDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? confluenceDate(value) : date.toISOString();
}

function position(content: ApiContent): number | null {
  const value = content.extensions?.position;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^-?\d+$/.test(value)) return Number(value);
  return null;
}

async function* pages<T>(
  api: ConfluenceApi,
  first: string,
  schema: z.ZodType<{ results: T[]; _links?: { next?: string | null | undefined } | undefined }>,
  stopped?: ListingStopped,
): AsyncGenerator<T> {
  const guard = new ListingGuard(first, stopped);
  let path: string | null = first;
  while (path) {
    const page = await api.json(path, schema);
    if (!page) return;
    for (const item of page.results) yield item;
    path = await guard.follow(nextPath(page._links?.next));
  }
}

export interface ConfluenceApiReaderOptions {
  readonly database: Database;
  readonly encryption: Encryption;
  readonly transport: ConfluenceTransport;
}

type Step = "space" | "pages" | "blogPosts" | "details" | "permissions" | "templates" | "done";

interface Checkpoint {
  step: Step;
  next: string | null;
  after: string | null;
}

export class ConfluenceApiReader extends StagedConfluenceReader {
  readonly source: "confluence-cloud" | "confluence-dc";
  readonly #options: ConfluenceApiReaderOptions;

  constructor(source: "confluence-cloud" | "confluence-dc", options: ConfluenceApiReaderOptions) {
    super();
    this.source = source;
    this.#options = options;
  }

  api(connection: ConfluenceConnection, signal?: AbortSignal, importId?: string): ConfluenceApi {
    const database = this.#options.database;
    return new ConfluenceApi(connection, this.#options.transport, {
      signal,
      onThrottle: importId
        ? async (until) => {
            const updated = await database.execute<{ organization_id: string }>(sql`
              update imports set throttled_until = ${until} where id = ${importId} returning organization_id`);
            const organizationId = updated.rows[0]?.organization_id;
            if (organizationId) await signalImportChange(database, { importId, organizationId });
          }
        : undefined,
    });
  }

  async #connection(importId: string): Promise<ConfluenceConnection> {
    const connection = await readConnection(this.#options.database, this.#options.encryption, importId);
    if (!connection) {
      throw new ImportFormatError(
        "connectionMissing",
        "Pagehall deleted the token of this import. Enter it again to continue.",
      );
    }
    return connection;
  }

  async check(connection: ConfluenceConnection): Promise<ConfluenceAccount> {
    const api = this.api(connection);
    const user = await api.json(apiPath("/user/current"), currentUserSchema);
    if (!user || user.type === "anonymous") {
      throw new ImportFormatError(
        "confluenceUnauthorized",
        connection.kind === "cloud"
          ? "Confluence refused the e-mail address and API token. Check both and that the token is still valid."
          : "Confluence refused the personal access token. Check that it is still valid.",
      );
    }
    const info =
      connection.kind === "dataCenter"
        ? await api.json("/rest/applinks/1.0/manifest", serverInfoSchema)
        : null;
    const name = (user.displayName ?? user.publicName ?? user.username ?? "").trim();
    return { name: name ? name.slice(0, 200) : null, version: info?.version ?? null };
  }

  async spaces(connection: ConfluenceConnection): Promise<ConfluenceSpaceSummary[]> {
    const api = this.api(connection);
    const result: ConfluenceSpaceSummary[] = [];
    for await (const space of pages(api, apiPath("/space?limit=100&status=current"), spaceListSchema)) {
      if (result.length >= MAX_SPACES) break;
      result.push({
        id: space.id,
        key: space.key,
        name: space.name,
        personal: space.type === "personal" || space.key.startsWith("~"),
      });
    }
    return result.sort((left, right) => left.name.localeCompare(right.name, "en"));
  }

  async tree(connection: ConfluenceConnection, spaceKey: string): Promise<ConfluenceTree> {
    const missing = () =>
      new ImportFormatError(
        "confluenceSpaceMissing",
        "The space does not exist or the token cannot read it.",
      );
    if (!SPACE_KEY.test(spaceKey)) throw missing();
    const api = this.api(connection);
    const space = await api.json(
      apiPath(`/space/${encodeURIComponent(spaceKey)}?expand=homepage`),
      spaceSchema,
    );
    if (!space) throw missing();
    const key = encodeURIComponent(space.key);
    const parents = new Map<string, string | null>();
    const titles = new Map<string, string>();
    let complete = true;
    const stopped = async () => {
      complete = false;
    };
    for await (const content of pages(
      api,
      apiPath(`/content?spaceKey=${key}&type=page&status=current&limit=100&expand=ancestors`),
      contentListSchema,
      stopped,
    )) {
      parents.set(content.id, (content.ancestors ?? []).at(-1)?.id ?? null);
      titles.set(content.id, content.title);
      if (parents.size >= MAX_TREE_PAGES) break;
    }
    let blogPosts = 0;
    for await (const _ of pages(
      api,
      apiPath(`/content?spaceKey=${key}&type=blogpost&status=current&limit=100`),
      contentListSchema,
      stopped,
    )) {
      blogPosts += 1;
      if (blogPosts >= MAX_TREE_PAGES) break;
    }
    const home = space.homepage?.id ?? null;
    const topOf = (pageId: string): string | null => {
      let current: string | null = pageId;
      for (let depth = 0; current !== null && depth < 1000; depth += 1) {
        const parent: string | null = parents.get(current) ?? null;
        if (current !== home && (parent === null || parent === home || !parents.has(parent))) return current;
        current = parent;
      }
      return null;
    };
    const trees = new Map<string, { pages: number; bytes: number }>();
    for (const pageId of parents.keys()) {
      const top = topOf(pageId);
      if (!top) continue;
      const entry = trees.get(top) ?? { pages: 0, bytes: 0 };
      entry.pages += 1;
      trees.set(top, entry);
    }
    let bytes = 0;
    let read = 0;
    const cql = encodeURIComponent(`space="${space.key.replace(/"/g, "")}" and type=attachment`);
    for await (const attachment of pages(
      api,
      apiPath(`/content/search?cql=${cql}&limit=200&expand=container,extensions`),
      attachmentSearchSchema,
      stopped,
    )) {
      read += 1;
      if (read > MAX_SIZED_ATTACHMENTS) {
        complete = false;
        break;
      }
      const size = attachment.extensions?.fileSize ?? 0;
      bytes += size;
      const container = attachment.container?.id;
      const top = container ? topOf(container) : null;
      const entry = top ? trees.get(top) : undefined;
      if (entry) entry.bytes += size;
    }
    return {
      spaceKey: space.key,
      spaceName: space.name,
      pages: parents.size,
      blogPosts,
      attachmentBytes: bytes,
      complete: complete && parents.size < MAX_TREE_PAGES,
      trees: [...trees.entries()]
        .map(([id, entry]) => ({
          id,
          title: titles.get(id) ?? "",
          pages: entry.pages,
          attachmentBytes: entry.bytes,
        }))
        .sort((left, right) => left.title.localeCompare(right.title, "en"))
        .slice(0, MAX_TREES),
    };
  }

  async scan(_file: ByteSource, context: ScanContext): Promise<void> {
    const spaceKey = context.options.spaceKey;
    if (!spaceKey || !SPACE_KEY.test(spaceKey)) {
      throw new ImportFormatError("selectionMissing", "Choose the space to import first.");
    }
    const importId = context.staging.importId;
    const connection = await this.#connection(importId);
    const api = this.api(connection, context.signal, importId);
    if (connection.kind === "cloud") {
      await scanCloud(api, context, spaceKey);
      return;
    }
    let checkpoint: Checkpoint = {
      step: (context.checkpoint.step as Step | undefined) ?? "space",
      next: typeof context.checkpoint.next === "string" ? context.checkpoint.next : null,
      after: typeof context.checkpoint.after === "string" ? context.checkpoint.after : null,
    };
    const save = async (next: Checkpoint) => {
      await context.staging.flush();
      checkpoint = next;
      await context.saveCheckpoint({ ...next });
    };
    const stopped = reportStoppedListing(context);
    const users = new Set<string>();
    const user = async (value: ApiUser | null | undefined): Promise<string | null> => {
      const key = userKeyOf(value);
      if (!key || !value) return null;
      if (users.has(key)) return key;
      users.add(key);
      const name = (value.displayName ?? value.publicName ?? "").trim();
      const email = (value.email ?? "").trim();
      const existing = (
        await context.staging.get<{ name?: string | null; email?: string | null }>(kinds.user, [key])
      ).get(key);
      await context.staging.put({
        kind: kinds.user,
        sourceId: key,
        data: {
          accountId: null,
          name: name || existing?.data.name || null,
          email: email.includes("@") ? email : (existing?.data.email ?? null),
        },
      });
      return key;
    };
    const selected = new Set((context.options.pageIds ?? []).filter((value) => PAGE_ID.test(value)));
    const keep = (content: ApiContent) =>
      selected.size === 0 ||
      selected.has(content.id) ||
      (content.ancestors ?? []).some((ancestor) => selected.has(ancestor.id));

    if (checkpoint.step === "space") {
      const space = await api.json(
        apiPath(`/space/${encodeURIComponent(spaceKey)}?expand=homepage`),
        spaceSchema,
      );
      if (!space) {
        throw new ImportFormatError(
          "confluenceSpaceMissing",
          "The space does not exist or the token cannot read it.",
        );
      }
      await context.staging.put({
        kind: kinds.space,
        sourceId: space.id,
        data: { key: space.key, name: space.name, homePageId: space.homepage?.id ?? null },
      });
      await save({ step: "pages", next: null, after: null });
    }
    const spaceRecord = await this.space({ staging: context.staging });
    const listing = (type: "page" | "blogpost") =>
      apiPath(
        `/content?spaceKey=${encodeURIComponent(spaceRecord.key)}&type=${type}&status=current&limit=${LIST_LIMIT}` +
          "&expand=ancestors,version,history,body.storage,metadata.labels",
      );
    const stageContent = async (content: ApiContent, blog: boolean) => {
      const creatorKey = await user(content.history?.createdBy);
      const modifierKey = await user(content.version?.by);
      const created = apiDate(content.history?.createdDate);
      const ancestors = content.ancestors ?? [];
      await context.staging.put({
        kind: kinds.page,
        sourceId: content.id,
        ref: titleKey(content.title),
        parentId: blog ? null : (ancestors.at(-1)?.id ?? null),
        sort: blog ? `2${created ?? ""}` : pageSort(position(content), content.title),
        data: {
          ...(blog ? { type: "blogPost" } : {}),
          title: content.title.trim(),
          version: content.version?.number ?? 1,
          creatorKey,
          created,
          modifierKey,
          modified: apiDate(content.version?.when),
          spaceId: spaceRecord.sourceId,
        },
      });
      const body = content.body?.storage?.value;
      if (body !== undefined) {
        await context.staging.put({
          kind: kinds.body,
          sourceId: content.id,
          ref: content.id,
          data: { body },
        });
      }
      for (const label of content.metadata?.labels?.results ?? []) {
        const prefix = (label.prefix ?? "global").trim().toLowerCase();
        const name = label.name.trim();
        if (!name) continue;
        const labelId = `${prefix}:${name}`;
        await context.staging.put({
          kind: kinds.label,
          sourceId: labelId,
          data: { name, namespace: prefix },
        });
        await context.staging.put({
          kind: kinds.labelling,
          sourceId: `${content.id}/${labelId}`,
          ref: content.id,
          data: { labelId },
        });
      }
    };
    for (const [step, type, then] of [
      ["pages", "page", "blogPosts"],
      ["blogPosts", "blogpost", "details"],
    ] as const) {
      if (checkpoint.step !== step) continue;
      const wanted = type === "page" || (selected.size === 0 && context.options.blogPosts !== false);
      let path: string | null = wanted ? (checkpoint.next ?? listing(type)) : null;
      const guard = new ListingGuard(path ?? listing(type), stopped);
      let count = 0;
      while (path) {
        const page = await api.json(path, contentListSchema);
        if (!page) break;
        for (const content of page.results) {
          if (type === "page" && !keep(content)) continue;
          await stageContent(content, type === "blogpost");
          count += 1;
        }
        path = await guard.follow(nextPath(page._links?.next));
        if (!path) break;
        await context.progress({ done: count, total: count + LIST_LIMIT });
        await save({ step, next: path, after: null });
      }
      await save({ step: then, next: null, after: null });
    }
    if (checkpoint.step === "details") {
      const total = await context.staging.count(kinds.page);
      let done = 0;
      for await (const record of context.staging.iterate<{ title: string; type?: string }>(kinds.page)) {
        done += 1;
        if (checkpoint.after !== null && record.sourceId <= checkpoint.after) continue;
        await this.#details(api, context, record.sourceId, record.data, user);
        if (done % PROGRESS_STEP === 0 || done === total) {
          await context.progress({ done, total });
        }
        await save({ step: "details", next: null, after: record.sourceId });
      }
      await save({ step: "permissions", next: null, after: null });
    }
    if (checkpoint.step === "permissions") {
      const space = await api.json(
        apiPath(`/space/${encodeURIComponent(spaceRecord.key)}?expand=permissions`),
        spaceSchema,
      );
      if (!space?.permissions) await context.problem("permissionsUnavailable", {});
      for (const permission of space?.permissions ?? []) {
        const type = PERMISSION_TYPES[`${permission.operation.operation}/${permission.operation.targetType}`];
        if (!type) continue;
        const base = `${permission.operation.operation}/${permission.operation.targetType}`;
        if (permission.anonymousAccess) {
          await context.staging.put({
            kind: kinds.spacePermission,
            sourceId: `${base}/anonymous`,
            data: { spaceId: spaceRecord.sourceId, type, group: null, userKey: null, allUsers: false },
          });
        }
        for (const entry of permission.subjects?.user?.results ?? []) {
          const key = await user(entry);
          if (!key) continue;
          await context.staging.put({
            kind: kinds.spacePermission,
            sourceId: `${base}/user/${key}`,
            data: { spaceId: spaceRecord.sourceId, type, group: null, userKey: key, allUsers: false },
          });
        }
        for (const entry of permission.subjects?.group?.results ?? []) {
          const group = entry.name.trim();
          if (!group) continue;
          await context.staging.put({
            kind: kinds.spacePermission,
            sourceId: `${base}/group/${group.toLowerCase()}`,
            data: { spaceId: spaceRecord.sourceId, type, group, userKey: null, allUsers: false },
          });
        }
      }
      await save({ step: "templates", next: null, after: null });
    }
    if (checkpoint.step === "templates") {
      for await (const template of pages(
        api,
        apiPath(
          `/template/page?spaceKey=${encodeURIComponent(spaceRecord.key)}&expand=body.storage&limit=50`,
        ),
        templateListSchema,
        stopped,
      )) {
        const body = template.body?.storage?.value;
        if (body === undefined) continue;
        await context.staging.put({
          kind: kinds.template,
          sourceId: template.templateId,
          data: {
            name: template.name.trim(),
            description: (template.description ?? "").trim(),
            body,
            spaceId: spaceRecord.sourceId,
            creatorKey: null,
            created: null,
            modified: null,
          },
        });
      }
      await save({ step: "done", next: null, after: null });
    }
    await context.staging.flush();
    await context.staging.orderTree(kinds.page, selected.size > 0 ? [...selected] : []);
  }

  async #details(
    api: ConfluenceApi,
    context: ScanContext,
    pageId: string,
    page: { title: string; type?: string },
    user: (value: ApiUser | null | undefined) => Promise<string | null>,
  ): Promise<void> {
    const skipped = async (part: string) => context.problem("contentSkipped", { title: page.title, part });
    const comments = await api.json(
      apiPath(
        `/content/${pageId}/child/comment?depth=all&limit=100` +
          "&expand=body.storage,history,version,ancestors,extensions.inlineProperties,extensions.resolution",
      ),
      contentListSchema,
    );
    if (comments === null) await skipped("comments");
    const commentPages = new ListingGuard(
      apiPath(`/content/${pageId}/child/comment`),
      reportStoppedListing(context),
    );
    let path: string | null = null;
    let current = comments;
    for (;;) {
      for (const comment of current?.results ?? []) {
        const created = apiDate(comment.history?.createdDate);
        const parent =
          (comment.ancestors ?? []).filter((ancestor) => ancestor.type === "comment").at(-1)?.id ?? null;
        await context.staging.put({
          kind: kinds.comment,
          sourceId: comment.id,
          ref: pageId,
          parentId: parent,
          sort: created ?? "",
          data: {
            creatorKey: await user(comment.history?.createdBy),
            created,
            modified: apiDate(comment.version?.when),
          },
        });
        const body = comment.body?.storage?.value;
        if (body !== undefined) {
          await context.staging.put({
            kind: kinds.body,
            sourceId: comment.id,
            ref: comment.id,
            data: { body },
          });
        }
        const extensions = comment.extensions;
        const properties: [string, string | null | undefined][] = [
          ["inline-comment", extensions?.location === "inline" ? "true" : null],
          ["inline-marker-ref", extensions?.inlineProperties?.markerRef],
          ["inline-original-selection", extensions?.inlineProperties?.originalSelection],
          ["status", extensions?.resolution?.status],
          ["status-lastmodifier", userKeyOf(extensions?.resolution?.lastModifier)],
          ["status-lastmoddate", apiDate(extensions?.resolution?.lastModifiedDate)],
        ];
        if (extensions?.resolution?.lastModifier) await user(extensions.resolution.lastModifier);
        for (const [name, value] of properties) {
          if (!value) continue;
          await context.staging.put({
            kind: kinds.property,
            sourceId: `${comment.id}/${name}`,
            ref: comment.id,
            data: { name, value: value.slice(0, 2000) },
          });
        }
      }
      path = await commentPages.follow(nextPath(current?._links?.next));
      if (!path) break;
      current = await api.json(path, contentListSchema);
    }
    let attachments = await api.json(
      apiPath(`/content/${pageId}/child/attachment?limit=100&expand=version,history`),
      contentListSchema,
    );
    if (attachments === null) await skipped("attachments");
    const attachmentPages = new ListingGuard(
      apiPath(`/content/${pageId}/child/attachment`),
      reportStoppedListing(context),
    );
    while (attachments) {
      for (const attachment of attachments.results) {
        const sourceId = attachmentId(attachment.id);
        const version = attachment.version?.number ?? 1;
        const download = attachment._links?.download ?? null;
        await context.staging.put({
          kind: kinds.attachment,
          sourceId,
          ref: sourceId,
          data: {
            pageId,
            originalId: null,
            fileName: attachment.title.trim(),
            version,
            creatorKey: await user(attachment.version?.by ?? attachment.history?.createdBy),
            created: apiDate(attachment.version?.when ?? attachment.history?.createdDate),
          },
        });
        if (download?.startsWith("/download/")) {
          await context.staging.put({
            kind: kinds.file,
            sourceId: `attachments/${pageId}/${sourceId}/${version}`,
            data: { size: attachment.extensions?.fileSize ?? 0, download },
          });
        }
      }
      const next = await attachmentPages.follow(nextPath(attachments._links?.next));
      attachments = next ? await api.json(next, contentListSchema) : null;
    }
    const restrictions = await unlessInvalid(
      api.json(
        apiPath(`/content/${pageId}/restriction/byOperation?expand=restrictions.user,restrictions.group`),
        restrictionsSchema,
      ),
    );
    if (restrictions === null) await keepRestricted(context, pageId, page.title, "restrictions");
    for (const [operation, kind] of [
      ["read", "view"],
      ["update", "edit"],
    ] as const) {
      const entry = restrictions?.[operation];
      for (const person of entry?.restrictions?.user?.results ?? []) {
        const key = await user(person);
        if (!key) continue;
        await context.staging.put({
          kind: kinds.restriction,
          sourceId: `${pageId}/${kind}/user/${key}`,
          ref: pageId,
          data: {
            kind,
            origin: "table",
            userKey: key,
            accountId: null,
            group: null,
          },
        });
      }
      for (const group of entry?.restrictions?.group?.results ?? []) {
        const name = group.name.trim();
        if (!name) continue;
        await context.staging.put({
          kind: kinds.restriction,
          sourceId: `${pageId}/${kind}/group/${name.toLowerCase()}`,
          ref: pageId,
          data: { kind, origin: "table", userKey: null, accountId: null, group: name },
        });
      }
    }
    if (context.history) await this.#history(api, context, pageId, user);
  }

  async #history(
    api: ConfluenceApi,
    context: ScanContext,
    pageId: string,
    user: (value: ApiUser | null | undefined) => Promise<string | null>,
  ): Promise<void> {
    const current =
      (await context.staging.get<{ version: number }>(kinds.page, [pageId])).get(pageId)?.data.version ?? 1;
    for await (const version of pages(
      api,
      apiPath(`/content/${pageId}/version?limit=50`),
      versionListSchema,
      reportStoppedListing(context),
    )) {
      if (version.number >= current || version.number < 1) continue;
      const content = await api.json(
        apiPath(`/content/${pageId}?status=historical&version=${version.number}&expand=body.storage`),
        contentSchema,
      );
      if (!content) continue;
      const sourceId = `${pageId}v${version.number}`;
      const title = content.title.trim();
      await context.staging.put({
        kind: kinds.version,
        sourceId,
        ref: pageId,
        sort: versionSort(version.number),
        data: {
          title,
          version: version.number,
          authorKey: await user(version.by),
          created: apiDate(version.when),
        },
      });
      const body = content.body?.storage?.value;
      if (body !== undefined) {
        await context.staging.put({ kind: kinds.body, sourceId, ref: sourceId, data: { body } });
      }
      if (title) await context.staging.put(formerTitleRecord(pageId, title));
    }
  }

  override async openFile(_file: ByteSource, context: ReadContext, path: string): Promise<Readable | null> {
    const stored = await context.staging.get<StagedFile & { download?: string }>(kinds.file, [path]);
    const download = stored.get(path)?.data.download;
    if (!download) return null;
    const importId = context.staging.importId;
    const api = this.api(await this.#connection(importId), undefined, importId);
    return api.download(download);
  }
}
