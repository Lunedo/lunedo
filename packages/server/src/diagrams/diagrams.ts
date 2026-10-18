import { Readable } from "node:stream";
import { type DiagramType, MAX_DRAWING_TEXT } from "@pagehall/editor-schema";
import { sql } from "drizzle-orm";
import type { Principal } from "../accounts/principal.js";
import type { Database } from "../database/database.js";
import type { AttachmentService } from "../files/attachments.js";
import { SpaceError } from "../spaces/common.js";
import { readText } from "../whiteboards/common.js";
import { SvgRejectedError, sanitizeDiagramSvg } from "../whiteboards/svg.js";
import { MAX_DRAWIO_BYTES, sanitizeDrawio } from "./drawio.js";
import { sanitizerSlots } from "./markup.js";

export const MAX_DIAGRAM_IMAGE_BYTES: Readonly<Record<DiagramType, number>> = {
  drawio: 10 * 1024 * 1024,
  mermaid: 2 * 1024 * 1024,
  plantuml: 2 * 1024 * 1024,
};
export const MAX_DIAGRAM_IMAGE_SIZE = 20_000;

export interface SavedDiagramSource {
  sourceId: string;
  sourceVersion: number;
  text: string;
}

export interface SavedDiagramPreview {
  previewId: string;
  previewVersion: number;
  text: string;
}

export function diagramFileNames(type: DiagramType, blockId: string): { source: string; preview: string } {
  return { source: `${type}-${blockId}.${type}`, preview: `${type}-${blockId}.svg` };
}

export class DiagramService {
  readonly #database: Database;
  readonly #attachments: AttachmentService;

  constructor(options: { database: Database; attachments: AttachmentService }) {
    this.#database = options.database;
    this.#attachments = options.attachments;
  }

  async #requirePage(itemId: string): Promise<void> {
    const kind = await this.#database.execute<{ kind: string }>(
      sql`select kind from tree_items where id = ${itemId}`,
    );
    if (kind.rows[0]?.kind !== "page" && kind.rows[0]?.kind !== "blogPost") {
      throw new SpaceError("itemNotFound", "Diagrams are stored in pages and blog posts");
    }
  }

  async saveDrawio(
    actor: Principal,
    itemId: string,
    input: { blockId: string; body: Readable },
  ): Promise<SavedDiagramSource> {
    await this.#requirePage(itemId);
    const sanitized = await sanitizerSlots.run(
      actor,
      async () => sanitizeDrawio(await readText(input.body, MAX_DRAWIO_BYTES)),
      input.body,
    );
    const stored = await this.#attachments.upload(actor, itemId, {
      name: diagramFileNames("drawio", input.blockId).source,
      body: Readable.from([Buffer.from(sanitized.xml, "utf8")]),
    });
    return {
      sourceId: stored.id,
      sourceVersion: stored.version,
      text: sanitized.text.slice(0, MAX_DRAWING_TEXT),
    };
  }

  async savePreview(
    actor: Principal,
    itemId: string,
    input: { type: DiagramType; blockId: string; body: Readable },
  ): Promise<SavedDiagramPreview> {
    await this.#requirePage(itemId);
    const limit = MAX_DIAGRAM_IMAGE_BYTES[input.type];
    const sanitized = await sanitizerSlots.run(
      actor,
      async () => sanitizeDiagramSvg(await readText(input.body, limit), limit),
      input.body,
    );
    if (sanitized.width > MAX_DIAGRAM_IMAGE_SIZE || sanitized.height > MAX_DIAGRAM_IMAGE_SIZE) {
      throw new SvgRejectedError(
        `The diagram is larger than ${MAX_DIAGRAM_IMAGE_SIZE} by ${MAX_DIAGRAM_IMAGE_SIZE} pixels`,
      );
    }
    const preview = await this.#attachments.upload(actor, itemId, {
      name: diagramFileNames(input.type, input.blockId).preview,
      body: Readable.from([Buffer.from(sanitized.svg, "utf8")]),
    });
    return {
      previewId: preview.id,
      previewVersion: preview.version,
      text: sanitized.text.slice(0, MAX_DRAWING_TEXT),
    };
  }
}
