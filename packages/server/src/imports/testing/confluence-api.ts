import { Readable } from "node:stream";
import type { ConfluenceTransport, TransportRequest, TransportResponse } from "../confluence/api-client.js";
import type { SyntheticComment, SyntheticExport, SyntheticPage, SyntheticUser } from "./confluence-export.js";

const DATE = "2024-03-01T10:20:30.123Z";
const RESOLVED = new Date(Date.UTC(2024, 3, 2, 8, 0, 0)).toISOString();

const OPERATIONS: Readonly<Record<string, [string, string]>> = {
  VIEWSPACE: ["read", "space"],
  EDITSPACE: ["create", "page"],
  EDITBLOG: ["create", "blogpost"],
  COMMENT: ["create", "comment"],
  CREATEATTACHMENT: ["create", "attachment"],
  REMOVEPAGE: ["delete", "page"],
  REMOVEBLOG: ["delete", "blogpost"],
  REMOVECOMMENT: ["delete", "comment"],
  REMOVEATTACHMENT: ["delete", "attachment"],
  SETPAGEPERMISSIONS: ["restrict_content", "space"],
  SETSPACEPERMISSIONS: ["administer", "space"],
  EXPORTSPACE: ["export", "space"],
};

const V2_OPERATIONS: Readonly<Record<string, [string, string]>> = {
  ...OPERATIONS,
  SETPAGEPERMISSIONS: ["restrict_content", "space"],
  SETSPACEPERMISSIONS: ["administer", "space"],
};

export interface FakeConfluenceOptions {
  readonly kind: "cloud" | "dataCenter";
  readonly site: string;
  readonly basePath?: string;
  readonly authorization: string;
  readonly users?: Readonly<Record<string, { name: string; email?: string }>>;
  readonly before?: (url: URL, count: number) => TransportResponse | null;
  readonly restricted?: ReadonlySet<string>;
  readonly pageSize?: number;
}

export interface FakeConfluence extends ConfluenceTransport {
  readonly requests: string[];
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): TransportResponse {
  return {
    status,
    headers: { "content-type": "application/json", ...headers },
    body: Readable.from([Buffer.from(JSON.stringify(body))]),
  };
}

export function response(status: number, headers: Record<string, string> = {}): TransportResponse {
  return json(status, {}, headers);
}

export function fakeConfluence(model: SyntheticExport, options: FakeConfluenceOptions): FakeConfluence {
  const cloud = options.kind === "cloud";
  const base = cloud ? "/wiki" : (options.basePath ?? "");
  const size = options.pageSize ?? 2;
  const requests: string[] = [];
  const userByKey = new Map(model.users.map((user) => [user.key, user]));
  const userJson = (key: string | undefined | null) => {
    const user: SyntheticUser | undefined = key ? userByKey.get(key) : undefined;
    if (!user) return null;
    const known = options.users?.[user.accountId];
    return cloud
      ? {
          type: "known",
          accountId: user.accountId,
          ...(known ? { displayName: known.name, ...(known.email ? { email: known.email } : {}) } : {}),
        }
      : { type: "known", userKey: user.key, username: user.key, displayName: known?.name ?? user.key };
  };
  const current = (page: SyntheticPage) => (page.status ?? "current") === "current";
  const inSpace = (page: SyntheticPage) => (page.spaceId ?? model.space.id) === model.space.id;
  const pages = model.pages.filter((page) => current(page) && inSpace(page));
  const blogPosts = (model.blogPosts ?? []).filter(current);
  const all = new Map([...pages, ...blogPosts].map((page) => [page.id, page]));
  const ancestors = (page: SyntheticPage) => {
    const chain: { id: string; type: string }[] = [];
    let parent = page.parentId;
    for (let depth = 0; parent && depth < 50; depth += 1) {
      const found = model.pages.find((candidate) => candidate.id === parent);
      if (!found) break;
      chain.unshift({ id: found.id, type: "page" });
      parent = found.parentId;
    }
    return chain;
  };
  const content = (page: SyntheticPage, type: "page" | "blogpost") => ({
    id: page.id,
    type,
    status: "current",
    title: page.title,
    ancestors: type === "page" ? ancestors(page) : [],
    version: {
      number: page.version ?? (page.history?.length ?? 0) + 1,
      when: page.modified ? `${page.modified.replace(" ", "T")}Z` : DATE,
      by: userJson(page.modifierKey ?? page.creatorKey),
    },
    history: {
      createdBy: userJson(page.creatorKey),
      createdDate: page.created ? `${page.created.replace(" ", "T")}Z` : DATE,
    },
    body: { storage: { value: page.body, representation: "storage" } },
    metadata: { labels: { results: (page.labels ?? []).map((name) => ({ prefix: "global", name })) } },
    extensions: type === "page" ? { position: page.position ?? "none" } : {},
    _links: { webui: `/spaces/${model.space.key}/pages/${page.id}` },
  });
  const paged = (url: URL, items: unknown[]) => {
    const start = Number(url.searchParams.get("start") ?? 0);
    const limit = Math.min(Number(url.searchParams.get("limit") ?? size), size);
    const slice = items.slice(start, start + limit);
    const next = new URL(url.toString());
    next.searchParams.set("start", String(start + limit));
    const relative = `${next.pathname.slice(base.length)}${next.search}`;
    return json(200, {
      results: slice,
      start,
      limit,
      size: slice.length,
      _links: {
        base: `https://${options.site}${base}`,
        ...(start + limit < items.length ? { next: relative } : {}),
      },
    });
  };
  const comments = (pageId: string) =>
    (model.comments ?? [])
      .filter((comment) => comment.pageId === pageId)
      .map((comment) => {
        const chain: { id: string; type: string }[] = [];
        let parent = comment.parentId;
        while (parent) {
          chain.unshift({ id: parent, type: "comment" });
          parent = model.comments?.find((candidate) => candidate.id === parent)?.parentId;
        }
        return {
          id: comment.id,
          type: "comment",
          status: "current",
          title: `Re: ${pageId}`,
          ancestors: chain,
          version: { number: 1, when: comment.created ? `${comment.created.replace(" ", "T")}Z` : DATE },
          history: {
            createdBy: userJson(comment.creatorKey),
            createdDate: comment.created ? `${comment.created.replace(" ", "T")}Z` : DATE,
          },
          body: { storage: { value: comment.body } },
          extensions: {
            location: comment.inline ? "inline" : "footer",
            ...(comment.inline
              ? {
                  inlineProperties: {
                    markerRef: comment.inline.markerRef,
                    originalSelection: comment.inline.selection,
                  },
                }
              : {}),
            ...(comment.status
              ? {
                  resolution: {
                    status: comment.status,
                    ...(comment.status === "resolved"
                      ? {
                          lastModifier: userJson(comment.resolverKey ?? comment.creatorKey),
                          lastModifiedDate: RESOLVED,
                        }
                      : {}),
                  },
                }
              : {}),
          },
        };
      });
  const attachments = (pageId: string) =>
    model.attachments
      .filter((attachment) => attachment.pageId === pageId && !attachment.missingFile)
      .flatMap((attachment) => {
        const latest = attachment.versions.at(-1);
        if (!latest) return [];
        const data = typeof latest.data === "string" ? Buffer.from(latest.data) : latest.data;
        return [
          {
            id: `att${latest.id}`,
            type: "attachment",
            status: "current",
            title: attachment.fileName,
            version: { number: latest.version, when: DATE, by: userJson(model.users[0]?.key) },
            history: { createdBy: userJson(model.users[0]?.key), createdDate: DATE },
            extensions: { fileSize: data.length, mediaType: "application/octet-stream" },
            _links: {
              download: `/download/attachments/${pageId}/${encodeURIComponent(attachment.fileName)}?version=${latest.version}&api=v2`,
            },
          },
        ];
      });
  const file = (pageId: string, name: string) => {
    const attachment = model.attachments.find(
      (candidate) => candidate.pageId === pageId && candidate.fileName === name,
    );
    const latest = attachment?.versions.at(-1);
    return latest ? (typeof latest.data === "string" ? Buffer.from(latest.data) : latest.data) : null;
  };
  const restrictions = (pageId: string) => {
    const entry = (kind: "View" | "Edit", operation: string) => {
      const own = (model.restrictions ?? []).filter(
        (restriction) => restriction.contentId === pageId && restriction.kind === kind,
      );
      return {
        operation,
        restrictions: {
          user: {
            results: own.flatMap((restriction) =>
              restriction.userKey ? [userJson(restriction.userKey)] : [],
            ),
          },
          group: {
            results: own.flatMap((restriction) => (restriction.group ? [{ name: restriction.group }] : [])),
          },
        },
      };
    };
    return { read: entry("View", "read"), update: entry("Edit", "update") };
  };
  const permissions = () =>
    (model.spacePermissions ?? []).flatMap((permission) => {
      const operation = OPERATIONS[permission.type];
      if (!operation) return [];
      return [
        {
          operation: { operation: operation[0], targetType: operation[1] },
          anonymousAccess: !permission.group && !permission.userKey && !permission.allUsers,
          subjects: {
            user: { results: permission.userKey ? [userJson(permission.userKey)] : [] },
            group: { results: permission.group ? [{ name: permission.group }] : [] },
          },
        },
      ];
    });

  const isoDate = (value: string | undefined) => (value ? `${value.replace(" ", "T")}Z` : DATE);
  const accountOf = (key: string | undefined | null) =>
    key ? (userByKey.get(key)?.accountId ?? null) : null;
  const everything = [...model.pages.filter(inSpace), ...(model.blogPosts ?? [])];
  const v2Status = (page: SyntheticPage) =>
    page.status === "deleted"
      ? "trashed"
      : page.status === "archived"
        ? "archived"
        : (page.status ?? "current");
  const v2Node = (page: SyntheticPage, type: string) => ({
    id: page.id,
    type,
    status: v2Status(page),
    title: page.title,
    parentId: type === "blogpost" ? null : page.parentId,
    parentType: page.parentId
      ? (model.pages.find((parent) => parent.id === page.parentId)?.kind ?? "page")
      : null,
    position: page.position,
    authorId: accountOf(page.creatorKey),
    createdAt: isoDate(page.created),
    version: {
      number: page.version ?? (page.history?.length ?? 0) + 1,
      authorId: accountOf(page.modifierKey ?? page.creatorKey),
      createdAt: isoDate(page.modified),
    },
    ...(page.kind === "embed" ? { embedUrl: /href="([^"]+)"/.exec(page.body)?.[1] ?? null } : {}),
  });
  const cursorPaged = (url: URL, items: unknown[]) => {
    const start = Number(url.searchParams.get("cursor") ?? 0);
    const slice = items.slice(start, start + size);
    const next = new URL(url.toString());
    next.searchParams.set("cursor", String(start + size));
    return json(200, {
      results: slice,
      _links: {
        base: `https://${options.site}${base}`,
        ...(start + size < items.length ? { next: `${next.pathname}${next.search}` } : {}),
      },
    });
  };
  const v2Comment = (comment: SyntheticComment) => ({
    id: comment.id,
    status: "current",
    pageId: comment.pageId,
    parentCommentId: comment.parentId ?? null,
    version: { number: 1, authorId: accountOf(comment.creatorKey), createdAt: isoDate(comment.created) },
    body: { storage: { value: comment.body, representation: "storage" } },
    ...(comment.inline
      ? {
          resolutionStatus: comment.status ?? "open",
          ...(comment.status === "resolved"
            ? {
                resolutionLastModifierId: accountOf(comment.resolverKey ?? comment.creatorKey),
                resolutionLastModifiedAt: RESOLVED,
              }
            : {}),
          properties: {
            inlineMarkerRef: comment.inline.markerRef,
            inlineOriginalSelection: comment.inline.selection,
          },
        }
      : {}),
    versions: {
      results: [{ number: 1, authorId: accountOf(comment.creatorKey), createdAt: isoDate(comment.created) }],
    },
  });
  const v2Attachments = (pageId: string) =>
    model.attachments
      .filter((attachment) => attachment.pageId === pageId && !attachment.missingFile)
      .flatMap((attachment) => {
        const latest = attachment.versions.at(-1);
        if (!latest) return [];
        const data = typeof latest.data === "string" ? Buffer.from(latest.data) : latest.data;
        return [
          {
            id: `att${latest.id}`,
            title: attachment.fileName,
            fileSize: data.length,
            version: { number: latest.version, authorId: accountOf(model.users[0]?.key), createdAt: DATE },
          },
        ];
      });
  const versionData = (pageId: string, name: string, version: number | null) => {
    const attachment = model.attachments.find(
      (candidate) => candidate.pageId === pageId && candidate.fileName === name,
    );
    const found = version
      ? attachment?.versions.find((candidate) => candidate.version === version)
      : attachment?.versions.at(-1);
    return found ? (typeof found.data === "string" ? Buffer.from(found.data) : found.data) : null;
  };

  function v2(url: URL, path: string, segments: string[]): TransportResponse | null {
    const restricted = (key: string) => options.restricted?.has(key) ?? false;
    if (path === "/api/v2/spaces") {
      const keys = url.searchParams.get("keys") ?? "";
      return json(200, {
        results:
          keys === model.space.key
            ? [
                {
                  id: model.space.id,
                  key: model.space.key,
                  name: model.space.name,
                  homepageId: model.space.homePageId,
                  ...(model.space.description === undefined
                    ? {}
                    : {
                        description: { plain: { value: model.space.description, representation: "plain" } },
                      }),
                },
              ]
            : [],
        _links: {},
      });
    }
    if (segments[2] === "spaces" && segments[3] === model.space.id) {
      const statuses = url.searchParams.getAll("status");
      const listed = (page: SyntheticPage) => statuses.includes(v2Status(page)) && !restricted(page.id);
      if (segments[4] === "pages") {
        return cursorPaged(
          url,
          model.pages
            .filter(
              (page) => inSpace(page) && page.kind === undefined && page.status !== "draft" && listed(page),
            )
            .map((page) => v2Node(page, "page")),
        );
      }
      if (segments[4] === "blogposts") {
        return cursorPaged(
          url,
          (model.blogPosts ?? []).filter(listed).map((page) => v2Node(page, "blogpost")),
        );
      }
      if (segments[4] === "permissions") {
        return cursorPaged(
          url,
          (model.spacePermissions ?? []).flatMap((permission) => {
            const operation = V2_OPERATIONS[permission.type];
            if (!operation) return [];
            const principal = permission.userKey
              ? { type: "user", id: accountOf(permission.userKey) }
              : permission.group
                ? { type: "group", id: permission.group }
                : permission.allUsers
                  ? {
                      type: "access-class",
                      id:
                        permission.allUsers === "productAdmins" ? "ALL_PRODUCT_ADMINS" : "ALL_LICENSED_USERS",
                    }
                  : { type: "anonymous", id: "ANONYMOUS" };
            return [{ principal, operation: { key: operation[0], targetType: operation[1] } }];
          }),
        );
      }
      return response(404);
    }
    const collection = segments[2] ?? "";
    const id = segments[3] ?? "";
    if (["pages", "blogposts"].includes(collection) && id) {
      const page = everything.find((candidate) => candidate.id === id);
      if (!page || restricted(id) || restricted(`${id}/${segments[4] ?? ""}`)) return response(403);
      const type = collection === "pages" ? "page" : "blogpost";
      if (segments[4] === undefined) {
        return json(200, {
          ...v2Node(page, type),
          body: { storage: { value: page.body, representation: "storage" } },
          labels: {
            results: (page.labels ?? []).map((name) => ({ prefix: "global", name })),
            meta: { hasMore: false },
          },
          properties: {
            results:
              page.pageStatus === undefined
                ? []
                : [{ key: "content-state-published", value: page.pageStatus }],
            meta: { hasMore: false },
          },
        });
      }
      if (segments[4] === "direct-children") {
        return cursorPaged(
          url,
          model.pages
            .filter((child) => child.parentId === id && inSpace(child) && child.status !== "deleted")
            .map((child) => ({
              id: child.id,
              type: child.kind ?? "page",
              status: v2Status(child),
              title: child.title,
            })),
        );
      }
      if (segments[4] === "footer-comments" || segments[4] === "inline-comments") {
        const inline = segments[4] === "inline-comments";
        return cursorPaged(
          url,
          (model.comments ?? [])
            .filter(
              (comment) => comment.pageId === id && !comment.parentId && Boolean(comment.inline) === inline,
            )
            .map(v2Comment),
        );
      }
      if (segments[4] === "attachments") return cursorPaged(url, v2Attachments(id));
      if (segments[4] === "versions") {
        const total = page.version ?? (page.history?.length ?? 0) + 1;
        return cursorPaged(
          url,
          Array.from({ length: total }, (_, index) => {
            const number = total - index;
            const old = (page.history ?? [])[number - 1];
            return {
              number,
              authorId: accountOf(old?.authorKey ?? page.creatorKey),
              createdAt: old?.modified ? isoDate(old.modified) : DATE,
              [type]: {
                title: old?.title ?? page.title,
                body: { storage: { value: old?.body ?? page.body, representation: "storage" } },
              },
            };
          }),
        );
      }
      return response(404);
    }
    if (["folders", "whiteboards", "databases", "embeds"].includes(collection) && id) {
      const node = model.pages.find((candidate) => candidate.id === id && candidate.kind !== undefined);
      if (!node) return response(404);
      if (segments[4] === "direct-children") {
        return cursorPaged(
          url,
          model.pages
            .filter((child) => child.parentId === id && inSpace(child))
            .map((child) => ({
              id: child.id,
              type: child.kind ?? "page",
              status: v2Status(child),
              title: child.title,
            })),
        );
      }
      return json(200, v2Node(node, node.kind ?? "page"));
    }
    if ((collection === "footer-comments" || collection === "inline-comments") && id) {
      const comment = (model.comments ?? []).find((candidate) => candidate.id === id);
      if (!comment) return response(404);
      if (segments[4] === "children") {
        return cursorPaged(
          url,
          (model.comments ?? []).filter((candidate) => candidate.parentId === id).map(v2Comment),
        );
      }
      return json(200, v2Comment(comment));
    }
    if (collection === "attachments" && segments[4] === "versions") {
      const attachment = model.attachments.find((candidate) => `att${candidate.versions.at(-1)?.id}` === id);
      return cursorPaged(
        url,
        (attachment?.versions ?? []).map((version) => ({
          number: version.version,
          authorId: accountOf(model.users[0]?.key),
          createdAt: DATE,
        })),
      );
    }
    return null;
  }

  function cloudRest(url: URL, path: string, segments: string[]): TransportResponse | null {
    if (path === "/rest/api/group/by-id") return json(200, { name: url.searchParams.get("id") ?? "" });
    if (segments[2] === "content" && segments[4] === "restriction" && segments.length === 5) {
      const pageId = segments[3] ?? "";
      if (!all.has(pageId) || options.restricted?.has(`${pageId}/restriction`)) return response(403);
      const visible = (entry: ReturnType<typeof restrictions>["read"]) => ({
        ...entry,
        restrictions: {
          ...entry.restrictions,
          group: { results: entry.restrictions.group.results.filter((group) => group.name !== "tombstone") },
        },
      });
      const { read, update } = restrictions(pageId);
      return json(200, { results: [visible(read), visible(update)] });
    }
    if (
      segments[2] === "content" &&
      segments[4] === "child" &&
      segments[5] === "attachment" &&
      segments[7] === "download"
    ) {
      const pageId = segments[3] ?? "";
      const attachment = model.attachments.find(
        (candidate) => candidate.pageId === pageId && `att${candidate.versions.at(-1)?.id}` === segments[6],
      );
      if (!attachment) return response(404);
      const version = url.searchParams.get("version") ?? "";
      return {
        status: 302,
        headers: {
          location: `https://api.media.atlassian.com/file/binary?page=${pageId}&name=${encodeURIComponent(attachment.fileName)}&version=${version}&token=short-lived`,
        },
        body: Readable.from([]),
      };
    }
    return null;
  }

  async function get(raw: string, request: TransportRequest): Promise<TransportResponse> {
    const url = new URL(raw);
    requests.push(url.toString());
    const before = options.before?.(url, requests.length);
    if (before) return before;
    if (url.host === "api.media.atlassian.com") {
      const version = Number(url.searchParams.get("version") ?? 0);
      const data = versionData(
        url.searchParams.get("page") ?? "",
        url.searchParams.get("name") ?? "",
        version || null,
      );
      return data ? { status: 200, headers: {}, body: Readable.from([data]) } : response(404);
    }
    if (url.host !== options.site || !url.pathname.startsWith(base)) return response(404);
    if (request.headers.Authorization !== options.authorization) return response(401);
    const path = url.pathname.slice(base.length);
    const segments = path.split("/").filter(Boolean).map(decodeURIComponent);
    const restricted = (id: string) => options.restricted?.has(id) ?? false;
    if (cloud) {
      const answer = path.startsWith("/api/v2/") ? v2(url, path, segments) : cloudRest(url, path, segments);
      if (answer) return answer;
    }
    if (path === "/rest/api/user/current") {
      return json(
        200,
        cloud
          ? { type: "known", accountId: "557058:importer", displayName: "Importer" }
          : { type: "known", userKey: "importer", username: "importer", displayName: "Importer" },
      );
    }
    if (path === "/rest/applinks/1.0/manifest") return json(200, { version: "8.5.4" });
    if (path === "/rest/api/space") {
      return paged(url, [
        { id: Number(model.space.id), key: model.space.key, name: model.space.name, type: "global" },
      ]);
    }
    if (segments[0] === "rest" && segments[2] === "space" && segments.length === 4) {
      if (segments[3] !== model.space.key) return response(404);
      const expand = url.searchParams.get("expand") ?? "";
      return json(200, {
        id: Number(model.space.id),
        key: model.space.key,
        name: model.space.name,
        homepage: { id: model.space.homePageId },
        ...(expand.includes("permissions") ? { permissions: permissions() } : {}),
      });
    }
    if (path === "/rest/api/content") {
      if (url.searchParams.get("spaceKey") !== model.space.key) return paged(url, []);
      const type = url.searchParams.get("type") === "blogpost" ? "blogpost" : "page";
      const list = (type === "page" ? pages : blogPosts).filter((page) => !restricted(page.id));
      return paged(
        url,
        list.map((page) => content(page, type)),
      );
    }
    if (path === "/rest/api/content/search") {
      if (!(url.searchParams.get("cql") ?? "").includes("type=attachment")) return paged(url, []);
      return paged(
        url,
        pages.flatMap((page) =>
          attachments(page.id).map((attachment) => ({
            ...attachment,
            container: { id: page.id, type: "page" },
          })),
        ),
      );
    }
    if (path === "/rest/api/template/page") {
      return paged(
        url,
        (model.templates ?? [])
          .filter(
            (template) =>
              !template.previousVersionOf &&
              (template.spaceId === undefined || template.spaceId === model.space.id),
          )
          .map((template) => ({
            templateId: template.id,
            name: template.name,
            description: template.description ?? "",
            body: { storage: { value: template.body } },
          })),
      );
    }
    if (segments[0] === "rest" && segments[2] === "content" && segments[3]) {
      const id = segments[3];
      if (!all.has(id) || restricted(`${id}/${segments[4] ?? ""}`)) return response(403);
      if (segments[4] === "child" && segments[5] === "comment") return paged(url, comments(id));
      if (segments[4] === "child" && segments[5] === "attachment") return paged(url, attachments(id));
      if (segments[4] === "restriction") return json(200, restrictions(id));
      const page = all.get(id) as SyntheticPage;
      if (segments[4] === "version") {
        const total = page.version ?? (page.history?.length ?? 0) + 1;
        return paged(
          url,
          Array.from({ length: total }, (_, index) => ({
            number: total - index,
            when: (page.history ?? [])[total - index - 1]?.modified ?? DATE,
            by: userJson((page.history ?? [])[total - index - 1]?.authorKey ?? page.creatorKey),
          })),
        );
      }
      const number = Number(url.searchParams.get("version") ?? 0);
      const old = url.searchParams.get("status") === "historical" ? page.history?.[number - 1] : undefined;
      if (old) {
        return json(200, {
          ...content(page, "page"),
          title: old.title ?? page.title,
          version: { number },
          body: { storage: { value: old.body } },
        });
      }
      return json(200, content(page, "page"));
    }
    if (segments[0] === "api" && segments[1] === "v2" && segments[4] === "likes") {
      const id = segments[3] ?? "";
      return paged(
        url,
        (model.likes ?? [])
          .filter((like) => like.contentId === id)
          .flatMap((like) => {
            const user = userByKey.get(like.userKey);
            return user ? [{ accountId: user.accountId }] : [];
          }),
      );
    }
    if (segments[0] === "download" && segments[1] === "attachments") {
      const pageId = segments[2] ?? "";
      const name = segments[3] ?? "";
      if (cloud) {
        return {
          status: 302,
          headers: {
            location: `https://api.media.atlassian.com/file/binary?page=${pageId}&name=${encodeURIComponent(name)}&token=short-lived`,
          },
          body: Readable.from([]),
        };
      }
      const data = file(pageId, name);
      return data ? { status: 200, headers: {}, body: Readable.from([data]) } : response(404);
    }
    return response(404);
  }

  return { requests, get };
}

export function fakeConfluenceSpaces(
  models: readonly SyntheticExport[],
  options: FakeConfluenceOptions,
): FakeConfluence {
  const fakes = models.map((model) => ({
    model,
    fake: fakeConfluence(model, options),
    ids: new Set([
      model.space.id,
      ...[...model.pages, ...(model.blogPosts ?? [])].map((page) => page.id),
      ...(model.comments ?? []).map((comment) => comment.id),
      ...model.attachments.flatMap((attachment) => attachment.versions.map((version) => version.id)),
    ]),
  }));
  const requests: string[] = [];
  const byKey = (key: string | null | undefined) => fakes.find((entry) => entry.model.space.key === key);
  const byId = (id: string | null | undefined) => fakes.find((entry) => id && entry.ids.has(id));

  async function get(raw: string, request: TransportRequest): Promise<TransportResponse> {
    const url = new URL(raw);
    requests.push(url.toString());
    const segments = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    if (url.pathname.endsWith("/rest/api/space")) {
      const results: unknown[] = [];
      for (const entry of fakes) {
        const listed = await entry.fake.get(raw, request);
        if (listed.status !== 200) return listed;
        const chunks: Buffer[] = [];
        for await (const chunk of listed.body) chunks.push(Buffer.from(chunk as Buffer));
        results.push(
          ...(JSON.parse(Buffer.concat(chunks).toString("utf8")) as { results: unknown[] }).results,
        );
      }
      return json(200, { results, size: results.length, _links: {} });
    }
    const cqlSpace = /space="([^"]+)"/.exec(url.searchParams.get("cql") ?? "")?.[1];
    const spaceIndex = segments.indexOf("space");
    const pathId = (
      [
        "content",
        "pages",
        "blogposts",
        "attachments",
        "spaces",
        "footer-comments",
        "inline-comments",
        "folders",
        "whiteboards",
        "databases",
        "embeds",
      ] as const
    )
      .map((segment) => segments[segments.indexOf(segment) + 1]?.replace(/^att/, ""))
      .find((id) => id && /^\d+$/.test(id));
    const target =
      byKey(url.searchParams.get("spaceKey")) ??
      byKey(url.searchParams.get("keys")) ??
      byKey(cqlSpace) ??
      (spaceIndex >= 0 ? byKey(segments[spaceIndex + 1]) : undefined) ??
      byId(url.searchParams.get("page")) ??
      byId(pathId) ??
      fakes[0];
    if (!target) return response(404);
    return target.fake.get(raw, request);
  }

  return { requests, get };
}
