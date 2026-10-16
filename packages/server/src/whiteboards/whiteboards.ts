import { Readable } from "node:stream";
import {
  applyScene,
  emptyScene,
  hasOnlySceneTypes,
  pruneDeletedElements,
  type Scene,
  sceneFromYDoc,
  validateScene,
  visibleScene,
} from "@pagehall/editor-schema/scene";
import { uuidv7 } from "@pagehall/shared";
import { sql } from "drizzle-orm";
import * as Y from "yjs";
import type { Principal } from "../accounts/principal.js";
import type { AuditLog } from "../audit/audit-log.js";
import type { ContentActivity } from "../collaboration/content.js";
import type { Database, Executor, Transaction } from "../database/database.js";
import type { FileService } from "../files/files.js";
import type { SettingsService } from "../settings/service.js";
import { actorIdOf, auditScopeOf, SpaceError } from "../spaces/common.js";
import {
  API_ORIGIN,
  encodeState,
  MERGE_ORIGIN,
  NORMALIZE_ORIGIN,
  recordClient,
} from "../spaces/documents.js";
import type { PeopleService } from "../spaces/people.js";
import type { VersionReason } from "../spaces/schema.js";
import { liveVersionIdleMinutesSetting } from "../spaces/settings.js";
import { signalDocumentChange, signalSpaceChange } from "../spaces/signals.js";
import { PRESENCE_STALE_SECONDS, type VersionPerson } from "../spaces/versions.js";
import type { StorageService } from "../storage/storage.js";
import { readText, SceneInvalidError } from "./common.js";
import { MAX_PREVIEW_BYTES, sanitizeSvg } from "./svg.js";

export const DELETED_ELEMENT_RETENTION_MS = 24 * 60 * 60 * 1000;
const IDLE_BATCH = 200;

export interface WhiteboardScene {
  itemId: string;
  scene: Scene;
  revision: number;
  updatedAt: Date;
  updatedBy: VersionPerson | null;
  preview: boolean;
}

export interface WhiteboardVersion {
  number: number;
  title: string;
  reason: VersionReason;
  restoredFrom: number | null;
  createdAt: Date;
  createdBy: VersionPerson | null;
  contributors: VersionPerson[];
  preview: boolean;
}

export interface WhiteboardVersionContent extends WhiteboardVersion {
  scene: Scene;
}

export interface StoredPreview {
  id: string;
  fileId: string;
  size: number;
}

interface LockedBoard {
  itemId: string;
  spaceId: string;
  organizationId: string | null;
  title: string;
  state: Uint8Array;
  scene: Scene;
  revision: number;
  versionedRevision: number;
  previewId: string | null;
  latest: number | null;
}

function storedScene(value: unknown): Scene {
  const result = validateScene(value);
  return result.ok ? result.scene : emptyScene();
}

export function readSceneOf(doc: Y.Doc): Scene {
  if (!hasOnlySceneTypes(doc)) throw new SceneInvalidError([{ path: "", code: "unknownField" }]);
  const result = validateScene(sceneFromYDoc(doc));
  if (!result.ok) throw new SceneInvalidError(result.problems);
  return result.scene;
}

export async function syncElementComments(tx: Transaction, itemId: string, scene: Scene): Promise<void> {
  const ids = scene.elements.filter((element) => !element.isDeleted).map((element) => element.id);
  const changed = await tx.execute<{ space_id: string }>(sql`
    with changed as (
      update comments c set detached_at = case when c.element_id = any(${sql.param(ids)}::text[]) then null else now() end,
        updated_at = now()
      where c.item_id = ${itemId} and c.parent_id is null and c.element_id is not null
        and (c.detached_at is null) = not (c.element_id = any(${sql.param(ids)}::text[]))
      returning c.item_id)
    select t.space_id from tree_items t where t.id = ${itemId} and exists (select 1 from changed)`);
  const spaceId = changed.rows[0]?.space_id;
  if (spaceId) await signalSpaceChange(tx, { spaceId, kind: "comments", itemId });
}

export class WhiteboardService {
  readonly #database: Database;
  readonly #files: FileService;
  readonly #storage: StorageService;
  readonly #people: PeopleService;
  readonly #settings: SettingsService;
  readonly #activity: ContentActivity;
  readonly #audit: AuditLog;
  readonly #origin: string;
  readonly #clock: () => number;

  constructor(options: {
    database: Database;
    files: FileService;
    storage: StorageService;
    people: PeopleService;
    settings: SettingsService;
    activity: ContentActivity;
    audit: AuditLog;
    origin: string;
    clock?: () => number;
  }) {
    this.#database = options.database;
    this.#files = options.files;
    this.#storage = options.storage;
    this.#people = options.people;
    this.#settings = options.settings;
    this.#activity = options.activity;
    this.#audit = options.audit;
    this.#origin = options.origin;
    this.#clock = options.clock ?? Date.now;
  }

  async stored(itemId: string, executor: Executor = this.#database): Promise<{ state: Uint8Array } | null> {
    const result = await executor.execute<{ state: Buffer }>(
      sql`select state from whiteboard_documents where item_id = ${itemId}`,
    );
    const row = result.rows[0];
    return row ? { state: new Uint8Array(row.state) } : null;
  }

  async scene(itemId: string): Promise<WhiteboardScene | null> {
    const result = await this.#database.execute<{
      scene: unknown;
      revision: number;
      updated_at: Date | string;
      updated_by: string | null;
      preview_id: string | null;
    }>(sql`
      select d.scene, d.revision, d.changed_at as updated_at, d.updated_by, d.preview_id
      from whiteboard_documents d join tree_items t on t.id = d.item_id
      where d.item_id = ${itemId} and t.kind = 'whiteboard'`);
    const row = result.rows[0];
    if (!row) return null;
    const names = await this.#people.names(row.updated_by ? [row.updated_by] : []);
    return {
      itemId,
      scene: storedScene(row.scene),
      revision: Number(row.revision),
      updatedAt: new Date(row.updated_at),
      updatedBy: row.updated_by ? { id: row.updated_by, name: names.get(row.updated_by) ?? null } : null,
      preview: row.preview_id !== null,
    };
  }

  async store(itemId: string, doc: Y.Doc, options: { actorId: string | null }): Promise<number> {
    return this.#database.transaction((tx) => this.#store(tx, itemId, doc, options.actorId));
  }

  async #ownFiles(executor: Executor, itemId: string, scene: Scene): Promise<Scene> {
    const referenced = [...new Set(Object.values(scene.files).map((file) => file.attachmentId))];
    if (referenced.length === 0) return scene;
    const own = await executor.execute<{ id: string }>(sql`
      select id from attachments where item_id = ${itemId} and id = any(${sql.param(referenced)}::uuid[])`);
    const allowed = new Set(own.rows.map((row) => row.id));
    return {
      ...scene,
      files: Object.fromEntries(
        Object.entries(scene.files).filter(([, file]) => allowed.has(file.attachmentId)),
      ),
    };
  }

  async #store(tx: Transaction, itemId: string, doc: Y.Doc, actorId: string | null): Promise<number> {
    const locked = await tx.execute<{ state: Buffer; space_id: string }>(sql`
      select d.state, t.space_id from whiteboard_documents d join tree_items t on t.id = d.item_id
      where d.item_id = ${itemId} for update of d`);
    const row = locked.rows[0];
    if (!row) throw new SpaceError("itemNotFound", "The whiteboard does not exist");
    Y.applyUpdate(doc, new Uint8Array(row.state), MERGE_ORIGIN);
    pruneDeletedElements(doc, this.#clock() - DELETED_ELEMENT_RETENTION_MS, NORMALIZE_ORIGIN);
    const scene = await this.#ownFiles(tx, itemId, visibleScene(readSceneOf(doc)));
    const revision = await tx.execute<{ revision: number }>(sql`
      update whiteboard_documents set state = ${encodeState(doc)}, scene = ${JSON.stringify(scene)}::jsonb,
        revision = revision + 1, updated_by = ${actorId}, updated_at = now(), changed_at = now()
      where item_id = ${itemId}
      returning revision`);
    await tx.execute(sql`update tree_items set content_updated_at = now() where id = ${itemId}`);
    await syncElementComments(tx, itemId, scene);
    const stored = Number(revision.rows[0]?.revision ?? 0);
    await signalSpaceChange(tx, { spaceId: row.space_id, kind: "page", itemId });
    await signalDocumentChange(tx, { itemId, revision: stored, origin: this.#origin });
    return stored;
  }

  async #lock(tx: Transaction, itemId: string): Promise<LockedBoard> {
    const result = await tx.execute<{
      space_id: string;
      organization_id: string | null;
      title: string;
      state: Buffer;
      scene: unknown;
      revision: number;
      versioned_revision: number;
      preview_id: string | null;
      latest: number | null;
    }>(sql`
      select t.space_id, s.organization_id, t.title, d.state, d.scene, d.revision, d.versioned_revision, d.preview_id,
        (select max(number) from whiteboard_versions where item_id = t.id) as latest
      from whiteboard_documents d join tree_items t on t.id = d.item_id join spaces s on s.id = t.space_id
      where d.item_id = ${itemId} and t.kind = 'whiteboard'
      for update of d`);
    const row = result.rows[0];
    if (!row) throw new SpaceError("itemNotFound", "The whiteboard does not exist");
    return {
      itemId,
      spaceId: row.space_id,
      organizationId: row.organization_id,
      title: row.title,
      state: new Uint8Array(row.state),
      scene: storedScene(row.scene),
      revision: Number(row.revision),
      versionedRevision: Number(row.versioned_revision),
      previewId: row.preview_id,
      latest: row.latest === null ? null : Number(row.latest),
    };
  }

  async #contributorsSince(executor: Executor, itemId: string, state: Uint8Array): Promise<string[]> {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, state);
    const current = Y.decodeStateVector(Y.encodeStateVector(doc));
    doc.destroy();
    const previous = await executor.execute<{ state_vector: Buffer }>(sql`
      select state_vector from whiteboard_versions where item_id = ${itemId} order by number desc limit 1`);
    const before = previous.rows[0]
      ? Y.decodeStateVector(new Uint8Array(previous.rows[0].state_vector))
      : new Map<number, number>();
    const clients = [...current]
      .filter(([client, clock]) => clock > (before.get(client) ?? 0))
      .map(([client]) => client);
    if (clients.length === 0) return [];
    const result = await executor.execute<{ account_id: string }>(sql`
      select distinct account_id from collaboration_clients
      where item_id = ${itemId} and client_id = any(${sql.param(clients)}::bigint[])
      order by account_id`);
    return result.rows.map((row) => row.account_id);
  }

  async #createVersion(
    tx: Transaction,
    board: LockedBoard,
    options: { reason: VersionReason; actorId: string | null; restoredFrom?: number },
  ): Promise<number> {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, board.state);
    const stateVector = Buffer.from(Y.encodeStateVector(doc));
    doc.destroy();
    const contributors = await this.#contributorsSince(tx, board.itemId, board.state);
    const number = (board.latest ?? 0) + 1;
    const preview = await tx.execute<{ id: string }>(sql`
      select id from whiteboard_previews where id = ${board.previewId} and revision = ${board.revision}`);
    await tx.execute(sql`
      insert into whiteboard_versions (id, item_id, number, title, scene, reason, restored_from, revision, state_vector,
        preview_id, contributors, created_by)
      values (${uuidv7()}, ${board.itemId}, ${number}, ${board.title}, ${JSON.stringify(board.scene)}::jsonb,
        ${options.reason}, ${options.restoredFrom ?? null}, ${board.revision}, ${stateVector},
        ${preview.rows[0]?.id ?? null}, ${sql.param(contributors)}::uuid[], ${options.actorId})`);
    await tx.execute(
      sql`update whiteboard_documents set versioned_revision = revision where item_id = ${board.itemId}`,
    );
    await signalSpaceChange(tx, { spaceId: board.spaceId, kind: "page", itemId: board.itemId });
    board.versionedRevision = board.revision;
    board.latest = number;
    return number;
  }

  async versionLiveSession(itemId: string): Promise<number | null> {
    return this.#database.transaction(async (tx) => {
      const board = await this.#lock(tx, itemId);
      if (board.revision <= board.versionedRevision) return null;
      const version = await this.#createVersion(tx, board, { reason: "session", actorId: null });
      await this.#activity.versionCreated(tx, itemId, version);
      return version;
    });
  }

  async endSession(itemId: string, node: string): Promise<number | null> {
    await this.#database.execute(
      sql`delete from collaboration_presence where item_id = ${itemId} and node = ${node}`,
    );
    const others = await this.#database.execute<{ present: boolean }>(sql`
      select exists (select 1 from collaboration_presence where item_id = ${itemId}
        and seen_at > now() - make_interval(secs => ${PRESENCE_STALE_SECONDS})) as present`);
    if (others.rows[0]?.present) return null;
    return this.versionLiveSession(itemId);
  }

  async versionIdleBoards(): Promise<number> {
    const candidates = await this.#database.execute<{
      item_id: string;
      space_id: string;
      organization_id: string | null;
      idle_seconds: number;
    }>(sql`
      select d.item_id, t.space_id, s.organization_id, extract(epoch from now() - d.changed_at) as idle_seconds
      from whiteboard_documents d join tree_items t on t.id = d.item_id join spaces s on s.id = t.space_id
      where d.revision > d.versioned_revision and d.changed_at <= now() - interval '1 minute'
        and t.trash_entry_id is null
      order by d.changed_at limit ${IDLE_BATCH}`);
    let created = 0;
    for (const row of candidates.rows) {
      const minutes = await this.#settings.get(liveVersionIdleMinutesSetting, {
        ...(row.organization_id ? { organization: row.organization_id } : {}),
        space: row.space_id,
      });
      if (Number(row.idle_seconds) < minutes * 60) continue;
      if ((await this.versionLiveSession(row.item_id)) !== null) created += 1;
    }
    return created;
  }

  async list(itemId: string): Promise<WhiteboardVersion[]> {
    const result = await this.#database.execute<{
      number: number;
      title: string;
      reason: VersionReason;
      restored_from: number | null;
      created_at: Date | string;
      created_by: string | null;
      contributors: string[];
      preview_id: string | null;
    }>(sql`
      select number, title, reason, restored_from, created_at, created_by, contributors, preview_id
      from whiteboard_versions where item_id = ${itemId} order by number desc limit 1000`);
    const names = await this.#people.names(
      result.rows.flatMap((row) => [...row.contributors, ...(row.created_by ? [row.created_by] : [])]),
    );
    return result.rows.map((row) => this.#version(row, names));
  }

  #version(
    row: {
      number: number;
      title: string;
      reason: VersionReason;
      restored_from: number | null;
      created_at: Date | string;
      created_by: string | null;
      contributors: string[];
      preview_id: string | null;
    },
    names: Map<string, string>,
  ): WhiteboardVersion {
    return {
      number: Number(row.number),
      title: row.title,
      reason: row.reason,
      restoredFrom: row.restored_from,
      createdAt: new Date(row.created_at),
      createdBy: row.created_by ? { id: row.created_by, name: names.get(row.created_by) ?? null } : null,
      contributors: row.contributors.map((id) => ({ id, name: names.get(id) ?? null })),
      preview: row.preview_id !== null,
    };
  }

  async get(itemId: string, number: number): Promise<WhiteboardVersionContent | null> {
    const result = await this.#database.execute<{
      number: number;
      title: string;
      reason: VersionReason;
      restored_from: number | null;
      created_at: Date | string;
      created_by: string | null;
      contributors: string[];
      preview_id: string | null;
      scene: unknown;
    }>(sql`
      select number, title, reason, restored_from, created_at, created_by, contributors, preview_id, scene
      from whiteboard_versions where item_id = ${itemId} and number = ${number}`);
    const row = result.rows[0];
    if (!row) return null;
    const names = await this.#people.names([
      ...row.contributors,
      ...(row.created_by ? [row.created_by] : []),
    ]);
    return { ...this.#version(row, names), scene: storedScene(row.scene) };
  }

  async restore(actor: Principal, itemId: string, number: number): Promise<number> {
    return this.#database.transaction(async (tx) => {
      const board = await this.#lock(tx, itemId);
      const version = await tx.execute<{ scene: unknown }>(
        sql`select scene from whiteboard_versions where item_id = ${itemId} and number = ${number}`,
      );
      const stored = version.rows[0];
      if (!stored) throw new SpaceError("versionNotFound", "The version does not exist");
      const doc = new Y.Doc();
      Y.applyUpdate(doc, board.state, MERGE_ORIGIN);
      applyScene(doc, storedScene(stored.scene), API_ORIGIN);
      const actorId = actorIdOf(actor);
      if (actorId) await recordClient(tx, itemId, doc.clientID, actorId);
      board.revision = await this.#store(tx, itemId, doc, actorId);
      board.state = new Uint8Array(encodeState(doc));
      doc.destroy();
      const refreshed = await tx.execute<{ scene: unknown }>(
        sql`select scene from whiteboard_documents where item_id = ${itemId}`,
      );
      board.scene = storedScene(refreshed.rows[0]?.scene);
      board.previewId = null;
      const created = await this.#createVersion(tx, board, {
        reason: "restored",
        actorId,
        restoredFrom: number,
      });
      await this.#activity.versionCreated(tx, itemId, created);
      await this.#audit.record(tx, {
        name: "whiteboard.versionRestored",
        actor,
        targetId: itemId,
        fields: { spaceId: board.spaceId, title: board.title, version: number, newVersion: created },
        scope: auditScopeOf(board),
      });
      return created;
    });
  }

  async setPreview(
    actor: Principal,
    itemId: string,
    input: { revision: number; body: Readable },
  ): Promise<boolean> {
    const svg = sanitizeSvg(await readText(input.body, MAX_PREVIEW_BYTES));
    await this.#storage.requireUpload();
    const stored = await this.#files.write(Readable.from([Buffer.from(svg, "utf8")]), {
      name: "preview.svg",
      maxBytes: MAX_PREVIEW_BYTES,
    });
    let kept = false;
    try {
      kept = await this.#database.transaction(async (tx) => {
        const current = await tx.execute<{
          revision: number;
          preview_revision: number | null;
          space_id: string;
        }>(sql`
          select d.revision, p.revision as preview_revision, t.space_id
          from whiteboard_documents d join tree_items t on t.id = d.item_id
          left join whiteboard_previews p on p.id = d.preview_id
          where d.item_id = ${itemId} for update of d`);
        const row = current.rows[0];
        if (!row) throw new SpaceError("itemNotFound", "The whiteboard does not exist");
        if (input.revision > Number(row.revision)) {
          throw new SpaceError("revisionNotStored", "The whiteboard has not been saved at this revision yet");
        }
        if (row.preview_revision !== null && Number(row.preview_revision) >= input.revision) return false;
        await this.#files.commit(tx, stored.id);
        const previewId = uuidv7();
        await tx.execute(sql`
          insert into whiteboard_previews (id, item_id, file_id, revision, created_by)
          values (${previewId}, ${itemId}, ${stored.id}, ${input.revision}, ${actorIdOf(actor)})`);
        await tx.execute(
          sql`update whiteboard_documents set preview_id = ${previewId} where item_id = ${itemId}`,
        );
        await tx.execute(sql`
          update whiteboard_versions set preview_id = ${previewId}
          where item_id = ${itemId} and revision = ${input.revision}`);
        await tx.execute(sql`
          delete from whiteboard_previews p where p.item_id = ${itemId} and p.id <> ${previewId}
            and not exists (select 1 from whiteboard_versions v where v.preview_id = p.id)`);
        await signalSpaceChange(tx, { spaceId: row.space_id, kind: "tree", itemId });
        return true;
      });
    } finally {
      if (!kept) {
        await this.#database.execute(
          sql`update stored_files set state = 'orphaned', updated_at = now() where id = ${stored.id} and state = 'stored'`,
        );
      }
    }
    return kept;
  }

  async preview(itemId: string, version?: number): Promise<StoredPreview | null> {
    const result = await this.#database.execute<{ id: string; file_id: string; size: string | number }>(
      version === undefined
        ? sql`select p.id, p.file_id, f.size from whiteboard_documents d
            join whiteboard_previews p on p.id = d.preview_id join stored_files f on f.id = p.file_id
            where d.item_id = ${itemId}`
        : sql`select p.id, p.file_id, f.size from whiteboard_versions v
            join whiteboard_previews p on p.id = v.preview_id join stored_files f on f.id = p.file_id
            where v.item_id = ${itemId} and v.number = ${version}`,
    );
    const row = result.rows[0];
    return row ? { id: row.id, fileId: row.file_id, size: Number(row.size) } : null;
  }

  async previewsOf(itemIds: readonly string[]): Promise<Map<string, string>> {
    if (itemIds.length === 0) return new Map();
    const result = await this.#database.execute<{ item_id: string; preview_id: string }>(sql`
      select item_id, preview_id from whiteboard_documents
      where item_id = any(${sql.param([...itemIds])}::uuid[]) and preview_id is not null`);
    return new Map(result.rows.map((row) => [row.item_id, row.preview_id]));
  }
}
