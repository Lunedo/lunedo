import { emptyScene, yDocFromScene } from "@pagehall/editor-schema/scene";
import { sql } from "drizzle-orm";
import type { Transaction } from "../database/database.js";
import { encodeState } from "../spaces/documents.js";

export async function insertInitialWhiteboard(
  tx: Transaction,
  itemId: string,
  actorId: string | null,
): Promise<void> {
  const scene = emptyScene();
  const doc = yDocFromScene(scene);
  const state = encodeState(doc);
  doc.destroy();
  await tx.execute(sql`
    insert into whiteboard_documents (item_id, state, scene, updated_by)
    values (${itemId}, ${state}, ${JSON.stringify(scene)}::jsonb, ${actorId})`);
}
