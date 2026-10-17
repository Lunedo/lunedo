import { type DocumentJson, excerptContent, extractPageProperties, plainText } from "@pagehall/editor-schema";
import { sql } from "drizzle-orm";
import type { Executor } from "../database/database.js";

const EXCERPT_TEXT_LENGTH = 500;

export async function syncReusableContent(
  executor: Executor,
  itemId: string,
  document: DocumentJson,
): Promise<void> {
  const properties = extractPageProperties(document);
  await executor.execute(sql`delete from page_properties where item_id = ${itemId}`);
  if (properties.length > 0) {
    await executor.execute(sql`
      insert into page_properties (item_id, block, position, set_id, key, key_normalized, value, text, sort_key)
      select ${itemId}, s.block, s.position, s."setId", s.key, s."keyNormalized", s.value, s.text, s."sortKey"
      from jsonb_to_recordset(${JSON.stringify(properties)}::jsonb)
        as s(block int, position int, "setId" text, key text, "keyNormalized" text, value jsonb, text text,
          "sortKey" text)`);
  }
  const excerpt = excerptContent(document, null);
  const text = excerpt
    ? plainText({ type: "doc", content: excerpt }).replace(/\s+/g, " ").trim().slice(0, EXCERPT_TEXT_LENGTH)
    : "";
  if (text.length > 0) {
    await executor.execute(sql`
      insert into page_excerpts (item_id, text) values (${itemId}, ${text})
      on conflict (item_id) do update set text = excluded.text`);
  } else {
    await executor.execute(sql`delete from page_excerpts where item_id = ${itemId}`);
  }
}
