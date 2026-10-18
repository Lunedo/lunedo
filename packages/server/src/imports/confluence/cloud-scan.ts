import { z } from "zod";
import { ImportFormatError } from "../errors.js";
import type { ScanContext } from "../source.js";
import type { ConfluenceApi } from "./api-client.js";
import { ListingGuard, reportStoppedListing } from "./paging.js";
import {
  confluenceDate,
  contentKind,
  formerTitleRecord,
  keepRestricted,
  kinds,
  leaveOutUnreadablePage,
  PAGE_STATUS_PROPERTY,
  pageSort,
  reportTrashed,
  stageTrashed,
  titleKey,
  unlessInvalid,
  versionSort,
} from "./staged.js";

const text = (max: number) => z.string().max(max);
const id = z.union([z.string().regex(/^\d{1,19}$/), z.number().int().nonnegative()]).transform(String);
const date = z.union([z.string().max(64), z.number()]).nullish();
const storage = z.looseObject({ storage: z.looseObject({ value: z.string() }).optional() }).optional();
const links = z.looseObject({ next: text(4000).nullish() }).optional();
const listOf = <T extends z.ZodType>(item: T) =>
  z.looseObject({ results: z.array(item).max(1000), _links: links });

const versionSchema = z.looseObject({
  number: z.number().int().min(0).max(1_000_000),
  authorId: text(255).nullish(),
  createdAt: date,
});

const nodeSchema = z.looseObject({
  id,
  status: text(50).optional(),
  title: text(1000).default(""),
  parentId: id.nullish(),
  parentType: text(50).nullish(),
  position: z.number().nullish(),
  authorId: text(255).nullish(),
  createdAt: date,
  version: versionSchema.nullish(),
  embedUrl: text(4000).nullish(),
});

const labelSchema = z.looseObject({ name: text(255), prefix: text(50).nullish() });
const propertySchema = z.looseObject({ key: text(255), value: z.unknown() });

const contentSchema = nodeSchema.extend({
  body: storage,
  labels: z
    .looseObject({
      results: z.array(labelSchema).max(1000),
      meta: z.looseObject({ hasMore: z.boolean() }).optional(),
    })
    .optional(),
  properties: z
    .looseObject({
      results: z.array(propertySchema).max(1000),
      meta: z.looseObject({ hasMore: z.boolean() }).optional(),
    })
    .optional(),
});

const childSchema = z.looseObject({
  id,
  type: text(50),
  status: text(50).optional(),
  title: text(1000).default(""),
});

const historySchema = versionSchema.extend({
  page: z.looseObject({ title: text(1000).nullish(), body: storage }).nullish(),
  blogpost: z.looseObject({ title: text(1000).nullish(), body: storage }).nullish(),
});

const commentSchema = z.looseObject({
  id,
  status: text(50).optional(),
  parentCommentId: id.nullish(),
  version: versionSchema.nullish(),
  body: storage,
  resolutionStatus: text(50).nullish(),
  resolutionLastModifierId: text(255).nullish(),
  resolutionLastModifiedAt: date,
  properties: z.looseObject({}).nullish(),
  versions: z.looseObject({ results: z.array(versionSchema).max(1000) }).nullish(),
});

const attachmentSchema = z.looseObject({
  id: text(30).regex(/^att\d{1,19}$/),
  title: text(1000).default(""),
  fileSize: z.number().int().nonnegative().nullish(),
  version: versionSchema.nullish(),
  createdAt: date,
});

const userSchema = z.looseObject({ type: text(50).optional(), accountId: text(255).nullish() });

const restrictionSchema = z.looseObject({
  results: z
    .array(
      z.looseObject({
        operation: text(50),
        restrictions: z
          .looseObject({
            user: z.looseObject({ results: z.array(userSchema).max(10_000) }).nullish(),
            group: z
              .looseObject({ results: z.array(z.looseObject({ name: text(255) })).max(10_000) })
              .nullish(),
          })
          .nullish(),
      }),
    )
    .max(10),
});

const permissionSchema = z.looseObject({
  principal: z.looseObject({ type: text(50), id: text(255) }),
  operation: z.looseObject({ key: text(100), targetType: text(50) }),
});

const groupSchema = z.looseObject({ name: text(255) });

const templateSchema = z.looseObject({
  templateId: id,
  name: text(1000).default(""),
  description: text(10_000).nullish(),
  body: storage,
});

const spaceSchema = z.looseObject({
  id,
  key: text(255),
  name: text(1000).default(""),
  homepageId: id.nullish(),
  description: z.looseObject({ plain: z.looseObject({ value: text(10_000) }).nullish() }).nullish(),
});

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

const NODE_COLLECTIONS: Readonly<Record<string, string>> = {
  folder: "folders",
  whiteboard: "whiteboards",
  database: "databases",
  embed: "embeds",
};
const NODE_QUERIES: Readonly<Record<string, string>> = {
  whiteboards: "?include-operations=false&include-properties=true",
  databases: "?include-operations=false&include-properties=true",
};
const RESOLUTION_STATUSES =
  "resolution-status=open&resolution-status=reopened&resolution-status=resolved&resolution-status=dangling";
const MENTION = /ri:(?:account-id|userkey)="([^"]{1,255})"/g;
const PROGRESS_STEP = 10;

type Step =
  | "space"
  | "pages"
  | "blogPosts"
  | "details"
  | "nodes"
  | "permissions"
  | "people"
  | "templates"
  | "done";

interface Checkpoint {
  step: Step;
  next: string | null;
  after: string | null;
}

interface StagedNode {
  type?: string;
  sourceType?: string;
  parentType?: string;
  title: string;
}

function nodeCollection(node: StagedNode): string | null {
  const type = node.type === "other" ? node.sourceType : node.type;
  return NODE_COLLECTIONS[type ?? ""] ?? null;
}

function person(accountId: string | null | undefined): string | null {
  return accountId?.trim() || null;
}

function cloudDate(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? confluenceDate(String(value)) : parsed.toISOString();
}

function nextPath(next: string | null | undefined): string | null {
  if (!next) return null;
  const path = next.startsWith("/wiki/") ? next.slice("/wiki".length) : next;
  if (path.startsWith("/api/v2/") || path.startsWith("/rest/api/")) return path;
  throw new ImportFormatError("confluenceInvalidResponse", "Confluence sent a link Pagehall cannot follow.");
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function* listing<T>(
  api: ConfluenceApi,
  context: ScanContext,
  first: string,
  schema: z.ZodType<{ results: T[]; _links?: { next?: string | null | undefined } | undefined }>,
  refused?: () => Promise<void>,
): AsyncGenerator<T> {
  const guard = new ListingGuard(first, reportStoppedListing(context));
  for (let path: string | null = first; path; ) {
    const page = await api.json(path, schema);
    if (!page) {
      if (path === first) await refused?.();
      return;
    }
    for (const item of page.results) yield item;
    path = await guard.follow(nextPath(page._links?.next));
  }
}

export async function scanCloud(api: ConfluenceApi, context: ScanContext, spaceKey: string): Promise<void> {
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
  const selected = new Set((context.options.pageIds ?? []).filter((value) => /^\d{1,19}$/.test(value)));

  if (checkpoint.step === "space") {
    const found = await api.json(
      `/api/v2/spaces?description-format=plain&include-icon=true&keys=${encodeURIComponent(spaceKey)}`,
      listOf(spaceSchema),
    );
    const space = found?.results.find((candidate) => candidate.key === spaceKey);
    if (!space) {
      throw new ImportFormatError(
        "confluenceSpaceMissing",
        "The space does not exist or the token cannot read it.",
      );
    }
    await context.staging.put({
      kind: kinds.space,
      sourceId: space.id,
      data: {
        key: space.key,
        name: space.name,
        homePageId: space.homepageId ?? null,
        description: space.description?.plain?.value.replace(/\s+/g, " ").trim().slice(0, 1000) || null,
      },
    });
    await context.problem("likesAndWatchersSkipped", {});
    await save({ step: "pages", next: null, after: null });
  }
  const space = (await (async () => {
    for await (const record of context.staging.iterate<{ key: string; name: string }>(kinds.space))
      return record;
    return null;
  })()) ?? { sourceId: "", data: { key: spaceKey, name: "" } };

  const stageNode = async (node: z.infer<typeof nodeSchema>, type: string, blog: boolean) => {
    const state = (node.status ?? "current").toLowerCase();
    const title = node.title.trim();
    if (state === "trashed") {
      await stageTrashed(context.staging, node.id, title, space.sourceId);
      return;
    }
    if (state !== "current" && state !== "archived") return;
    const created = cloudDate(node.createdAt);
    if (type === "embed" && node.embedUrl) {
      await context.staging.put({
        kind: kinds.body,
        sourceId: node.id,
        ref: node.id,
        data: { body: embedBody(node.embedUrl) },
      });
    }
    await context.staging.put({
      kind: kinds.page,
      sourceId: node.id,
      ref: titleKey(title),
      parentId: blog ? null : (node.parentId ?? null),
      sort: blog ? `2${created ?? ""}` : pageSort(node.position ?? null, title),
      data: {
        ...contentKind(type),
        ...(state === "archived" ? { archived: true } : {}),
        ...(!blog && node.parentType && node.parentType !== "page" ? { parentType: node.parentType } : {}),
        title,
        version: node.version?.number ?? 1,
        creatorKey: person(node.authorId),
        created,
        modifierKey: person(node.version?.authorId ?? node.authorId),
        modified: cloudDate(node.version?.createdAt ?? node.createdAt),
        spaceId: space.sourceId,
      },
    });
  };

  for (const [step, collection, then] of [
    ["pages", "pages", "blogPosts"],
    ["blogPosts", "blogposts", "details"],
  ] as const) {
    if (checkpoint.step !== step) continue;
    const wanted = collection === "pages" || (selected.size === 0 && context.options.blogPosts !== false);
    const first =
      collection === "pages"
        ? `/api/v2/spaces/${space.sourceId}/pages?depth=all&status=current&status=archived&status=trashed`
        : `/api/v2/spaces/${space.sourceId}/blogposts?status=current&status=trashed`;
    let path: string | null = wanted ? (checkpoint.next ?? first) : null;
    const guard = new ListingGuard(path ?? first, reportStoppedListing(context));
    let count = 0;
    while (path) {
      const page = await api.json(path, listOf(nodeSchema));
      if (!page) break;
      for (const node of page.results) {
        await stageNode(node, collection === "pages" ? "page" : "blogpost", collection === "blogposts");
        count += 1;
      }
      path = await guard.follow(nextPath(page._links?.next));
      if (!path) break;
      await context.progress({ done: count, total: count + page.results.length });
      await save({ step, next: path, after: null });
    }
    if (collection === "pages" && selected.size > 0) await keepSelected(api, context, selected, stageNode);
    await save({ step: then, next: null, after: null });
  }

  if (checkpoint.step === "details") {
    const total = await context.staging.count(kinds.page);
    let done = 0;
    for await (const record of context.staging.iterate<StagedNode>(kinds.page)) {
      done += 1;
      if (checkpoint.after !== null && record.sourceId <= checkpoint.after) continue;
      const type = record.data.type ?? "page";
      if (type === "page" || type === "blogPost") {
        await details(api, context, record.sourceId, record.data, type === "blogPost", stageNode);
      }
      if (done % PROGRESS_STEP === 0 || done === total) await context.progress({ done, total });
      await save({ step: "details", next: null, after: record.sourceId });
    }
    await save({ step: "nodes", next: null, after: null });
  }

  if (checkpoint.step === "nodes") {
    const visited = new Set<string>();
    for await (const record of context.staging.iterate(kinds.visited)) visited.add(record.sourceId);
    for (let found = true; found; ) {
      found = false;
      for await (const record of context.staging.iterate<StagedNode>(kinds.page)) {
        const collection = nodeCollection(record.data);
        if (!collection || visited.has(record.sourceId)) continue;
        for await (const child of listing(
          api,
          context,
          `/api/v2/${collection}/${record.sourceId}/direct-children`,
          listOf(childSchema),
        )) {
          if (child.type === "page" || (await context.staging.get(kinds.page, [child.id])).size > 0) continue;
          await stageChild(api, child, stageNode);
          found = true;
        }
        visited.add(record.sourceId);
        await context.staging.put({ kind: kinds.visited, sourceId: record.sourceId, data: {} });
        await context.staging.flush();
      }
    }
    await save({ step: "permissions", next: null, after: null });
  }

  if (checkpoint.step === "permissions") {
    const groups = new Map<string, string | null>();
    let read = false;
    const first = checkpoint.next ?? `/api/v2/spaces/${space.sourceId}/permissions`;
    const guard = new ListingGuard(first, reportStoppedListing(context));
    for (let path: string | null = first; path; ) {
      const page = await api.json(path, listOf(permissionSchema));
      if (!page) break;
      read = true;
      for (const permission of page.results) {
        const type = PERMISSION_TYPES[`${permission.operation.key}/${permission.operation.targetType}`];
        if (!type) continue;
        const principal = permission.principal;
        const kind = principal.type.toLowerCase();
        const base = `${permission.operation.key}/${permission.operation.targetType}`;
        if (kind === "user") {
          const key = person(principal.id);
          if (!key) continue;
          await context.staging.put({
            kind: kinds.spacePermission,
            sourceId: `${base}/user/${key}`,
            data: { spaceId: space.sourceId, type, group: null, userKey: key, allUsers: false },
          });
        } else if (kind === "group") {
          if (!groups.has(principal.id)) {
            const group = await api.json(
              `/rest/api/group/by-id?id=${encodeURIComponent(principal.id)}`,
              groupSchema,
            );
            groups.set(principal.id, group?.name.trim() || null);
          }
          const name = groups.get(principal.id);
          if (!name) continue;
          await context.staging.put({
            kind: kinds.spacePermission,
            sourceId: `${base}/group/${name.toLowerCase()}`,
            data: { spaceId: space.sourceId, type, group: name, userKey: null, allUsers: false },
          });
        } else if (kind === "access-class" && principal.id.toUpperCase() === "ALL_LICENSED_USERS") {
          await context.staging.put({
            kind: kinds.spacePermission,
            sourceId: `${base}/all`,
            data: { spaceId: space.sourceId, type, group: null, userKey: null, allUsers: true },
          });
        } else if (kind === "anonymous" || principal.id.toUpperCase() === "ANONYMOUS") {
          await context.staging.put({
            kind: kinds.spacePermission,
            sourceId: `${base}/anonymous`,
            data: { spaceId: space.sourceId, type, group: null, userKey: null, allUsers: false },
          });
        }
      }
      path = await guard.follow(nextPath(page._links?.next));
      if (path) await save({ step: "permissions", next: path, after: null });
    }
    if (!read) await context.problem("permissionsUnavailable", {});
    await save({ step: "people", next: null, after: null });
  }

  if (checkpoint.step === "people") {
    const referenced = await context.staging.distinctValues(
      [kinds.page, kinds.version, kinds.attachment, kinds.comment, kinds.spacePermission, kinds.restriction],
      ["creatorKey", "modifierKey", "authorKey", "userKey"],
    );
    const mentioned = await context.staging.distinctValues([kinds.mention], ["accountId"]);
    const wanted = [...new Set([...referenced, ...mentioned])];
    const known = await context.staging.get(kinds.user, wanted);
    for (const accountId of wanted) {
      if (!known.has(accountId))
        await context.staging.put({ kind: kinds.user, sourceId: accountId, data: { accountId } });
    }
    await save({ step: "templates", next: null, after: null });
  }

  if (checkpoint.step === "templates") {
    for await (const template of listing(
      api,
      context,
      `/rest/api/template/page?expand=body&limit=100&spaceKey=${encodeURIComponent(space.data.key)}&start=0`,
      listOf(templateSchema),
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
          spaceId: space.sourceId,
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
  await reportTrashed(context, space.sourceId);
}

async function keepSelected(
  api: ConfluenceApi,
  context: ScanContext,
  selected: ReadonlySet<string>,
  stageNode: (node: z.infer<typeof nodeSchema>, type: string, blog: boolean) => Promise<void>,
): Promise<void> {
  await context.staging.flush();
  const parents = new Map<string, string | null>();
  const containers = new Map<string, string>();
  for await (const record of context.staging.iterate<StagedNode>(kinds.page)) {
    parents.set(record.sourceId, record.parentId);
    if (record.parentId && record.data.parentType) containers.set(record.parentId, record.data.parentType);
  }
  for (let open = [...containers].filter(([id]) => !parents.has(id)); open.length > 0; ) {
    const next: [string, string][] = [];
    for (const [containerId, type] of open) {
      const collection = NODE_COLLECTIONS[type];
      const node = collection
        ? await api.json(`/api/v2/${collection}/${containerId}${NODE_QUERIES[collection] ?? ""}`, nodeSchema)
        : null;
      parents.set(containerId, node?.parentId ?? null);
      if (!node) continue;
      await stageNode(node, type, false);
      if (node.parentId && node.parentType && node.parentType !== "page" && !parents.has(node.parentId)) {
        next.push([node.parentId, node.parentType]);
      }
    }
    open = next;
  }
  const kept = (pageId: string) => {
    let current: string | null = pageId;
    for (let depth = 0; current !== null && depth < 1000; depth += 1) {
      if (selected.has(current)) return true;
      current = parents.get(current) ?? null;
    }
    return false;
  };
  await context.staging.removeIds(
    kinds.page,
    [...parents.keys()].filter((pageId) => !kept(pageId)),
  );
}

async function stageChild(
  api: ConfluenceApi,
  child: z.infer<typeof childSchema>,
  stageNode: (node: z.infer<typeof nodeSchema>, type: string, blog: boolean) => Promise<void>,
): Promise<void> {
  const collection = NODE_COLLECTIONS[child.type];
  const node = collection
    ? await api.json(`/api/v2/${collection}/${child.id}${NODE_QUERIES[collection] ?? ""}`, nodeSchema)
    : null;
  if (collection && !node) return;
  await stageNode(node ?? child, child.type, false);
}

async function details(
  api: ConfluenceApi,
  context: ScanContext,
  pageId: string,
  page: StagedNode,
  blog: boolean,
  stageNode: (node: z.infer<typeof nodeSchema>, type: string, blog: boolean) => Promise<void>,
): Promise<void> {
  const collection = blog ? "blogposts" : "pages";
  const skipped = async (part: string) => context.problem("contentSkipped", { title: page.title, part });
  const content = await api.json(
    `/api/v2/${collection}/${pageId}?body-format=storage&include-labels=true&include-properties=true&include-version=true&include-versions=true`,
    contentSchema,
  );
  if (!content) {
    await leaveOutUnreadablePage(context, pageId, page.title);
    return;
  }
  const body = content.body?.storage?.value;
  if (body !== undefined) {
    await context.staging.put({ kind: kinds.body, sourceId: pageId, ref: pageId, data: { body } });
    await stageMentions(context, body);
  }
  const labels = content.labels?.meta?.hasMore
    ? listing(api, context, `/api/v2/${collection}/${pageId}/labels`, listOf(labelSchema))
    : (content.labels?.results ?? []);
  for await (const label of labels) {
    const prefix = (label.prefix ?? "global").trim().toLowerCase();
    const name = label.name.trim();
    if (!name) continue;
    const labelId = `${prefix}:${name}`;
    await context.staging.put({ kind: kinds.label, sourceId: labelId, data: { name, namespace: prefix } });
    await context.staging.put({
      kind: kinds.labelling,
      sourceId: `${pageId}/${labelId}`,
      ref: pageId,
      data: { labelId },
    });
  }
  const properties = content.properties?.meta?.hasMore
    ? listing(api, context, `/api/v2/${collection}/${pageId}/properties`, listOf(propertySchema))
    : (content.properties?.results ?? []);
  for await (const property of properties) {
    if (property.key !== PAGE_STATUS_PROPERTY) continue;
    await context.staging.put({
      kind: kinds.property,
      sourceId: `${pageId}/${property.key}`,
      ref: pageId,
      data: {
        name: property.key,
        value: (typeof property.value === "string" ? property.value : JSON.stringify(property.value)).slice(
          0,
          2000,
        ),
      },
    });
  }
  if (!blog) {
    for await (const child of listing(
      api,
      context,
      `/api/v2/pages/${pageId}/direct-children`,
      listOf(childSchema),
    )) {
      if (child.type === "page") continue;
      if ((await context.staging.get(kinds.page, [child.id])).size > 0) continue;
      await stageChild(api, child, stageNode);
    }
  }
  await comments(api, context, pageId, collection, "footer-comments", () => skipped("comments"));
  await comments(api, context, pageId, collection, "inline-comments", () => skipped("comments"));
  await attachments(api, context, pageId, collection, () => skipped("attachments"));
  const restrictions = await unlessInvalid(
    api.json(
      `/rest/api/content/${pageId}/restriction?expand=restrictions.user,restrictions.group,content`,
      restrictionSchema,
    ),
  );
  if (!restrictions) await keepRestricted(context, pageId, page.title, "restrictions");
  for (const entry of restrictions?.results ?? []) {
    const kind = entry.operation === "read" ? "view" : entry.operation === "update" ? "edit" : null;
    if (!kind) continue;
    for (const user of entry.restrictions?.user?.results ?? []) {
      const key = user.type === "anonymous" ? null : person(user.accountId);
      if (!key) continue;
      await context.staging.put({
        kind: kinds.restriction,
        sourceId: `${pageId}/${kind}/user/${key}`,
        ref: pageId,
        data: { kind, origin: "table", userKey: key, accountId: key, group: null },
      });
    }
    for (const group of entry.restrictions?.group?.results ?? []) {
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
  if (context.history) await history(api, context, pageId, collection, content.version?.number ?? 1);
}

async function stageMentions(context: ScanContext, body: string): Promise<void> {
  for (const match of body.matchAll(MENTION)) {
    const accountId = match[1] ?? "";
    await context.staging.put({ kind: kinds.mention, sourceId: accountId, data: { accountId } });
  }
}

async function comments(
  api: ConfluenceApi,
  context: ScanContext,
  pageId: string,
  collection: string,
  kind: "footer-comments" | "inline-comments",
  refused: () => Promise<void>,
): Promise<void> {
  const inline = kind === "inline-comments";
  const first = `/api/v2/${collection}/${pageId}/${kind}?body-format=storage${inline ? `&${RESOLUTION_STATUSES}` : ""}`;
  const queue: string[] = [];
  for await (const comment of listing(api, context, first, listOf(commentSchema), refused))
    queue.push(comment.id);
  for (let index = 0; index < queue.length; index += 1) {
    const commentId = queue[index] as string;
    const comment = await api.json(
      `/api/v2/${kind}/${commentId}?body-format=storage&include-properties=true&include-versions=true`,
      commentSchema,
    );
    if (!comment || (comment.status ?? "current") !== "current") continue;
    const versions = [...(comment.versions?.results ?? [])].sort((left, right) => left.number - right.number);
    const created = cloudDate(versions[0]?.createdAt ?? comment.version?.createdAt);
    const parentId = comment.parentCommentId ?? null;
    await context.staging.put({
      kind: kinds.comment,
      sourceId: comment.id,
      ref: pageId,
      parentId,
      sort: created ?? "",
      data: {
        creatorKey: person(versions[0]?.authorId ?? comment.version?.authorId),
        created,
        modified: cloudDate(comment.version?.createdAt),
      },
    });
    const body = comment.body?.storage?.value;
    if (body !== undefined) {
      await context.staging.put({ kind: kinds.body, sourceId: comment.id, ref: comment.id, data: { body } });
      await stageMentions(context, body);
    }
    const own = (comment.properties ?? {}) as Record<string, unknown>;
    const string = (value: unknown) => (typeof value === "string" ? value : null);
    const status = (comment.resolutionStatus ?? "").toLowerCase();
    const properties: [string, string | null][] = inline
      ? [
          ["inline-comment", parentId === null ? "true" : null],
          ["inline-marker-ref", string(own.inlineMarkerRef) ?? string(own["inline-marker-ref"])],
          [
            "inline-original-selection",
            string(own.inlineOriginalSelection) ?? string(own["inline-original-selection"]),
          ],
          ["status", status === "reopened" ? "open" : status || null],
          ["status-lastmodifier", status === "resolved" ? person(comment.resolutionLastModifierId) : null],
          ["status-lastmoddate", status === "resolved" ? cloudDate(comment.resolutionLastModifiedAt) : null],
        ]
      : [];
    for (const [name, value] of properties) {
      if (!value) continue;
      await context.staging.put({
        kind: kinds.property,
        sourceId: `${comment.id}/${name}`,
        ref: comment.id,
        data: { name, value: value.slice(0, 2000) },
      });
    }
    for await (const child of listing(
      api,
      context,
      `/api/v2/${kind}/${commentId}/children?body-format=storage`,
      listOf(commentSchema),
    )) {
      if (!queue.includes(child.id)) queue.push(child.id);
    }
  }
}

async function attachments(
  api: ConfluenceApi,
  context: ScanContext,
  pageId: string,
  collection: string,
  refused: () => Promise<void>,
): Promise<void> {
  for await (const attachment of listing(
    api,
    context,
    `/api/v2/${collection}/${pageId}/attachments`,
    listOf(attachmentSchema),
    refused,
  )) {
    const owner = attachment.id.slice(3);
    const current = attachment.version?.number ?? 1;
    const versions = [];
    for await (const version of listing(
      api,
      context,
      `/api/v2/attachments/${attachment.id}/versions`,
      listOf(versionSchema),
    )) {
      versions.push(version);
    }
    if (!versions.some((version) => version.number === current)) {
      versions.push({
        number: current,
        authorId: attachment.version?.authorId,
        createdAt: attachment.version?.createdAt,
      });
    }
    for (const version of versions) {
      const sourceId = version.number === current ? owner : `${owner}v${version.number}`;
      await context.staging.put({
        kind: kinds.attachment,
        sourceId,
        ref: owner,
        data: {
          pageId,
          originalId: version.number === current ? null : owner,
          fileName: attachment.title.trim(),
          version: version.number,
          creatorKey: person(version.authorId),
          created: cloudDate(version.createdAt),
        },
      });
      await context.staging.put({
        kind: kinds.file,
        sourceId: `attachments/${pageId}/${owner}/${version.number}`,
        data: {
          size: version.number === current ? (attachment.fileSize ?? 0) : 0,
          download: `/rest/api/content/${pageId}/child/attachment/${attachment.id}/download?version=${version.number}`,
        },
      });
    }
  }
}

async function history(
  api: ConfluenceApi,
  context: ScanContext,
  pageId: string,
  collection: string,
  current: number,
): Promise<void> {
  for await (const version of listing(
    api,
    context,
    `/api/v2/${collection}/${pageId}/versions?body-format=storage`,
    listOf(historySchema),
  )) {
    if (version.number >= current || version.number < 1) continue;
    const snapshot = version.page ?? version.blogpost;
    const sourceId = `${pageId}v${version.number}`;
    const title = (snapshot?.title ?? "").trim();
    await context.staging.put({
      kind: kinds.version,
      sourceId,
      ref: pageId,
      sort: versionSort(version.number),
      data: {
        title,
        version: version.number,
        authorKey: person(version.authorId),
        created: cloudDate(version.createdAt),
      },
    });
    const body = snapshot?.body?.storage?.value;
    if (body !== undefined)
      await context.staging.put({ kind: kinds.body, sourceId, ref: sourceId, data: { body } });
    if (title) await context.staging.put(formerTitleRecord(pageId, title));
  }
}

function embedBody(url: string): string {
  const safe = escapeHtml(url);
  return `<a href="${safe}" data-card-appearance="embed">${safe}</a>`;
}
