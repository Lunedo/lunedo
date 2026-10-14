import { ImportFormatError } from "../errors.js";
import type { ByteSource } from "../formats/bytes.js";
import { DEFAULT_XML_LIMITS, parseXml } from "../formats/xml.js";
import type { ScanContext } from "../source.js";
import {
  confluenceDate,
  formerTitleRecord,
  isCurrentStatus,
  KEPT_PROPERTIES,
  kinds,
  pageSort,
  STORAGE_BODY_TYPE,
  StagedConfluenceReader,
  scanArchive,
  stageRestrictions,
  titleKey,
  toNumber,
  versionSort,
} from "./staged.js";

interface XmlObject {
  readonly className: string;
  id: string;
  readonly properties: Map<string, string>;
  readonly references: Map<string, string>;
  readonly elements: string[];
}

const LINKED_COLLECTION = "contentProperties";

const NESTED_CDATA_END = /\]\] (\]*>)/g;

export function unescapeNestedCdata(body: string): string {
  return body.includes("]] ") ? body.replace(NESTED_CDATA_END, "]]$1") : body;
}

interface Kept {
  readonly properties: ReadonlySet<string>;
  readonly references: ReadonlySet<string>;
}

function kept(properties: string[], references: string[]): Kept {
  return { properties: new Set(properties), references: new Set(references) };
}

const CONTENT = ["contentStatus", "title", "version", "position", "creationDate", "lastModificationDate"];
const CONTENT_REFERENCES = ["originalVersion", "creator", "lastModifier", "parent", "space"];

const WANTED = new Map<string, Kept>([
  ["Space", kept(["key", "name"], ["homePage"])],
  ["Page", kept(CONTENT, CONTENT_REFERENCES)],
  ["BlogPost", kept(CONTENT, CONTENT_REFERENCES)],
  [
    "Comment",
    kept(
      ["contentStatus", "creationDate", "lastModificationDate"],
      ["originalVersion", "containerContent", "parent", "creator"],
    ),
  ],
  ["ContentProperty", kept(["name", "stringValue", "longValue", "dateValue"], ["content"])],
  ["LikeEntity", kept(["liked", "creationDate"], ["content", "user"])],
  ["Notification", kept([], [])],
  [
    "SpacePermission",
    kept(["active", "group", "spaceId", "type", "allUsersSubject"], ["space", "userSubject"]),
  ],
  ["ContentPermissionSet", kept(["type"], ["owningContent"])],
  ["ContentPermission", kept(["groupName", "type"], ["owningSet", "userSubject"])],
  ["BodyContent", kept(["bodyType", "body"], ["content"])],
  [
    "Attachment",
    kept(
      ["contentStatus", "title", "version", "creationDate"],
      ["containerContent", "originalVersion", "creator"],
    ),
  ],
  ["Label", kept(["name", "namespace"], [])],
  ["Labelling", kept([], ["content", "label"])],
  [
    "PageTemplate",
    kept(
      ["bodyType", "name", "description", "content", "creationDate", "lastModificationDate"],
      ["space", "originalVersion", "creator"],
    ),
  ],
  ["ConfluenceUserImpl", kept(["atlassianAccountId"], [])],
]);
const PROGRESS_STEP = 500;

export interface XmlObjectLimits {
  readonly maxObjectBytes: number;
  readonly maxSpaces: number;
}

export const DEFAULT_OBJECT_LIMITS: XmlObjectLimits = {
  maxObjectBytes: DEFAULT_XML_LIMITS.maxElementBytes + 1024 * 1024,
  maxSpaces: 1000,
};

class ObjectReader {
  object: XmlObject | null = null;
  #kept: Kept | null = null;
  #bytes = 0;
  #property: { name: string; reference: boolean; kept: boolean; text: string } | null = null;
  #idTarget: "object" | "reference" | "element" | null = null;
  #idText = "";
  #collection = false;

  constructor(
    private readonly onObject: (object: XmlObject) => void,
    private readonly maxObjectBytes: number,
  ) {}

  #count(bytes: number): void {
    this.#bytes += bytes;
    if (this.#bytes > this.maxObjectBytes) {
      throw new ImportFormatError("xmlElementTooLarge", "An object in the export is larger than the limit.");
    }
  }

  open(name: string, attributes: Readonly<Record<string, string>>, depth: number): void {
    if (depth === 2 && name === "object") {
      this.#kept = WANTED.get(attributes.class ?? "") ?? null;
      this.#bytes = 0;
      this.object = this.#kept
        ? {
            className: attributes.class ?? "",
            id: "",
            properties: new Map(),
            references: new Map(),
            elements: [],
          }
        : null;
      return;
    }
    if (!this.object || !this.#kept) return;
    for (const [key, value] of Object.entries(attributes)) this.#count(key.length + value.length);
    if (depth === 3 && name === "id") {
      this.#idTarget = "object";
      this.#idText = "";
      return;
    }
    if (depth === 3 && name === "collection") {
      this.#collection = this.object.className === "Comment" && attributes.name === LINKED_COLLECTION;
      return;
    }
    if (depth === 5 && name === "id" && this.#collection) {
      this.#idTarget = "element";
      this.#idText = "";
      return;
    }
    if (depth === 3 && name === "property") {
      const property = attributes.name ?? "";
      const reference = attributes.class !== undefined;
      const wanted = reference ? this.#kept.references : this.#kept.properties;
      this.#property = { name: property, reference, kept: wanted.has(property), text: "" };
      return;
    }
    if (depth === 4 && name === "id" && this.#property?.reference && this.#property.kept) {
      this.#idTarget = "reference";
      this.#idText = "";
    }
  }

  text(text: string): void {
    if (!this.object) return;
    this.#count(text.length);
    if (this.#idTarget) this.#idText += text;
    else if (this.#property?.kept && !this.#property.reference) this.#property.text += text;
  }

  close(name: string, depth: number): void {
    const object = this.object;
    if (!object) return;
    if (name === "id" && this.#idTarget === "object" && depth === 3) {
      object.id = this.#idText.trim();
      this.#idTarget = null;
      return;
    }
    if (name === "id" && this.#idTarget === "element" && depth === 5) {
      const id = this.#idText.trim();
      if (id) object.elements.push(id);
      this.#idTarget = null;
      return;
    }
    if (name === "collection" && depth === 3) {
      this.#collection = false;
      return;
    }
    if (name === "id" && this.#idTarget === "reference" && depth === 4 && this.#property) {
      object.references.set(this.#property.name, this.#idText.trim());
      this.#idTarget = null;
      return;
    }
    if (name === "property" && depth === 3 && this.#property) {
      if (this.#property.kept && !this.#property.reference) {
        object.properties.set(this.#property.name, this.#property.text);
      }
      this.#property = null;
      return;
    }
    if (name === "object" && depth === 2) {
      this.object = null;
      this.#kept = null;
      this.onObject(object);
    }
  }
}

export class ConfluenceXmlReader extends StagedConfluenceReader {
  readonly source = "confluence-xml" as const;

  constructor(private readonly limits: XmlObjectLimits = DEFAULT_OBJECT_LIMITS) {
    super();
  }

  async scan(file: ByteSource, context: ScanContext): Promise<void> {
    const scanned = await scanArchive(file, context);
    if (scanned.format !== "xml") {
      throw new ImportFormatError("wrongFormat", "The file is a CSV space export, not an XML export.", {
        found: "csv",
      });
    }
    const location = scanned.files.get("entities.xml");
    if (!location) throw new ImportFormatError("notConfluenceExport", "The export has no entities.xml.");
    const spaceKey = scanned.descriptor.spaceKey ?? null;
    const skip = typeof context.checkpoint.objects === "number" ? context.checkpoint.objects : 0;
    let objects = 0;
    let pending: XmlObject[] = [];
    let bytes = 0;
    let spaces = 0;
    let firstSpace: XmlObject | undefined;
    let namedSpace: XmlObject | undefined;
    const handle = async (object: XmlObject) => {
      if (object.className === "Space") {
        spaces += 1;
        if (spaces > this.limits.maxSpaces) {
          throw new ImportFormatError(
            "xmlElementTooLarge",
            "The export contains more spaces than the limit.",
          );
        }
        firstSpace ??= object;
        if (object.properties.get("key")?.trim() === spaceKey) namedSpace ??= object;
        return;
      }
      await this.#stage(object, context);
    };
    const reader = new ObjectReader((object) => {
      objects += 1;
      if (objects > skip || object.className === "Space") pending.push(object);
    }, this.limits.maxObjectBytes);
    const stream = await scanned.archive.openAt(location);
    async function* source(): AsyncGenerator<Buffer> {
      for await (const chunk of stream as AsyncIterable<Buffer>) {
        bytes += chunk.length;
        yield chunk;
      }
    }
    const flushObjects = async () => {
      const batch = pending;
      pending = [];
      for (const object of batch) await handle(object);
    };
    let lastReported = 0;
    await parseXml(
      (async function* (this: void) {
        for await (const chunk of source()) {
          yield chunk;
          if (pending.length > 0) await flushObjects();
          if (objects - lastReported >= PROGRESS_STEP) {
            lastReported = objects;
            context.signal.throwIfAborted();
            await context.staging.flush();
            await context.saveCheckpoint({ objects: Math.max(skip, objects - pending.length) });
            await context.progress({ done: bytes, total: location.size });
          }
        }
      })(),
      {
        open: (name, attributes, depth) => reader.open(name, attributes, depth),
        text: (text) => reader.text(text),
        close: (name, depth) => reader.close(name, depth),
      },
    );
    await flushObjects();
    const space = namedSpace ?? (spaces === 1 ? firstSpace : undefined);
    if (!space) throw new ImportFormatError("notConfluenceExport", "The export contains no space.");
    await context.staging.put({
      kind: kinds.space,
      sourceId: space.id,
      data: {
        key: (space.properties.get("key") ?? "").trim(),
        name: (space.properties.get("name") ?? "").trim(),
        homePageId: space.references.get("homePage") ?? null,
      },
    });
    await context.staging.flush();
    await context.staging.removeOtherThan(kinds.page, "spaceId", space.id);
    await context.staging.removeOtherThan(kinds.template, "spaceId", space.id);
    await context.staging.orderTree(kinds.page);
    await stageRestrictions(context.staging);
    await context.saveCheckpoint({ objects });
  }

  async #stage(object: XmlObject, context: ScanContext): Promise<void> {
    const property = (name: string) => object.properties.get(name);
    const reference = (name: string) => object.references.get(name) ?? null;
    const status = property("contentStatus") ?? "current";
    switch (object.className) {
      case "Page":
      case "BlogPost": {
        if (!isCurrentStatus(status)) return;
        const title = (property("title") ?? "").trim();
        const original = reference("originalVersion");
        const version = toNumber(property("version")) ?? 1;
        if (original) {
          await context.staging.put({
            kind: kinds.version,
            sourceId: object.id,
            ref: original,
            sort: versionSort(version),
            data: {
              title,
              version,
              authorKey: reference("lastModifier") ?? reference("creator"),
              created:
                confluenceDate(property("lastModificationDate")) ?? confluenceDate(property("creationDate")),
            },
          });
          if (title) await context.staging.put(formerTitleRecord(original, title));
          return;
        }
        const blog = object.className === "BlogPost";
        await context.staging.put({
          kind: kinds.page,
          sourceId: object.id,
          ref: titleKey(title),
          parentId: blog ? null : reference("parent"),
          sort: blog
            ? `2${confluenceDate(property("creationDate")) ?? ""}`
            : pageSort(toNumber(property("position")), title),
          data: {
            ...(blog ? { type: "blogPost" } : {}),
            title,
            version,
            creatorKey: reference("creator"),
            created: confluenceDate(property("creationDate")),
            modifierKey: reference("lastModifier"),
            modified: confluenceDate(property("lastModificationDate")),
            spaceId: reference("space"),
          },
        });
        return;
      }
      case "Comment": {
        if (!isCurrentStatus(status) || reference("originalVersion")) return;
        const container = reference("containerContent");
        if (!container) return;
        const created = confluenceDate(property("creationDate"));
        await context.staging.put({
          kind: kinds.comment,
          sourceId: object.id,
          ref: container,
          parentId: reference("parent"),
          sort: created ?? "",
          data: {
            creatorKey: reference("creator"),
            created,
            modified: confluenceDate(property("lastModificationDate")),
          },
        });
        for (const element of object.elements) {
          await context.staging.put({
            kind: kinds.propertyLink,
            sourceId: element,
            ref: object.id,
            data: {},
          });
        }
        return;
      }
      case "ContentProperty": {
        const name = (property("name") ?? "").trim();
        if (!KEPT_PROPERTIES.has(name)) return;
        const content = reference("content");
        const value = property("stringValue") || property("longValue") || property("dateValue") || "";
        await context.staging.put({
          kind: content ? kinds.property : kinds.propertyValue,
          sourceId: object.id,
          ref: content,
          data: { name, value: value.slice(0, 2000) },
        });
        return;
      }
      case "LikeEntity": {
        const content = reference("content");
        if (!content || (property("liked") ?? "true").trim().toLowerCase() === "false") return;
        await context.staging.put({
          kind: kinds.like,
          sourceId: object.id,
          ref: content,
          data: { userKey: reference("user"), created: confluenceDate(property("creationDate")) },
        });
        return;
      }
      case "Notification":
        await context.staging.put({ kind: kinds.watch, sourceId: object.id, data: {} });
        return;
      case "SpacePermission": {
        if ((property("active") ?? "true").trim().toLowerCase() === "false") return;
        const group = (property("group") ?? "").trim();
        await context.staging.put({
          kind: kinds.spacePermission,
          sourceId: object.id,
          data: {
            spaceId: (property("spaceId") ?? "").trim() || reference("space"),
            type: (property("type") ?? "").trim().toUpperCase(),
            group: group.length > 0 ? group : null,
            userKey: reference("userSubject"),
            allUsers: (property("allUsersSubject") ?? "").trim().length > 0,
          },
        });
        return;
      }
      case "ContentPermissionSet": {
        const content = reference("owningContent");
        if (!content) return;
        await context.staging.put({
          kind: kinds.permissionSet,
          sourceId: object.id,
          data: { contentId: content, type: (property("type") ?? "").trim() },
        });
        return;
      }
      case "ContentPermission": {
        const set = reference("owningSet");
        if (!set) return;
        const group = (property("groupName") ?? "").trim();
        await context.staging.put({
          kind: kinds.contentPermission,
          sourceId: object.id,
          ref: set,
          data: {
            type: (property("type") ?? "").trim(),
            userKey: reference("userSubject"),
            accountId: null,
            group: group.length > 0 ? group : null,
          },
        });
        return;
      }
      case "BodyContent": {
        if ((property("bodyType") ?? "").trim() !== STORAGE_BODY_TYPE) return;
        const content = reference("content");
        if (!content) return;
        await context.staging.put({
          kind: kinds.body,
          sourceId: object.id,
          ref: content,
          data: { body: unescapeNestedCdata(property("body") ?? "") },
        });
        return;
      }
      case "Attachment": {
        if (!isCurrentStatus(status)) return;
        const pageId = reference("containerContent");
        if (!pageId) return;
        const originalId = reference("originalVersion");
        await context.staging.put({
          kind: kinds.attachment,
          sourceId: object.id,
          ref: originalId ?? object.id,
          data: {
            pageId,
            originalId,
            fileName: (property("title") ?? "").trim(),
            version: toNumber(property("version")) ?? 1,
            creatorKey: reference("creator"),
            created: confluenceDate(property("creationDate")),
          },
        });
        return;
      }
      case "Label":
        await context.staging.put({
          kind: kinds.label,
          sourceId: object.id,
          data: {
            name: (property("name") ?? "").trim(),
            namespace: (property("namespace") ?? "global").trim(),
          },
        });
        return;
      case "Labelling": {
        const content = reference("content");
        const label = reference("label");
        if (!content || !label) return;
        await context.staging.put({
          kind: kinds.labelling,
          sourceId: object.id,
          ref: content,
          data: { labelId: label },
        });
        return;
      }
      case "PageTemplate": {
        const spaceId = reference("space");
        if (
          !spaceId ||
          reference("originalVersion") ||
          (property("bodyType") ?? STORAGE_BODY_TYPE).trim() !== STORAGE_BODY_TYPE
        ) {
          return;
        }
        await context.staging.put({
          kind: kinds.template,
          sourceId: object.id,
          data: {
            name: (property("name") ?? "").trim(),
            description: (property("description") ?? "").trim(),
            body: unescapeNestedCdata(property("content") ?? ""),
            spaceId,
            creatorKey: reference("creator"),
            created: confluenceDate(property("creationDate")),
            modified: confluenceDate(property("lastModificationDate")),
          },
        });
        return;
      }
      case "ConfluenceUserImpl": {
        const accountId = (property("atlassianAccountId") ?? "").trim();
        await context.staging.put({
          kind: kinds.user,
          sourceId: object.id,
          data: { accountId: accountId.length > 0 ? accountId : null },
        });
        return;
      }
      default:
        return;
    }
  }
}
