import { Readable } from "node:stream";
import type { ConfluenceTransport, TransportRequest, TransportResponse } from "../confluence/api-client.js";
import type { SyntheticExport, SyntheticPage, SyntheticUser } from "./confluence-export.js";

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

  async function get(raw: string, request: TransportRequest): Promise<TransportResponse> {
    const url = new URL(raw);
    requests.push(url.toString());
    const before = options.before?.(url, requests.length);
    if (before) return before;
    if (url.host === "api.media.atlassian.com") {
      const data = file(url.searchParams.get("page") ?? "", url.searchParams.get("name") ?? "");
      return data ? { status: 200, headers: {}, body: Readable.from([data]) } : response(404);
    }
    if (url.host !== options.site || !url.pathname.startsWith(base)) return response(404);
    if (request.headers.Authorization !== options.authorization) return response(401);
    const path = url.pathname.slice(base.length);
    const segments = path.split("/").filter(Boolean).map(decodeURIComponent);
    const restricted = (id: string) => options.restricted?.has(id) ?? false;
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
