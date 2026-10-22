import { Readable } from "node:stream";
import type { CopiedAttachment, DocumentJson, NodeJson } from "@lunedo/editor-schema";
import { copyScene, MAX_SCENE_BYTES, type Scene, validateScene } from "@lunedo/editor-schema/scene";
import { sql } from "drizzle-orm";
import type { Executor } from "../database/database.js";
import type { FileService } from "../files/files.js";
import { readText } from "./common.js";
import { drawingFileNames } from "./drawings.js";

export interface DrawingSceneCopy {
  read(scene: CopiedAttachment): Promise<string | null>;
  image(sourceId: string): Promise<string | null>;
  write(blockId: string, scene: Buffer, current: CopiedAttachment): Promise<CopiedAttachment>;
}

function sceneOf(text: string | null): Scene | null {
  if (text === null) return null;
  try {
    const validated = validateScene(JSON.parse(text) as unknown);
    return validated.ok ? validated.scene : null;
  } catch {
    return null;
  }
}

function sceneReference(node: NodeJson): CopiedAttachment | null {
  const id = node.attrs?.sceneId;
  const version = node.attrs?.sceneVersion;
  return node.type === "drawing" && typeof id === "string"
    ? { id, version: typeof version === "number" ? version : null }
    : null;
}

function drawings(node: NodeJson): NodeJson[] {
  return [...(node.type === "drawing" ? [node] : []), ...(node.content ?? []).flatMap(drawings)];
}

export async function sceneImageIds(
  document: DocumentJson,
  read: DrawingSceneCopy["read"],
): Promise<string[]> {
  const ids = new Set<string>();
  for (const node of drawings(document)) {
    const reference = sceneReference(node);
    const scene = reference ? sceneOf(await read(reference)) : null;
    for (const file of Object.values(scene?.files ?? {})) ids.add(file.attachmentId);
  }
  return [...ids];
}

export async function copyDrawingScenes(
  document: DocumentJson,
  copy: DrawingSceneCopy,
): Promise<DocumentJson> {
  const rewrite = async (node: NodeJson): Promise<NodeJson> => {
    const reference = sceneReference(node);
    const scene = reference ? sceneOf(await copy.read(reference)) : null;
    if (reference && scene && Object.keys(scene.files).length > 0) {
      const targets = new Map<string, string>();
      for (const file of Object.values(scene.files)) {
        if (targets.has(file.attachmentId)) continue;
        const target = await copy.image(file.attachmentId);
        if (target) targets.set(file.attachmentId, target);
      }
      const kept: Scene = {
        ...scene,
        files: Object.fromEntries(
          Object.entries(scene.files).filter(([, file]) => targets.has(file.attachmentId)),
        ),
      };
      const copied = copyScene(kept, {
        attachment: (id) => targets.get(id) ?? id,
        href: (href) => href,
      });
      const written = await copy.write(
        String(node.attrs?.id ?? ""),
        Buffer.from(JSON.stringify(copied), "utf8"),
        reference,
      );
      return { ...node, attrs: { ...node.attrs, sceneId: written.id, sceneVersion: written.version } };
    }
    if (!node.content) return node;
    const content: NodeJson[] = [];
    for (const child of node.content) content.push(await rewrite(child));
    return { ...node, content };
  };
  return (await rewrite(document)) as DocumentJson;
}

export function attachmentScenes(
  tx: Executor,
  files: FileService,
  itemId: string,
  image: DrawingSceneCopy["image"],
): DrawingSceneCopy {
  return {
    read: async (scene) => {
      const result = await tx.execute<{ file_id: string }>(sql`
        select v.file_id from attachment_versions v join attachments a on a.id = v.attachment_id
        where v.attachment_id = ${scene.id} and a.item_id = ${itemId}
          and (v.number = ${scene.version} or (${scene.version}::int is null and v.id = a.current_version_id))`);
      const fileId = result.rows[0]?.file_id;
      return fileId ? readText(await files.read(fileId), MAX_SCENE_BYTES) : null;
    },
    image,
    write: async (blockId, scene, current) => {
      const stored = await files.write(Readable.from([scene]), {
        name: drawingFileNames(blockId).scene,
        maxBytes: MAX_SCENE_BYTES,
        executor: tx,
      });
      await files.commit(tx, stored.id);
      await tx.execute(sql`
        update attachment_versions v set file_id = ${stored.id} from attachments a
        where a.id = v.attachment_id and v.attachment_id = ${current.id} and a.item_id = ${itemId}
          and (v.number = ${current.version} or (${current.version}::int is null and v.id = a.current_version_id))`);
      return current;
    },
  };
}
