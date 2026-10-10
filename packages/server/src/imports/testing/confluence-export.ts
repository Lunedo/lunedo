import { gzipSync } from "node:zlib";
import { escapeXml } from "../formats/escape.js";
import { createZip, type ZipFileSpec } from "./zip-writer.js";

export interface SyntheticUser {
  readonly key: string;
  readonly accountId: string;
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
  readonly history?: readonly { readonly id: string; readonly body: string }[];
  readonly spaceId?: string;
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

function pageObject(
  page: SyntheticPage,
  model: SyntheticExport,
  id: string,
  original: string | null,
  version: number,
): string {
  return object(
    "Page",
    id,
    [
      property("title", page.title),
      property("version", version),
      reference("creator", "ConfluenceUserImpl", page.creatorKey, "key"),
      property("creationDate", DATE),
      reference("lastModifier", "ConfluenceUserImpl", page.creatorKey, "key"),
      property("lastModificationDate", DATE),
      property("contentStatus", page.status ?? "current"),
      reference("space", "Space", page.spaceId ?? model.space.id),
      property("position", page.position),
      reference("parent", "Page", page.parentId),
      reference("originalVersion", "Page", original),
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

export function createXmlExport(model: SyntheticExport): Buffer {
  const parts: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>\n<hibernate-generic datetime="2026-01-01">\n',
  ];
  for (const user of model.users) {
    parts.push(object("ConfluenceUserImpl", user.key, property("atlassianAccountId", user.accountId), "key"));
  }
  let bodyId = 900_000;
  let labelling = 800_000;
  const labelIds = new Map<string, string>();
  for (const page of model.pages) {
    parts.push(pageObject(page, model, page.id, null, (page.history?.length ?? 0) + 1));
    bodyId += 1;
    parts.push(
      object(
        "BodyContent",
        String(bodyId),
        [property("body", page.body), reference("content", "Page", page.id), property("bodyType", 2)].join(
          "",
        ),
      ),
    );
    for (const [index, old] of (page.history ?? []).entries()) {
      parts.push(pageObject(page, model, old.id, page.id, index + 1));
      bodyId += 1;
      parts.push(
        object(
          "BodyContent",
          String(bodyId),
          [property("body", old.body), reference("content", "Page", old.id), property("bodyType", 2)].join(
            "",
          ),
        ),
      );
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
            reference("content", "Page", page.id),
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
] as const;

export function createCsvExport(model: SyntheticExport, options: { gzip?: boolean } = {}): Buffer {
  const content: (string | number | null)[][] = [];
  const bodies: (string | number | null)[][] = [];
  const labels: (string | number | null)[][] = [];
  const labellings: (string | number | null)[][] = [];
  const labelIds = new Map<string, string>();
  let bodyId = 900_000;
  for (const page of model.pages) {
    const version = (page.history?.length ?? 0) + 1;
    content.push([
      page.id,
      "PAGE",
      page.title,
      version,
      page.creatorKey,
      DATE,
      page.creatorKey,
      DATE,
      null,
      page.status ?? "current",
      null,
      page.spaceId ?? model.space.id,
      page.position,
      page.parentId,
    ]);
    bodyId += 1;
    bodies.push([bodyId, page.body, page.id, 2]);
    for (const [index, old] of (page.history ?? []).entries()) {
      const id = old.id;
      content.push([
        id,
        "PAGE",
        page.title,
        index + 1,
        page.creatorKey,
        DATE,
        page.creatorKey,
        DATE,
        page.id,
        "current",
        null,
        page.spaceId ?? model.space.id,
        page.position,
        page.parentId,
      ]);
      bodyId += 1;
      bodies.push([bodyId, old.body, id, 2]);
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
      ]);
    }
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
