import { Readable } from "node:stream";
import { MAX_DRAWING_TEXT } from "@pagehall/editor-schema";
import { MAX_SCENE_BYTES, sceneText, validateScene, visibleScene } from "@pagehall/editor-schema/scene";
import { sql } from "drizzle-orm";
import type { Principal } from "../accounts/principal.js";
import type { Database } from "../database/database.js";
import { readUpload, sanitizerSlots } from "../diagrams/markup.js";
import type { AttachmentService } from "../files/attachments.js";
import { SpaceError } from "../spaces/common.js";
import { parseScene, readText, SceneInvalidError } from "./common.js";
import { MAX_PREVIEW_BYTES, sanitizeSvg } from "./svg.js";

export interface SavedDrawingScene {
  sceneId: string;
  sceneVersion: number;
  text: string;
}

export interface SavedDrawingPreview {
  previewId: string;
  previewVersion: number;
}

export function drawingFileNames(blockId: string): { scene: string; preview: string } {
  return { scene: `drawing-${blockId}.excalidraw`, preview: `drawing-${blockId}.svg` };
}

export class DrawingService {
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
      throw new SpaceError("itemNotFound", "Drawings are stored in pages and blog posts");
    }
  }

  async saveScene(
    actor: Principal,
    itemId: string,
    input: { blockId: string; body: Readable },
  ): Promise<SavedDrawingScene> {
    await this.#requirePage(itemId);
    const validation = validateScene(parseScene(await readText(input.body, MAX_SCENE_BYTES)));
    if (!validation.ok) throw new SceneInvalidError(validation.problems);
    const scene = visibleScene(validation.scene);
    const referenced = [...new Set(Object.values(scene.files).map((file) => file.attachmentId))];
    if (referenced.length > 0) {
      const own = await this.#database.execute<{ id: string }>(sql`
        select id from attachments where item_id = ${itemId} and id = any(${sql.param(referenced)}::uuid[])`);
      if (own.rows.length !== referenced.length) {
        throw new SceneInvalidError([{ path: "files", code: "invalidFile" }]);
      }
    }
    const stored = await this.#attachments.upload(actor, itemId, {
      name: drawingFileNames(input.blockId).scene,
      body: Readable.from([Buffer.from(JSON.stringify(scene), "utf8")]),
    });
    return {
      sceneId: stored.id,
      sceneVersion: stored.version,
      text: sceneText(scene).slice(0, MAX_DRAWING_TEXT),
    };
  }

  async savePreview(
    actor: Principal,
    itemId: string,
    input: { blockId: string; body: Readable },
  ): Promise<SavedDrawingPreview> {
    await this.#requirePage(itemId);
    const text = (await readUpload(input.body, MAX_PREVIEW_BYTES)).toString("utf8");
    const preview = await sanitizerSlots.run(actor, async () =>
      this.#attachments.upload(actor, itemId, {
        name: drawingFileNames(input.blockId).preview,
        body: Readable.from([Buffer.from(sanitizeSvg(text), "utf8")]),
      }),
    );
    return { previewId: preview.id, previewVersion: preview.version };
  }
}
