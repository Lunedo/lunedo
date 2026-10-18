import { Readable } from "node:stream";
import type { DocumentJson, NodeJson } from "@pagehall/editor-schema";
import { emptyScene, type Scene } from "@pagehall/editor-schema/scene";
import { sql } from "drizzle-orm";
import type { Principal } from "../accounts/principal.js";
import type { TestServices } from "../testing/services.js";

export function imageScene(attachmentId: string): Scene {
  const element = {
    id: "router-image",
    type: "image",
    x: 10,
    y: 20,
    width: 100,
    height: 50,
    angle: 0,
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roundness: null,
    roughness: 1,
    opacity: 100,
    seed: 1234,
    version: 3,
    versionNonce: 99,
    index: "a0",
    isDeleted: false,
    groupIds: [],
    frameId: null,
    boundElements: null,
    updated: 1_700_000_000_000,
    link: null,
    locked: false,
    fileId: "router",
    status: "saved",
    scale: [1, 1],
    crop: null,
  };
  return {
    ...emptyScene(),
    elements: [element] as unknown as Scene["elements"],
    files: { router: { attachmentId, mimeType: "image/png" } },
  };
}

export async function pageWithDrawing(
  test: TestServices,
  actor: Principal,
  pageId: string,
  blockId: string,
  image: string,
): Promise<void> {
  const saved = await test.services.drawings.saveScene(actor, pageId, {
    blockId,
    body: Readable.from([Buffer.from(JSON.stringify(imageScene(image)))]),
  });
  await test.services.documents.replace(actor, pageId, {
    type: "doc",
    content: [
      { type: "drawing", attrs: { id: blockId, sceneId: saved.sceneId, sceneVersion: saved.sceneVersion } },
    ],
  });
}

function drawingOf(document: DocumentJson | NodeJson): NodeJson | null {
  if (document.type === "drawing") return document;
  for (const child of document.content ?? []) {
    const found = drawingOf(child);
    if (found) return found;
  }
  return null;
}

export async function drawingSceneOf(
  test: TestServices,
  pageId: string,
): Promise<{ sceneId: string; text: string; images: string[] }> {
  const stored = await test.database.execute<{ snapshot: DocumentJson }>(
    sql`select snapshot from page_documents where item_id = ${pageId}`,
  );
  const drawing = stored.rows[0] ? drawingOf(stored.rows[0].snapshot) : null;
  const sceneId = String(drawing?.attrs?.sceneId ?? "");
  const version = Number(drawing?.attrs?.sceneVersion ?? 1);
  const file = await test.database.execute<{ file_id: string }>(sql`
    select file_id from attachment_versions where attachment_id = ${sceneId} and number = ${version}`);
  const text = (await test.services.files.readAll(file.rows[0]?.file_id ?? "", 1024 * 1024)).toString("utf8");
  const scene = JSON.parse(text) as Scene;
  return { sceneId, text, images: Object.values(scene.files).map((entry) => entry.attachmentId) };
}
