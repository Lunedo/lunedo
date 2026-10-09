import {
  type DocumentJson,
  documentSize,
  editorSchemaVersion,
  emptyDocument,
  migrateDocument,
  validateDocument,
} from "@pagehall/editor-schema";
import { sql } from "drizzle-orm";
import type { Principal } from "../accounts/principal.js";
import type { AuthorizationService } from "../authorization/service.js";
import type { Database } from "../database/database.js";
import { SpaceError } from "../spaces/common.js";
import { DocumentInvalidError } from "../spaces/documents.js";
import { visibleItem } from "../spaces/visibility.js";

export const MAX_PRIVATE_NOTES_BYTES = 512 * 1024;

export interface PrivateNotes {
  meetingId: string;
  document: DocumentJson;
  schemaVersion: number;
  revision: number;
  updatedAt: Date | null;
}

export interface PrivateNotesEntry {
  meetingId: string;
  meetingTitle: string;
  startsAt: Date | null;
  document: DocumentJson;
  updatedAt: Date;
}

function authorOf(actor: Principal): string {
  if (actor.type !== "account") throw new SpaceError("notesNeedAccount", "Private notes belong to a person");
  return actor.id;
}

function current(document: unknown, schemaVersion: number): DocumentJson {
  return schemaVersion < editorSchemaVersion
    ? migrateDocument(document as DocumentJson, schemaVersion)
    : (document as DocumentJson);
}

export class PrivateNotesService {
  readonly #database: Database;
  readonly #authorization: AuthorizationService;

  constructor(options: { database: Database; authorization: AuthorizationService }) {
    this.#database = options.database;
    this.#authorization = options.authorization;
  }

  async get(actor: Principal, meetingId: string): Promise<PrivateNotes> {
    const accountId = authorOf(actor);
    const result = await this.#database.execute<{
      document: unknown;
      schema_version: number;
      revision: number;
      updated_at: Date | string;
    }>(sql`
      select document, schema_version, revision, updated_at from meeting_private_notes
      where meeting_id = ${meetingId} and account_id = ${accountId}`);
    const row = result.rows[0];
    if (!row) {
      return {
        meetingId,
        document: emptyDocument(),
        schemaVersion: editorSchemaVersion,
        revision: 0,
        updatedAt: null,
      };
    }
    return {
      meetingId,
      document: current(row.document, row.schema_version),
      schemaVersion: editorSchemaVersion,
      revision: Number(row.revision),
      updatedAt: new Date(row.updated_at),
    };
  }

  async save(
    actor: Principal,
    meetingId: string,
    input: { document: unknown; revision: number },
  ): Promise<PrivateNotes> {
    const accountId = authorOf(actor);
    if (documentSize(input.document) > MAX_PRIVATE_NOTES_BYTES) {
      throw new SpaceError(
        "notesTooLarge",
        "Private notes can have up to 512 KB; move some of them elsewhere",
      );
    }
    const validation = validateDocument(input.document);
    if (!validation.ok) throw new DocumentInvalidError(validation.problems);
    const document = JSON.stringify(validation.document);
    const saved = await this.#database.transaction(async (tx) => {
      const meeting = await tx.execute<{ item_id: string }>(
        sql`select item_id from meetings where item_id = ${meetingId} for share`,
      );
      if (!meeting.rows[0]) throw new SpaceError("meetingNotFound", "The meeting does not exist");
      if (input.revision === 0) {
        const inserted = await tx.execute<{ revision: number }>(sql`
          insert into meeting_private_notes (meeting_id, account_id, document, schema_version, revision)
          values (${meetingId}, ${accountId}, ${document}::jsonb, ${editorSchemaVersion}, 1)
          on conflict (meeting_id, account_id) do nothing
          returning revision`);
        return inserted.rows[0] ?? null;
      }
      const updated = await tx.execute<{ revision: number }>(sql`
        update meeting_private_notes set document = ${document}::jsonb, schema_version = ${editorSchemaVersion},
          revision = revision + 1, updated_at = now()
        where meeting_id = ${meetingId} and account_id = ${accountId} and revision = ${input.revision}
        returning revision`);
      return updated.rows[0] ?? null;
    });
    if (!saved) {
      throw new SpaceError(
        "notesChanged",
        "Your notes were changed in another window. Load the newer notes before saving again.",
      );
    }
    return this.get(actor, meetingId);
  }

  async listForSeries(actor: Principal, seriesId: string): Promise<PrivateNotesEntry[]> {
    const accountId = authorOf(actor);
    const result = await this.#database.execute<{
      meeting_id: string;
      title: string;
      starts_at: Date | string | null;
      document: unknown;
      schema_version: number;
      updated_at: Date | string;
    }>(sql`
      select n.meeting_id, t.title, m.starts_at, n.document, n.schema_version, n.updated_at
      from meeting_private_notes n join meetings m on m.item_id = n.meeting_id
      join tree_items t on t.id = n.meeting_id join spaces s on s.id = t.space_id
      where n.account_id = ${accountId} and m.series_id = ${seriesId}
        and ${visibleItem(this.#authorization, actor, sql`t`, sql`s`)}
      order by m.starts_at desc nulls first, n.meeting_id desc
      limit 500`);
    return result.rows.map((row) => ({
      meetingId: row.meeting_id,
      meetingTitle: row.title,
      startsAt: row.starts_at === null ? null : new Date(row.starts_at),
      document: current(row.document, row.schema_version),
      updatedAt: new Date(row.updated_at),
    }));
  }
}
