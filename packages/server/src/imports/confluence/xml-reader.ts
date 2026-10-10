import { ImportFormatError } from "../errors.js";
import type { ByteSource } from "../formats/bytes.js";
import { parseXml } from "../formats/xml.js";
import type { ScanContext } from "../source.js";
import {
  confluenceDate,
  isCurrentStatus,
  kinds,
  pageSort,
  STORAGE_BODY_TYPE,
  StagedConfluenceReader,
  scanArchive,
  titleKey,
  toNumber,
} from "./staged.js";

interface XmlObject {
  readonly className: string;
  id: string;
  readonly properties: Map<string, string>;
  readonly references: Map<string, string>;
}

const NESTED_CDATA_END = "]] >";

export function unescapeNestedCdata(body: string): string {
  return body.includes(NESTED_CDATA_END) ? body.replaceAll(NESTED_CDATA_END, "]]>") : body;
}

const WANTED = new Set([
  "Space",
  "Page",
  "BodyContent",
  "Attachment",
  "Label",
  "Labelling",
  "ConfluenceUserImpl",
]);
const PROGRESS_STEP = 500;

class ObjectReader {
  object: XmlObject | null = null;
  #property: { name: string; reference: boolean; text: string } | null = null;
  #idTarget: "object" | "reference" | null = null;
  #idText = "";

  constructor(private readonly onObject: (object: XmlObject) => void) {}

  open(name: string, attributes: Readonly<Record<string, string>>, depth: number): void {
    if (depth === 2 && name === "object") {
      const className = attributes.class ?? "";
      this.object = WANTED.has(className)
        ? { className, id: "", properties: new Map(), references: new Map() }
        : null;
      return;
    }
    if (!this.object) return;
    if (depth === 3 && name === "id") {
      this.#idTarget = "object";
      this.#idText = "";
      return;
    }
    if (depth === 3 && name === "property") {
      this.#property = { name: attributes.name ?? "", reference: attributes.class !== undefined, text: "" };
      return;
    }
    if (depth === 4 && name === "id" && this.#property?.reference) {
      this.#idTarget = "reference";
      this.#idText = "";
    }
  }

  text(text: string): void {
    if (!this.object) return;
    if (this.#idTarget) this.#idText += text;
    else if (this.#property && !this.#property.reference) this.#property.text += text;
  }

  close(name: string, depth: number): void {
    const object = this.object;
    if (!object) return;
    if (name === "id" && this.#idTarget === "object" && depth === 3) {
      object.id = this.#idText.trim();
      this.#idTarget = null;
      return;
    }
    if (name === "id" && this.#idTarget === "reference" && depth === 4 && this.#property) {
      object.references.set(this.#property.name, this.#idText.trim());
      this.#idTarget = null;
      return;
    }
    if (name === "property" && depth === 3 && this.#property) {
      if (!this.#property.reference) object.properties.set(this.#property.name, this.#property.text);
      this.#property = null;
      return;
    }
    if (name === "object" && depth === 2) {
      this.object = null;
      this.onObject(object);
    }
  }
}

export class ConfluenceXmlReader extends StagedConfluenceReader {
  readonly source = "confluence-xml" as const;

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
    const spaces: XmlObject[] = [];
    const handle = async (object: XmlObject) => {
      if (object.className === "Space") {
        spaces.push(object);
        return;
      }
      await this.#stage(object, context);
    };
    const reader = new ObjectReader((object) => {
      objects += 1;
      if (objects > skip || object.className === "Space") pending.push(object);
    });
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
    const space =
      spaces.find((candidate) => candidate.properties.get("key")?.trim() === spaceKey) ??
      (spaces.length === 1 ? spaces[0] : undefined);
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
    await context.staging.orderTree(kinds.page);
    await context.saveCheckpoint({ objects });
  }

  async #stage(object: XmlObject, context: ScanContext): Promise<void> {
    const property = (name: string) => object.properties.get(name);
    const reference = (name: string) => object.references.get(name) ?? null;
    const status = property("contentStatus") ?? "current";
    switch (object.className) {
      case "Page": {
        if (!isCurrentStatus(status) || reference("originalVersion")) return;
        const title = (property("title") ?? "").trim();
        await context.staging.put({
          kind: kinds.page,
          sourceId: object.id,
          ref: titleKey(title),
          parentId: reference("parent"),
          sort: pageSort(toNumber(property("position")), title),
          data: {
            title,
            version: toNumber(property("version")) ?? 1,
            creatorKey: reference("creator"),
            created: confluenceDate(property("creationDate")),
            modifierKey: reference("lastModifier"),
            modified: confluenceDate(property("lastModificationDate")),
            spaceId: reference("space"),
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
