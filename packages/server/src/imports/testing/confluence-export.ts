import { gzipSync } from "node:zlib";
import { escapeXml } from "../formats/escape.js";
import { createZip, type ZipFileSpec } from "./zip-writer.js";

export interface SyntheticUser {
  readonly key: string;
  readonly accountId: string;
}

export interface SyntheticVersion {
  readonly id: string;
  readonly body: string;
  readonly title?: string;
  readonly authorKey?: string;
  readonly modified?: string;
}

export interface SyntheticPage {
  readonly id: string;
  readonly title: string;
  readonly parentId: string | null;
  readonly position: number | null;
  readonly body: string;
  readonly creatorKey: string;
  readonly labels?: readonly string[];
  readonly status?: "current" | "deleted" | "draft";
  readonly history?: readonly SyntheticVersion[];
  readonly spaceId?: string;
  readonly created?: string;
  readonly modified?: string;
  readonly modifierKey?: string;
}

export interface SyntheticAttachmentVersion {
  readonly id: string;
  readonly version: number;
  readonly data: Buffer | string;
}

export interface SyntheticAttachment {
  readonly pageId: string;
  readonly fileName: string;
  readonly versions: readonly SyntheticAttachmentVersion[];
  readonly missingFile?: boolean;
}

export interface SyntheticComment {
  readonly id: string;
  readonly pageId: string;
  readonly parentId?: string;
  readonly creatorKey: string;
  readonly body: string;
  readonly created?: string;
  readonly inline?: { readonly markerRef: string; readonly selection: string };
  readonly status?: "open" | "resolved" | "dangling";
  readonly resolverKey?: string;
}

export interface SyntheticLike {
  readonly id: string;
  readonly contentId: string;
  readonly userKey: string;
}

export interface SyntheticSpacePermission {
  readonly id: string;
  readonly type: string;
  readonly group?: string;
  readonly userKey?: string;
  readonly allUsers?: boolean;
}

export interface SyntheticRestriction {
  readonly id: string;
  readonly contentId: string;
  readonly kind: "View" | "Edit";
  readonly userKey?: string;
  readonly group?: string;
}

export interface SyntheticExport {
  readonly space: {
    readonly id: string;
    readonly key: string;
    readonly name: string;
    readonly homePageId: string;
  };
  readonly users: readonly SyntheticUser[];
  readonly pages: readonly SyntheticPage[];
  readonly attachments: readonly SyntheticAttachment[];
  readonly blogPosts?: readonly SyntheticPage[];
  readonly comments?: readonly SyntheticComment[];
  readonly likes?: readonly SyntheticLike[];
  readonly watchers?: number;
  readonly spacePermissions?: readonly SyntheticSpacePermission[];
  readonly restrictions?: readonly SyntheticRestriction[];
  readonly extraFiles?: readonly ZipFileSpec[];
}

const DATE = "2024-03-01 10:20:30.123";

function cdata(text: string): string {
  return `<![CDATA[${text.replaceAll("]]>", "]] >")}]]>`;
}

function property(name: string, value: string | number | null): string {
  if (value === null) return `<property name="${name}"/>`;
  return `<property name="${name}">${typeof value === "number" ? value : cdata(value)}</property>`;
}

function reference(name: string, className: string, id: string | null, idName = "id"): string {
  if (id === null) return "";
  return `<property name="${name}" class="${className}" package="com.atlassian.confluence"><id name="${idName}">${cdata(id)}</id></property>`;
}

function object(className: string, id: string, body: string, idName = "id"): string {
  return `<object class="${className}" package="com.atlassian.confluence"><id name="${idName}">${escapeXml(id)}</id>${body}</object>\n`;
}

function contentObject(
  className: "Page" | "BlogPost",
  page: SyntheticPage,
  model: SyntheticExport,
  id: string,
  original: SyntheticVersion | null,
  version: number,
): string {
  return object(
    className,
    id,
    [
      property("title", original?.title ?? page.title),
      property("version", version),
      reference("creator", "ConfluenceUserImpl", page.creatorKey, "key"),
      property("creationDate", page.created ?? DATE),
      reference(
        "lastModifier",
        "ConfluenceUserImpl",
        original ? (original.authorKey ?? page.creatorKey) : (page.modifierKey ?? page.creatorKey),
        "key",
      ),
      property("lastModificationDate", original ? (original.modified ?? DATE) : (page.modified ?? DATE)),
      property("contentStatus", original ? "current" : (page.status ?? "current")),
      reference("space", "Space", page.spaceId ?? model.space.id),
      property("position", className === "Page" ? page.position : null),
      className === "Page" ? reference("parent", "Page", page.parentId) : "",
      reference("originalVersion", className, original ? page.id : null),
    ].join(""),
  );
}

export function attachmentFiles(model: SyntheticExport, format: "xml" | "csv"): ZipFileSpec[] {
  const files: ZipFileSpec[] = [];
  for (const attachment of model.attachments) {
    if (attachment.missingFile) continue;
    const current = attachment.versions.at(-1);
    if (!current) continue;
    for (const version of attachment.versions) {
      const owner = format === "xml" ? current.id : version.id;
      files.push({
        name: `attachments/${attachment.pageId}/${owner}/${version.version}`,
        data: version.data,
        deflate: true,
      });
    }
  }
  return files;
}

function commentProperties(comment: SyntheticComment): [string, string][] {
  const result: [string, string][] = [];
  if (comment.inline) {
    result.push(["inline-comment", "true"], ["inline-marker-ref", comment.inline.markerRef]);
    result.push(["inline-original-selection", comment.inline.selection]);
  }
  if (comment.status) result.push(["status", comment.status]);
  if (comment.status === "resolved") {
    result.push(["status-lastmodifier", comment.resolverKey ?? comment.creatorKey]);
    result.push(["status-lastmoddate", String(Date.UTC(2024, 3, 2, 8, 0, 0))]);
  }
  return result;
}

export function createXmlExport(model: SyntheticExport): Buffer {
  const parts: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>\n<hibernate-generic datetime="2026-01-01">\n',
  ];
  for (const user of model.users) {
    parts.push(object("ConfluenceUserImpl", user.key, property("atlassianAccountId", user.accountId), "key"));
  }
  let bodyId = 900_000;
  let labelling = 800_000;
  let propertyId = 600_000;
  const labelIds = new Map<string, string>();
  const body = (id: string, className: string, text: string) => {
    bodyId += 1;
    parts.push(
      object(
        "BodyContent",
        String(bodyId),
        [property("body", text), reference("content", className, id), property("bodyType", 2)].join(""),
      ),
    );
  };
  const contents: ["Page" | "BlogPost", SyntheticPage][] = [
    ...model.pages.map((page): ["Page", SyntheticPage] => ["Page", page]),
    ...(model.blogPosts ?? []).map((post): ["BlogPost", SyntheticPage] => ["BlogPost", post]),
  ];
  for (const [className, page] of contents) {
    parts.push(contentObject(className, page, model, page.id, null, (page.history?.length ?? 0) + 1));
    body(page.id, className, page.body);
    for (const [index, old] of (page.history ?? []).entries()) {
      parts.push(contentObject(className, page, model, old.id, old, index + 1));
      body(old.id, className, old.body);
    }
    for (const label of page.labels ?? []) {
      if (!labelIds.has(label)) {
        const id = String(700_000 + labelIds.size);
        labelIds.set(label, id);
        parts.push(object("Label", id, [property("name", label), property("namespace", "global")].join("")));
      }
      labelling += 1;
      parts.push(
        object(
          "Labelling",
          String(labelling),
          [
            reference("label", "Label", labelIds.get(label) ?? ""),
            reference("content", className, page.id),
          ].join(""),
        ),
      );
    }
  }
  for (const attachment of model.attachments) {
    const current = attachment.versions.at(-1);
    if (!current) continue;
    for (const version of attachment.versions) {
      parts.push(
        object(
          "Attachment",
          version.id,
          [
            property("title", attachment.fileName),
            property("version", version.version),
            reference("creator", "ConfluenceUserImpl", model.users[0]?.key ?? null, "key"),
            property("creationDate", DATE),
            property("contentStatus", "current"),
            reference("containerContent", "Page", attachment.pageId),
            reference("originalVersion", "Attachment", version === current ? null : current.id),
          ].join(""),
        ),
      );
    }
  }
  for (const comment of model.comments ?? []) {
    parts.push(
      object(
        "Comment",
        comment.id,
        [
          property("version", 1),
          reference("creator", "ConfluenceUserImpl", comment.creatorKey, "key"),
          property("creationDate", comment.created ?? DATE),
          reference("lastModifier", "ConfluenceUserImpl", comment.creatorKey, "key"),
          property("lastModificationDate", comment.created ?? DATE),
          property("contentStatus", "current"),
          reference("containerContent", "Page", comment.pageId),
          reference("parent", "Comment", comment.parentId ?? null),
        ].join(""),
      ),
    );
    body(comment.id, "Comment", comment.body);
    for (const [name, value] of commentProperties(comment)) {
      propertyId += 1;
      parts.push(
        object(
          "ContentProperty",
          String(propertyId),
          [
            property("name", name),
            property("stringValue", value),
            reference("content", "Comment", comment.id),
          ].join(""),
        ),
      );
    }
  }
  for (const like of model.likes ?? []) {
    parts.push(
      object(
        "LikeEntity",
        like.id,
        [
          reference("content", "Page", like.contentId),
          reference("user", "ConfluenceUserImpl", like.userKey, "key"),
          property("creationDate", DATE),
        ].join(""),
      ),
    );
  }
  for (let index = 0; index < (model.watchers ?? 0); index += 1) {
    parts.push(
      object(
        "Notification",
        String(500_000 + index),
        [
          reference("content", "Page", model.pages[0]?.id ?? null),
          reference("receiver", "ConfluenceUserImpl", model.users[0]?.key ?? null, "key"),
        ].join(""),
      ),
    );
  }
  for (const permission of model.spacePermissions ?? []) {
    parts.push(
      object(
        "SpacePermission",
        permission.id,
        [
          property("spaceId", model.space.id),
          property("type", permission.type),
          property("group", permission.group ?? null),
          reference("userSubject", "ConfluenceUserImpl", permission.userKey ?? null, "key"),
          property("allUsersSubject", permission.allUsers ? "all-licensed-users" : null),
          property("active", "true"),
        ].join(""),
      ),
    );
  }
  const sets = new Map<string, string>();
  for (const restriction of model.restrictions ?? []) {
    const setKey = `${restriction.contentId}:${restriction.kind}`;
    let setId = sets.get(setKey);
    if (!setId) {
      setId = String(400_000 + sets.size);
      sets.set(setKey, setId);
      parts.push(
        object(
          "ContentPermissionSet",
          setId,
          [
            property("type", restriction.kind),
            reference("owningContent", "Page", restriction.contentId),
          ].join(""),
        ),
      );
    }
    parts.push(
      object(
        "ContentPermission",
        restriction.id,
        [
          property("type", restriction.kind),
          reference("userSubject", "ConfluenceUserImpl", restriction.userKey ?? null, "key"),
          property("groupName", restriction.group ?? null),
          reference("owningSet", "ContentPermissionSet", setId),
        ].join(""),
      ),
    );
  }
  parts.push(
    object(
      "Space",
      model.space.id,
      [
        property("name", model.space.name),
        property("key", model.space.key),
        reference("homePage", "Page", model.space.homePageId),
        property("spaceStatus", "CURRENT"),
      ].join(""),
    ),
  );
  parts.push("</hibernate-generic>\n");
  const descriptor = `exportType=space\nspaceKey=${model.space.key}\nsource=cloud\nbackupAttachments=true\n`;
  return createZip([
    { name: "exportDescriptor.properties", data: descriptor },
    { name: "entities.xml", data: parts.join(""), deflate: true },
    ...attachmentFiles(model, "xml"),
    ...(model.extraFiles ?? []),
  ]);
}

function csvCell(value: string | number | null): string {
  if (value === null) return "";
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csvTable(header: readonly string[], rows: readonly (readonly (string | number | null)[])[]): string {
  return [header.join(","), ...rows.map((row) => row.map(csvCell).join(","))].join("\r\n").concat("\r\n");
}

const CONTENT_COLUMNS = [
  "contentid",
  "contenttype",
  "title",
  "version",
  "creator",
  "creationdate",
  "lastmodifier",
  "lastmoddate",
  "prevver",
  "content_status",
  "pageid",
  "spaceid",
  "child_position",
  "parentid",
  "parentcommentid",
] as const;

export function createCsvExport(
  model: SyntheticExport,
  options: { gzip?: boolean; legacyRestrictions?: boolean } = {},
): Buffer {
  const content: (string | number | null)[][] = [];
  const bodies: (string | number | null)[][] = [];
  const labels: (string | number | null)[][] = [];
  const labellings: (string | number | null)[][] = [];
  const labelIds = new Map<string, string>();
  const accountOf = (key: string | undefined) =>
    key ? (model.users.find((user) => user.key === key)?.accountId ?? key) : null;
  let bodyId = 900_000;
  const contents: ["PAGE" | "BLOGPOST", SyntheticPage][] = [
    ...model.pages.map((page): ["PAGE", SyntheticPage] => ["PAGE", page]),
    ...(model.blogPosts ?? []).map((post): ["BLOGPOST", SyntheticPage] => ["BLOGPOST", post]),
  ];
  for (const [type, page] of contents) {
    const version = (page.history?.length ?? 0) + 1;
    content.push([
      page.id,
      type,
      page.title,
      version,
      page.creatorKey,
      page.created ?? DATE,
      page.modifierKey ?? page.creatorKey,
      page.modified ?? DATE,
      null,
      page.status ?? "current",
      null,
      page.spaceId ?? model.space.id,
      type === "PAGE" ? page.position : null,
      type === "PAGE" ? page.parentId : null,
      null,
    ]);
    bodyId += 1;
    bodies.push([bodyId, page.body, page.id, 2]);
    for (const [index, old] of (page.history ?? []).entries()) {
      content.push([
        old.id,
        type,
        old.title ?? page.title,
        index + 1,
        page.creatorKey,
        page.created ?? DATE,
        old.authorKey ?? page.creatorKey,
        old.modified ?? DATE,
        page.id,
        "current",
        null,
        page.spaceId ?? model.space.id,
        type === "PAGE" ? page.position : null,
        type === "PAGE" ? page.parentId : null,
        null,
      ]);
      bodyId += 1;
      bodies.push([bodyId, old.body, old.id, 2]);
    }
    for (const label of page.labels ?? []) {
      if (!labelIds.has(label)) {
        const id = String(700_000 + labelIds.size);
        labelIds.set(label, id);
        labels.push([id, label, "global"]);
      }
      labellings.push([String(800_000 + labellings.length), labelIds.get(label) ?? "", page.id]);
    }
  }
  for (const attachment of model.attachments) {
    const current = attachment.versions.at(-1);
    if (!current) continue;
    for (const version of attachment.versions) {
      content.push([
        version.id,
        "ATTACHMENT",
        attachment.fileName,
        version.version,
        model.users[0]?.key ?? null,
        DATE,
        model.users[0]?.key ?? null,
        DATE,
        version === current ? null : current.id,
        "current",
        attachment.pageId,
        model.space.id,
        null,
        null,
        null,
      ]);
    }
  }
  const properties: (string | number | null)[][] = [];
  for (const comment of model.comments ?? []) {
    content.push([
      comment.id,
      "COMMENT",
      null,
      1,
      comment.creatorKey,
      comment.created ?? DATE,
      comment.creatorKey,
      comment.created ?? DATE,
      null,
      "current",
      comment.pageId,
      null,
      null,
      null,
      comment.parentId ?? null,
    ]);
    bodyId += 1;
    bodies.push([bodyId, comment.body, comment.id, 2]);
    for (const [name, value] of commentProperties(comment)) {
      properties.push([String(600_000 + properties.length), name, value, null, null, comment.id]);
    }
  }
  const restrictionTables: Record<string, string> = {};
  if (options.legacyRestrictions) {
    const sets = new Map<string, string>();
    const setRows: (string | number | null)[][] = [];
    const rows: (string | number | null)[][] = [];
    for (const restriction of model.restrictions ?? []) {
      const setKey = `${restriction.contentId}:${restriction.kind}`;
      let setId = sets.get(setKey);
      if (!setId) {
        setId = String(400_000 + sets.size);
        sets.set(setKey, setId);
        setRows.push([setId, restriction.kind, restriction.contentId]);
      }
      rows.push([
        restriction.id,
        restriction.kind,
        restriction.userKey ?? null,
        restriction.group ?? null,
        setId,
      ]);
    }
    restrictionTables["content_perm_set.csv"] = csvTable(["id", "cont_perm_type", "content_id"], setRows);
    restrictionTables["content_perm.csv"] = csvTable(
      ["id", "cp_type", "username", "groupname", "cps_id"],
      rows,
    );
  } else {
    restrictionTables["content_permissions.csv"] = csvTable(
      [
        "groupname",
        "permission_id",
        "permission_type",
        "content_id",
        "principal_type",
        "principal_id",
        "deleted_id",
      ],
      (model.restrictions ?? []).map((restriction) => [
        restriction.group ?? null,
        restriction.id,
        restriction.kind.toUpperCase(),
        restriction.contentId,
        restriction.group ? "GROUP" : "USER",
        restriction.group ? `group-${restriction.id}` : accountOf(restriction.userKey),
        null,
      ]),
    );
  }
  const tables: Record<string, string> = {
    "spaces.csv": csvTable(
      ["spaceid", "spacename", "spacekey", "homepage", "spacestatus"],
      [[model.space.id, model.space.name, model.space.key, model.space.homePageId, "CURRENT"]],
    ),
    "content.csv": csvTable(CONTENT_COLUMNS, content),
    "bodycontent.csv": csvTable(["bodycontentid", "body", "contentid", "bodytypeid"], bodies),
    "label.csv": csvTable(["labelid", "name", "namespace"], labels),
    "content_label.csv": csvTable(["id", "labelid", "contentid"], labellings),
    "user_mapping.csv": csvTable(
      ["user_key", "username", "lower_username", "aaid"],
      model.users.map((user) => [user.key, user.key, user.key, user.accountId]),
    ),
    "contentproperties.csv": csvTable(
      ["propertyid", "propertyname", "stringval", "longval", "dateval", "contentid"],
      properties,
    ),
    "likes.csv": csvTable(
      ["id", "contentid", "username", "creationdate", "sequencenum", "liked"],
      (model.likes ?? []).map((like) => [like.id, like.contentId, like.userKey, DATE, 0, "true"]),
    ),
    "notifications.csv": csvTable(
      ["notificationid", "contentid", "username"],
      Array.from({ length: model.watchers ?? 0 }, (_, index) => [
        String(500_000 + index),
        model.pages[0]?.id ?? null,
        model.users[0]?.key ?? null,
      ]),
    ),
    "spacepermissions.csv": csvTable(
      ["permid", "spaceid", "permtype", "permgroupname", "permusername", "permalluserssubject", "active"],
      (model.spacePermissions ?? []).map((permission) => [
        permission.id,
        model.space.id,
        permission.type,
        permission.group ?? null,
        permission.userKey ?? null,
        permission.allUsers ? "all-licensed-users" : null,
        "true",
      ]),
    ),
    ...restrictionTables,
  };
  const descriptor = `exportType=space\nexportFormat=csv\nspaceKey=${model.space.key}\nsource=cloud\n`;
  const files: ZipFileSpec[] = [{ name: "exportDescriptor.properties.gz", data: descriptor }];
  for (const [name, text] of Object.entries(tables)) {
    files.push(
      options.gzip
        ? { name: `${name}.gz`, data: gzipSync(Buffer.from(text, "utf8")) }
        : { name: `${name}.gz`, data: text, deflate: true },
    );
  }
  return createZip([...files, ...attachmentFiles(model, "csv"), ...(model.extraFiles ?? [])]);
}
