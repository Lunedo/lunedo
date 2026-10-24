import {
  type DocumentDiff,
  type DocumentJson,
  diffDocuments,
  editorSchemaVersion,
} from "@lunedo/editor-schema";
import { applyDocument } from "@lunedo/editor-schema/yjs";
import { uuidv7 } from "@lunedo/shared";
import { sql } from "drizzle-orm";
import * as Y from "yjs";
import { type Principal, SYSTEM } from "../accounts/principal.js";
import type { AuditLog } from "../audit/audit-log.js";
import { queueBlogAnnouncement } from "../collaboration/blog-subscriptions.js";
import { type ContentActivity, syncCommentAnchors } from "../collaboration/content.js";
import { type CopiedFrom, copiedFrom } from "../copies/sources.js";
import type { Database, Executor, Transaction } from "../database/database.js";
import {
  attachmentDraftChanges,
  discardAttachments,
  publishAttachments,
  restoreDiscardedAttachments,
} from "../files/publication.js";
import { requireSections } from "../knowledge-bases/required.js";
import type { ReviewService } from "../knowledge-bases/reviews.js";
import { isKnowledgeBase, knowledgeBaseModeError } from "../knowledge-bases/rules.js";
import type { SettingsService } from "../settings/service.js";
import { actorIdOf, auditScopeOf, SpaceError } from "./common.js";
import {
  API_ORIGIN,
  MERGE_ORIGIN,
  migrated,
  type PageDocumentService,
  recomputeLinks,
  recordClient,
} from "./documents.js";
import { lockSpaces } from "./items.js";
import type { PeopleService } from "./people.js";
import type { DiscardReason, PageMode, VersionReason } from "./schema.js";
import { liveVersionIdleMinutesSetting } from "./settings.js";
import { signalSpaceChange } from "./signals.js";
import { refreshReaderVisibility } from "./visibility.js";

export const DISCARDED_DRAFT_DAYS = 30;
export const VERSION_NOTE_MAX_LENGTH = 500;
export const PRESENCE_STALE_SECONDS = 120;
const IDLE_BATCH = 200;

export interface VersionPerson {
  id: string;
  name: string | null;
}

export interface PageVersion {
  number: number;
  title: string;
  note: string;
  reason: VersionReason;
  restoredFrom: number | null;
  createdAt: Date;
  createdBy: VersionPerson | null;
  contributors: VersionPerson[];
  copiedFrom: CopiedFrom | null;
}

export interface VersionContent extends PageVersion {
  document: DocumentJson;
}

export interface DraftState {
  title: string;
  document: DocumentJson;
  revision: number;
  updatedAt: Date;
  hasChanges: boolean;
  changes: number | null;
  basedOn: number | null;
  contributors: VersionPerson[];
}

export interface DiscardedDraft {
  id: string;
  title: string;
  reason: DiscardReason;
  discardedAt: Date;
  discardedBy: VersionPerson | null;
  expiresAt: Date;
  contributors: VersionPerson[];
}

export type VersionReference = number | "draft";

interface LockedPage {
  itemId: string;
  kind: "page" | "blogPost";
  spaceId: string;
  organizationId: string | null;
  mode: PageMode;
  title: string;
  publishedVersionId: string | null;
  publishedNumber: number | null;
  state: Uint8Array;
  snapshot: unknown;
  schemaVersion: number;
  revision: number;
  versionedRevision: number;
  draftTitle: string | null;
  latest: number | null;
  attachmentChanges: number;
}

function hasDraftChanges(page: LockedPage): boolean {
  return (
    page.publishedVersionId === null ||
    page.revision > page.versionedRevision ||
    page.draftTitle !== null ||
    page.attachmentChanges > 0
  );
}

function cleanNote(note: string): string {
  const value = note.replace(/\s+/g, " ").trim();
  if (value.length > VERSION_NOTE_MAX_LENGTH) {
    throw new SpaceError("invalidNote", `The note can have up to ${VERSION_NOTE_MAX_LENGTH} characters`);
  }
  return value;
}

export class VersionService {
  readonly #database: Database;
  readonly #audit: AuditLog;
  readonly #documents: PageDocumentService;
  readonly #people: PeopleService;
  readonly #settings: SettingsService;
  readonly #activity: ContentActivity;
  #reviews: ReviewService | undefined;

  constructor(options: {
    database: Database;
    audit: AuditLog;
    documents: PageDocumentService;
    people: PeopleService;
    settings: SettingsService;
    activity: ContentActivity;
  }) {
    this.#database = options.database;
    this.#audit = options.audit;
    this.#documents = options.documents;
    this.#people = options.people;
    this.#settings = options.settings;
    this.#activity = options.activity;
  }

  useReviews(reviews: ReviewService): void {
    this.#reviews = reviews;
  }

  async #lock(tx: Transaction, itemId: string): Promise<LockedPage> {
    await tx.execute(sql`select item_id from page_documents where item_id = ${itemId} for update`);
    const result = await tx.execute<{
      space_id: string;
      organization_id: string | null;
      kind: "page" | "blogPost";
      mode: PageMode;
      title: string;
      published_version_id: string | null;
      published_number: number | null;
      state: Buffer;
      snapshot: unknown;
      schema_version: number;
      revision: number;
      versioned_revision: number;
      draft_title: string | null;
      latest: number | null;
    }>(sql`
      select t.space_id, s.organization_id, t.kind, t.mode, t.title, t.published_version_id,
        (select number from page_versions where id = t.published_version_id) as published_number,
        d.state, d.snapshot, d.schema_version, d.revision, d.versioned_revision, d.draft_title,
        (select max(number) from page_versions where item_id = t.id) as latest
      from page_documents d join tree_items t on t.id = d.item_id join spaces s on s.id = t.space_id
      where d.item_id = ${itemId} and t.kind in ('page', 'blogPost')`);
    const row = result.rows[0];
    if (!row) throw new SpaceError("itemNotFound", "The page does not exist");
    return {
      itemId,
      kind: row.kind,
      spaceId: row.space_id,
      organizationId: row.organization_id,
      mode: row.mode,
      title: row.title,
      publishedVersionId: row.published_version_id,
      publishedNumber: row.published_number === null ? null : Number(row.published_number),
      state: new Uint8Array(row.state),
      snapshot: row.snapshot,
      schemaVersion: row.schema_version,
      revision: Number(row.revision),
      versionedRevision: Number(row.versioned_revision),
      draftTitle: row.draft_title,
      latest: row.latest === null ? null : Number(row.latest),
      attachmentChanges: await attachmentDraftChanges(tx, itemId),
    };
  }

  async #contributorsSince(executor: Executor, itemId: string, state: Uint8Array): Promise<string[]> {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, state);
    const current = Y.decodeStateVector(Y.encodeStateVector(doc));
    doc.destroy();
    const previous = await executor.execute<{ state_vector: Buffer }>(sql`
      select state_vector from page_versions where item_id = ${itemId} order by number desc limit 1`);
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
    page: LockedPage,
    options: { reason: VersionReason; note?: string; actorId: string | null; restoredFrom?: number },
  ): Promise<number> {
    const document = migrated(page.snapshot, page.schemaVersion);
    const title = page.draftTitle ?? page.title;
    const doc = new Y.Doc();
    Y.applyUpdate(doc, page.state);
    const stateVector = Buffer.from(Y.encodeStateVector(doc));
    doc.destroy();
    const contributors = await this.#contributorsSince(tx, page.itemId, page.state);
    const number = (page.latest ?? 0) + 1;
    const id = uuidv7();
    await tx.execute(sql`
      insert into page_versions (id, item_id, number, title, document, schema_version, note, reason, restored_from,
        revision, state_vector, contributors, created_by)
      values (${id}, ${page.itemId}, ${number}, ${title}, ${JSON.stringify(document)}::jsonb, ${editorSchemaVersion},
        ${options.note ?? ""}, ${options.reason}, ${options.restoredFrom ?? null}, ${page.revision}, ${stateVector},
        ${sql.param(contributors)}::uuid[], ${options.actorId})`);
    await tx.execute(sql`
      update page_documents set versioned_revision = revision, draft_title = null where item_id = ${page.itemId}`);
    await tx.execute(sql`
      update tree_items set title = ${title}, published_version_id = ${id}, content_updated_at = now(),
        updated_at = now()
      where id = ${page.itemId}`);
    await publishAttachments(tx, page.itemId);
    const post = await tx.execute<{ first: boolean }>(sql`
      with previous as (select published_at from blog_posts where item_id = ${page.itemId} for update)
      update blog_posts b set published_at = coalesce(b.published_at, now()), scheduled_at = null, scheduled_by = null,
        scheduled_time_zone = null, held_at = null, updated_at = now()
      from previous where b.item_id = ${page.itemId}
      returning previous.published_at is null as first`);
    if (post.rows[0]?.first && options.reason !== "imported") await queueBlogAnnouncement(tx, page.itemId);
    await recomputeLinks(tx, page.itemId, document);
    await signalSpaceChange(tx, { spaceId: page.spaceId, kind: "page", itemId: page.itemId });
    await signalSpaceChange(tx, { spaceId: page.spaceId, kind: "tree", itemId: page.itemId });
    Object.assign(page, {
      publishedVersionId: id,
      publishedNumber: number,
      versionedRevision: page.revision,
      draftTitle: null,
      title,
      latest: number,
      attachmentChanges: 0,
    });
    return number;
  }

  async #replaceContent(
    tx: Transaction,
    page: LockedPage,
    actor: Principal,
    document: DocumentJson,
    notify = true,
  ): Promise<number> {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, page.state, MERGE_ORIGIN);
    applyDocument(doc, document, API_ORIGIN);
    const actorId = actorIdOf(actor);
    if (actorId) await recordClient(tx, page.itemId, doc.clientID, actorId);
    const revision = await this.#documents.storeLocked(tx, page.itemId, doc, actorId, { notify });
    await tx.execute(sql`update page_documents set draft_note = null where item_id = ${page.itemId}`);
    const stored = await tx.execute<{ state: Buffer; snapshot: unknown; schema_version: number }>(
      sql`select state, snapshot, schema_version from page_documents where item_id = ${page.itemId}`,
    );
    const row = stored.rows[0];
    if (row) {
      page.state = new Uint8Array(row.state);
      page.snapshot = row.snapshot;
      page.schemaVersion = row.schema_version;
    }
    page.revision = revision;
    doc.destroy();
    return revision;
  }

  async #saveDraft(
    tx: Transaction,
    page: LockedPage,
    actor: Principal,
    reason: DiscardReason,
  ): Promise<string> {
    const id = uuidv7();
    const contributors = await this.#contributorsSince(tx, page.itemId, page.state);
    await tx.execute(sql`
      insert into discarded_drafts (id, item_id, title, document, schema_version, reason, contributors, discarded_by,
        expires_at)
      values (${id}, ${page.itemId}, ${page.draftTitle ?? page.title},
        ${JSON.stringify(migrated(page.snapshot, page.schemaVersion))}::jsonb, ${editorSchemaVersion}, ${reason},
        ${sql.param(contributors)}::uuid[], ${actorIdOf(actor)},
        now() + make_interval(days => ${DISCARDED_DRAFT_DAYS}))`);
    return id;
  }

  async #versionDocument(
    executor: Executor,
    itemId: string,
    number: number,
  ): Promise<{ title: string; document: DocumentJson } | null> {
    const result = await executor.execute<{ title: string; document: unknown; schema_version: number }>(sql`
      select title, document, schema_version from page_versions where item_id = ${itemId} and number = ${number}`);
    const row = result.rows[0];
    return row ? { title: row.title, document: migrated(row.document, row.schema_version) } : null;
  }

  async #setDraftTitle(tx: Transaction, page: LockedPage, title: string): Promise<void> {
    const draftTitle = title === page.title ? null : title;
    await tx.execute(
      sql`update page_documents set draft_title = ${draftTitle} where item_id = ${page.itemId}`,
    );
    page.draftTitle = draftTitle;
  }

  async #lockSpaceOf(tx: Transaction, itemId: string): Promise<void> {
    const before = await tx.execute<{ space_id: string }>(
      sql`select space_id from tree_items where id = ${itemId}`,
    );
    const spaceId = before.rows[0]?.space_id;
    if (!spaceId) throw new SpaceError("itemNotFound", "The item does not exist");
    await lockSpaces(tx, [spaceId]);
    const after = await tx.execute<{ space_id: string }>(
      sql`select space_id from tree_items where id = ${itemId}`,
    );
    if (after.rows[0]?.space_id !== spaceId) {
      throw new SpaceError("itemMoved", "Someone else moved the item at the same moment; try again");
    }
  }

  async publish(
    actor: Principal,
    itemId: string,
    input: { note?: string | undefined; reviewed?: boolean | undefined } = {},
  ): Promise<{ version: number; created: boolean }> {
    const given = cleanNote(input.note ?? "");
    return this.#database.transaction(async (tx) => {
      await this.#lockSpaceOf(tx, itemId);
      const page = await this.#lock(tx, itemId);
      if (page.mode !== "publish") {
        throw new SpaceError("notPublishMode", "Pages in live mode show every change at once");
      }
      if (!hasDraftChanges(page) && page.publishedNumber !== null) {
        return { version: page.publishedNumber, created: false };
      }
      await requireSections(tx, itemId, migrated(page.snapshot, page.schemaVersion));
      const pending = await tx.execute<{ draft_note: string | null }>(
        sql`select draft_note from page_documents where item_id = ${itemId}`,
      );
      const note = given || cleanNote(pending.rows[0]?.draft_note ?? "");
      const version = await this.#publishLocked(tx, page, actorIdOf(actor), note);
      await this.#audit.record(tx, {
        name: "page.published",
        actor,
        targetId: itemId,
        fields: { spaceId: page.spaceId, title: page.title, version, note },
        scope: auditScopeOf(page),
      });
      if (actor.type === "account" && actor.token) {
        await this.#audit.record(tx, {
          name: "page.publishedWithToken",
          actor,
          targetId: itemId,
          fields: { spaceId: page.spaceId, title: page.title, version, note, credentialId: actor.token.id },
          scope: auditScopeOf(page),
        });
      }
      if (input.reviewed) await this.#reviews?.reviewedOnPublish(tx, actor, itemId);
      return { version, created: true };
    });
  }

  async #publishLocked(
    tx: Transaction,
    page: LockedPage,
    actorId: string | null,
    note: string,
  ): Promise<number> {
    const version = await this.#createVersion(tx, page, { reason: "published", note, actorId });
    await tx.execute(sql`update page_documents set draft_note = null where item_id = ${page.itemId}`);
    const revealed = await refreshReaderVisibility(tx, [page.itemId]);
    const document = migrated(page.snapshot, page.schemaVersion);
    await syncCommentAnchors(tx, page.itemId, document);
    await this.#activity.readerContentChanged(tx, page.itemId, document, actorId);
    await this.#activity.revealed(tx, revealed);
    await this.#activity.versionCreated(tx, page.itemId, version);
    return version;
  }

  async publishScheduled(
    itemId: string,
    options: {
      mayPublish: (tx: Transaction, accountId: string) => Promise<boolean>;
      onHeld: (tx: Transaction, held: { scheduledBy: string | null }) => Promise<void>;
    },
  ): Promise<{ version: number; scheduledBy: string } | null> {
    return this.#database.transaction(async (tx) => {
      const due = await tx.execute<{ scheduled_by: string | null }>(sql`
        select scheduled_by from blog_posts where item_id = ${itemId} and scheduled_at <= now() and held_at is null
        for update skip locked`);
      const row = due.rows[0];
      if (!row) return null;
      const scheduledBy = row.scheduled_by;
      if (!scheduledBy || !(await options.mayPublish(tx, scheduledBy))) {
        await tx.execute(
          sql`update blog_posts set held_at = now(), updated_at = now() where item_id = ${itemId}`,
        );
        await options.onHeld(tx, { scheduledBy });
        return null;
      }
      await this.#lockSpaceOf(tx, itemId);
      const page = await this.#lock(tx, itemId);
      const version =
        hasDraftChanges(page) || page.publishedNumber === null
          ? await this.#publishLocked(tx, page, scheduledBy, "")
          : (page.publishedNumber ?? 0);
      await tx.execute(sql`
        update blog_posts set published_at = coalesce(published_at, now()), scheduled_at = null, scheduled_by = null,
          scheduled_time_zone = null, updated_at = now()
        where item_id = ${itemId}`);
      await this.#audit.record(tx, {
        name: "blogPost.publishedBySchedule",
        actor: { type: "system" },
        targetId: itemId,
        fields: { spaceId: page.spaceId, title: page.title, version, scheduledBy },
        scope: auditScopeOf(page),
      });
      return { version, scheduledBy };
    });
  }

  async publishHeld(actor: Principal, itemId: string): Promise<number> {
    return this.#database.transaction(async (tx) => {
      const held = await tx.execute<{ scheduled_by: string | null }>(sql`
        select scheduled_by from blog_posts where item_id = ${itemId} and held_at is not null for update`);
      const row = held.rows[0];
      if (!row) throw new SpaceError("notHeld", "The blog post is not waiting for approval");
      await this.#lockSpaceOf(tx, itemId);
      const page = await this.#lock(tx, itemId);
      const version =
        hasDraftChanges(page) || page.publishedNumber === null
          ? await this.#publishLocked(tx, page, actorIdOf(actor), "")
          : (page.publishedNumber ?? 0);
      await tx.execute(sql`
        update blog_posts set published_at = coalesce(published_at, now()), scheduled_at = null, scheduled_by = null,
          scheduled_time_zone = null, held_at = null, updated_at = now()
        where item_id = ${itemId}`);
      await this.#audit.record(tx, {
        name: "blogPost.heldPublished",
        actor,
        targetId: itemId,
        fields: { spaceId: page.spaceId, title: page.title, version, scheduledBy: row.scheduled_by },
        scope: auditScopeOf(page),
      });
      await signalSpaceChange(tx, { spaceId: page.spaceId, kind: "blog", itemId });
      return version;
    });
  }

  async discard(actor: Principal, itemId: string): Promise<{ discardedDraftId: string }> {
    return this.#database.transaction(async (tx) => {
      const page = await this.#lock(tx, itemId);
      if (page.mode !== "publish" || page.publishedNumber === null || !hasDraftChanges(page)) {
        throw new SpaceError("nothingToDiscard", "The draft has no changes since the published version");
      }
      const published = await this.#versionDocument(tx, itemId, page.publishedNumber);
      if (!published) throw new SpaceError("itemNotFound", "The published version does not exist");
      const discardedDraftId = await this.#saveDraft(tx, page, actor, "discarded");
      await discardAttachments(tx, itemId, discardedDraftId, actorIdOf(actor));
      await signalSpaceChange(tx, { spaceId: page.spaceId, kind: "draft", itemId });
      await this.#replaceContent(tx, page, actor, published.document);
      await tx.execute(sql`
        update page_documents set versioned_revision = revision, draft_title = null where item_id = ${itemId}`);
      await this.#audit.record(tx, {
        name: "page.draftDiscarded",
        actor,
        targetId: itemId,
        fields: { spaceId: page.spaceId, title: page.draftTitle ?? page.title, discardedDraftId },
        scope: auditScopeOf(page),
      });
      return { discardedDraftId };
    });
  }

  async restoreDiscarded(actor: Principal, itemId: string, discardedDraftId: string): Promise<void> {
    await this.#database.transaction(async (tx) => {
      const page = await this.#lock(tx, itemId);
      const found = await tx.execute<{ title: string; document: unknown; schema_version: number }>(sql`
        select title, document, schema_version from discarded_drafts
        where id = ${discardedDraftId} and item_id = ${itemId} and expires_at > now()
        for update`);
      const discarded = found.rows[0];
      if (!discarded) throw new SpaceError("discardedDraftNotFound", "The discarded draft does not exist");
      if (page.mode !== "publish") {
        throw new SpaceError("notPublishMode", "Only pages in publish mode have a draft");
      }
      if (hasDraftChanges(page) && page.publishedNumber !== null) {
        const replaced = await this.#saveDraft(tx, page, actor, "replaced");
        await discardAttachments(tx, itemId, replaced, actorIdOf(actor));
      }
      await restoreDiscardedAttachments(tx, itemId, discardedDraftId, actorIdOf(actor));
      await this.#replaceContent(tx, page, actor, migrated(discarded.document, discarded.schema_version));
      await this.#setDraftTitle(tx, page, discarded.title);
      await tx.execute(sql`delete from discarded_drafts where id = ${discardedDraftId}`);
      await signalSpaceChange(tx, { spaceId: page.spaceId, kind: "draft", itemId });
    });
  }

  async restore(
    actor: Principal,
    itemId: string,
    number: number,
  ): Promise<{ mode: PageMode; version: number | null }> {
    return this.#database.transaction(async (tx) => {
      const page = await this.#lock(tx, itemId);
      const version = await this.#versionDocument(tx, itemId, number);
      if (!version) throw new SpaceError("versionNotFound", "The version does not exist");
      let created: number | null = null;
      if (page.mode === "publish") {
        if (hasDraftChanges(page) && page.publishedNumber !== null) {
          await this.#saveDraft(tx, page, actor, "replaced");
        }
        await this.#replaceContent(tx, page, actor, version.document);
        await this.#setDraftTitle(tx, page, version.title);
        await signalSpaceChange(tx, { spaceId: page.spaceId, kind: "draft", itemId });
      } else {
        await this.#replaceContent(tx, page, actor, version.document);
        page.draftTitle = version.title;
        created = await this.#createVersion(tx, page, {
          reason: "restored",
          actorId: actorIdOf(actor),
          restoredFrom: number,
        });
        await this.#activity.versionCreated(tx, itemId, created);
      }
      await this.#audit.record(tx, {
        name: "page.versionRestored",
        actor,
        targetId: itemId,
        fields: {
          spaceId: page.spaceId,
          title: version.title,
          version: number,
          mode: page.mode,
          newVersion: created,
        },
        scope: auditScopeOf(page),
      });
      return { mode: page.mode, version: created };
    });
  }

  async changeMode(
    actor: Principal,
    itemId: string,
    mode: PageMode,
    options: { confirmDraft?: boolean | undefined } = {},
  ): Promise<void> {
    await this.#database.transaction(async (tx) => {
      await this.#lockSpaceOf(tx, itemId);
      const page = await this.#lock(tx, itemId);
      if (page.kind === "blogPost") {
        throw new SpaceError("blogPostMode", "Blog posts are always published with versions");
      }
      if (page.mode === mode) return;
      if (await isKnowledgeBase(tx, page.spaceId)) throw knowledgeBaseModeError();
      const previousMode = page.mode;
      if (mode === "publish") {
        if (page.revision > page.versionedRevision || page.latest === null) {
          await this.#createVersion(tx, page, { reason: "modeChanged", actorId: actorIdOf(actor) });
        }
      } else {
        const pending = hasDraftChanges(page);
        if (pending && !options.confirmDraft) {
          throw new SpaceError(
            "draftPending",
            "The draft becomes visible to readers at once; confirm to switch to live mode",
          );
        }
        if (pending)
          await this.#createVersion(tx, page, { reason: "modeChanged", actorId: actorIdOf(actor) });
      }
      await tx.execute(sql`update tree_items set mode = ${mode}, updated_at = now() where id = ${itemId}`);
      await publishAttachments(tx, itemId);
      const revealed = await refreshReaderVisibility(tx, [itemId]);
      await this.#activity.readerContentChanged(
        tx,
        itemId,
        migrated(page.snapshot, page.schemaVersion),
        actorIdOf(actor),
      );
      await this.#activity.revealed(tx, revealed);
      await signalSpaceChange(tx, { spaceId: page.spaceId, kind: "page", itemId });
      await signalSpaceChange(tx, { spaceId: page.spaceId, kind: "tree", itemId });
      await this.#audit.record(tx, {
        name: "page.modeChanged",
        actor,
        targetId: itemId,
        fields: { spaceId: page.spaceId, title: page.draftTitle ?? page.title, mode, previousMode },
        scope: auditScopeOf(page),
      });
    });
  }

  async importVersion(
    tx: Transaction,
    input: { itemId: string; title: string; document: DocumentJson; authorId: string | null; apply: boolean },
  ): Promise<number> {
    const page = await this.#lock(tx, input.itemId);
    if (!input.apply) {
      const number = (page.latest ?? 0) + 1;
      const doc = new Y.Doc();
      Y.applyUpdate(doc, page.state);
      const stateVector = Buffer.from(Y.encodeStateVector(doc));
      doc.destroy();
      await tx.execute(sql`
        insert into page_versions (id, item_id, number, title, document, schema_version, reason, revision,
          state_vector, contributors, created_by)
        values (${uuidv7()}, ${page.itemId}, ${number}, ${input.title}, ${JSON.stringify(input.document)}::jsonb,
          ${editorSchemaVersion}, 'importedNotApplied', ${page.revision}, ${stateVector},
          ${sql.param(input.authorId ? [input.authorId] : [])}::uuid[], ${input.authorId})`);
      await signalSpaceChange(tx, { spaceId: page.spaceId, kind: "page", itemId: page.itemId });
      return number;
    }
    if (page.mode === "publish" && hasDraftChanges(page) && page.publishedNumber !== null) {
      const replaced = await this.#saveDraft(tx, page, SYSTEM, "replaced");
      await discardAttachments(tx, page.itemId, replaced, null);
    }
    await this.#replaceContent(tx, page, SYSTEM, input.document, false);
    page.draftTitle = input.title;
    const number = await this.#createVersion(tx, page, { reason: "imported", actorId: input.authorId });
    await refreshReaderVisibility(tx, [page.itemId]);
    return number;
  }

  async renameDraft(tx: Transaction, itemId: string, title: string): Promise<boolean> {
    await tx.execute(sql`select item_id from page_documents where item_id = ${itemId} for update`);
    const result = await tx.execute<{ mode: PageMode; title: string; published: boolean }>(sql`
      select t.mode, t.title, t.published_version_id is not null as published
      from tree_items t join page_documents d on d.item_id = t.id
      where t.id = ${itemId} and t.kind in ('page', 'blogPost')`);
    const row = result.rows[0];
    if (row?.mode !== "publish" || !row.published) return false;
    await tx.execute(sql`
      update page_documents set draft_title = ${title === row.title ? null : title}, changed_at = now()
      where item_id = ${itemId}`);
    return true;
  }

  #person(names: Map<string, string>, id: string | null): VersionPerson | null {
    return id ? { id, name: names.get(id) ?? null } : null;
  }

  async list(itemId: string): Promise<PageVersion[]> {
    const result = await this.#database.execute<{
      number: number;
      title: string;
      note: string;
      reason: VersionReason;
      restored_from: number | null;
      created_at: Date | string;
      created_by: string | null;
      contributors: string[];
      copied_from_id: string | null;
      copied_from_title: string | null;
    }>(sql`
      select number, title, note, reason, restored_from, created_at, created_by, contributors, copied_from_id,
        copied_from_title
      from page_versions where item_id = ${itemId} order by number desc limit 1000`);
    const names = await this.#people.names(
      result.rows.flatMap((row) => [...row.contributors, ...(row.created_by ? [row.created_by] : [])]),
    );
    return result.rows.map((row) => ({
      number: Number(row.number),
      title: row.title,
      note: row.note,
      reason: row.reason,
      restoredFrom: row.restored_from,
      createdAt: new Date(row.created_at),
      createdBy: this.#person(names, row.created_by),
      contributors: row.contributors.map((id) => ({ id, name: names.get(id) ?? null })),
      copiedFrom: copiedFrom(row),
    }));
  }

  async get(itemId: string, number: number): Promise<VersionContent | null> {
    const versions = await this.#database.execute<{
      number: number;
      title: string;
      note: string;
      reason: VersionReason;
      restored_from: number | null;
      created_at: Date | string;
      created_by: string | null;
      contributors: string[];
      copied_from_id: string | null;
      copied_from_title: string | null;
      document: unknown;
      schema_version: number;
    }>(sql`
      select number, title, note, reason, restored_from, created_at, created_by, contributors, copied_from_id,
        copied_from_title, document, schema_version
      from page_versions where item_id = ${itemId} and number = ${number}`);
    const row = versions.rows[0];
    if (!row) return null;
    const names = await this.#people.names([
      ...row.contributors,
      ...(row.created_by ? [row.created_by] : []),
    ]);
    return {
      number: Number(row.number),
      title: row.title,
      note: row.note,
      reason: row.reason,
      restoredFrom: row.restored_from,
      createdAt: new Date(row.created_at),
      createdBy: this.#person(names, row.created_by),
      contributors: row.contributors.map((id) => ({ id, name: names.get(id) ?? null })),
      copiedFrom: copiedFrom(row),
      document: migrated(row.document, row.schema_version),
    };
  }

  async draft(itemId: string): Promise<DraftState> {
    const result = await this.#database.execute<{
      mode: PageMode;
      title: string;
      draft_title: string | null;
      snapshot: unknown;
      schema_version: number;
      revision: number;
      versioned_revision: number;
      state: Buffer;
      updated_at: Date | string;
      published_version_id: string | null;
      published_number: number | null;
      published_title: string | null;
      published_document: unknown;
      published_schema: number | null;
    }>(sql`
      select t.mode, t.title, d.draft_title, d.snapshot, d.schema_version, d.revision, d.versioned_revision, d.state,
        d.updated_at, t.published_version_id, v.number as published_number, v.title as published_title,
        v.document as published_document, v.schema_version as published_schema
      from tree_items t join page_documents d on d.item_id = t.id
      left join page_versions v on v.id = t.published_version_id
      where t.id = ${itemId} and t.kind in ('page', 'blogPost')`);
    const row = result.rows[0];
    if (!row) throw new SpaceError("itemNotFound", "The page does not exist");
    const title = row.draft_title ?? row.title;
    const document = migrated(row.snapshot, row.schema_version);
    const contributors = await this.#contributorsSince(this.#database, itemId, new Uint8Array(row.state));
    const names = await this.#people.names(contributors);
    const published =
      row.published_number !== null && row.published_schema !== null
        ? {
            title: row.published_title ?? row.title,
            document: migrated(row.published_document, row.published_schema),
          }
        : null;
    const attachmentChanges = await attachmentDraftChanges(this.#database, itemId);
    const hasChanges =
      row.published_version_id === null ||
      Number(row.revision) > Number(row.versioned_revision) ||
      row.draft_title !== null ||
      attachmentChanges > 0;
    return {
      title,
      document,
      revision: Number(row.revision),
      updatedAt: new Date(row.updated_at),
      hasChanges,
      changes: published
        ? hasChanges
          ? diffDocuments(published, { title, document }).changes + attachmentChanges
          : 0
        : null,
      basedOn: row.published_number === null ? null : Number(row.published_number),
      contributors: contributors.map((id) => ({ id, name: names.get(id) ?? null })),
    };
  }

  async compare(
    itemId: string,
    from: VersionReference,
    to: VersionReference,
  ): Promise<{ diff: DocumentDiff; before: DocumentJson; after: DocumentJson }> {
    const side = async (reference: VersionReference) => {
      if (reference === "draft") {
        const draft = await this.draft(itemId);
        return { title: draft.title, document: draft.document };
      }
      const version = await this.#versionDocument(this.#database, itemId, reference);
      if (!version) throw new SpaceError("versionNotFound", "The version does not exist");
      return version;
    };
    const before = await side(from);
    const after = await side(to);
    return { diff: diffDocuments(before, after), before: before.document, after: after.document };
  }

  async discardedDrafts(itemId: string): Promise<DiscardedDraft[]> {
    const result = await this.#database.execute<{
      id: string;
      title: string;
      reason: DiscardReason;
      discarded_at: Date | string;
      discarded_by: string | null;
      expires_at: Date | string;
      contributors: string[];
    }>(sql`
      select id, title, reason, discarded_at, discarded_by, expires_at, contributors from discarded_drafts
      where item_id = ${itemId} and expires_at > now() order by discarded_at desc limit 200`);
    const names = await this.#people.names(
      result.rows.flatMap((row) => [...row.contributors, ...(row.discarded_by ? [row.discarded_by] : [])]),
    );
    return result.rows.map((row) => ({
      id: row.id,
      title: row.title,
      reason: row.reason,
      discardedAt: new Date(row.discarded_at),
      discardedBy: this.#person(names, row.discarded_by),
      expiresAt: new Date(row.expires_at),
      contributors: row.contributors.map((id) => ({ id, name: names.get(id) ?? null })),
    }));
  }

  async discardedDraft(
    itemId: string,
    discardedDraftId: string,
  ): Promise<{ title: string; document: DocumentJson } | null> {
    const result = await this.#database.execute<{
      title: string;
      document: unknown;
      schema_version: number;
    }>(sql`
      select title, document, schema_version from discarded_drafts
      where id = ${discardedDraftId} and item_id = ${itemId} and expires_at > now()`);
    const row = result.rows[0];
    return row ? { title: row.title, document: migrated(row.document, row.schema_version) } : null;
  }

  async removeExpiredDrafts(): Promise<number> {
    const result = await this.#database.execute(sql`delete from discarded_drafts where expires_at <= now()`);
    return result.rowCount ?? 0;
  }

  async versionLiveSession(itemId: string): Promise<number | null> {
    return this.#database.transaction(async (tx) => {
      const page = await this.#lock(tx, itemId);
      if (page.mode !== "live" || page.revision <= page.versionedRevision) return null;
      const version = await this.#createVersion(tx, page, { reason: "session", actorId: null });
      await this.#activity.versionCreated(tx, itemId, version);
      return version;
    });
  }

  async touchPresence(itemId: string, node: string, connections: number): Promise<void> {
    if (connections <= 0) {
      await this.#database.execute(
        sql`delete from collaboration_presence where item_id = ${itemId} and node = ${node}`,
      );
      return;
    }
    await this.#database.execute(sql`
      insert into collaboration_presence (item_id, node, connections, seen_at)
      select ${itemId}, ${node}, ${connections}, now() where exists (select 1 from tree_items where id = ${itemId})
      on conflict (item_id, node) do update set connections = excluded.connections, seen_at = now()`);
  }

  async heartbeat(node: string, itemIds: readonly string[]): Promise<void> {
    if (itemIds.length === 0) return;
    await this.#database.execute(sql`
      update collaboration_presence set seen_at = now()
      where node = ${node} and item_id = any(${sql.param([...itemIds])}::uuid[])`);
    await this.#database.execute(sql`
      update collaboration_editors set seen_at = now()
      where node = ${node} and item_id = any(${sql.param([...itemIds])}::uuid[])`);
  }

  async touchEditor(itemId: string, node: string, accountId: string, change: 1 | -1): Promise<void> {
    await this.#database.transaction(async (tx) => {
      const item = await tx.execute<{ space_id: string }>(
        sql`select space_id from tree_items where id = ${itemId}`,
      );
      const spaceId = item.rows[0]?.space_id;
      if (!spaceId) return;
      await tx.execute(sql`
        insert into collaboration_editors (item_id, node, account_id, connections, seen_at)
        values (${itemId}, ${node}, ${accountId}, ${Math.max(change, 0)}, now())
        on conflict (item_id, node, account_id) do update
          set connections = collaboration_editors.connections + ${change}, seen_at = now()`);
      await tx.execute(sql`
        delete from collaboration_editors
        where item_id = ${itemId} and node = ${node} and account_id = ${accountId} and connections <= 0`);
      await signalSpaceChange(tx, { spaceId, kind: "editing", itemId });
    });
  }

  async editors(
    viewer: Principal,
    itemId: string,
  ): Promise<{ id: string; name: string | null; pictureRef: string | null }[]> {
    const result = await this.#database.execute<{
      id: string;
      name: string | null;
      picture_ref: string | null;
    }>(sql`
      select a.id, ${this.#people.visibleName(viewer, sql`a`)} as name, a.picture_ref
      from accounts a
      where a.id in (
        select account_id from collaboration_editors
        where item_id = ${itemId} and seen_at > now() - make_interval(secs => ${PRESENCE_STALE_SECONDS})
      )
      order by a.id`);
    return result.rows.map((row) => ({ id: row.id, name: row.name, pictureRef: row.picture_ref }));
  }

  async endSession(itemId: string, node: string): Promise<number | null> {
    await this.touchPresence(itemId, node, 0);
    await this.#endEditors(itemId, node);
    const others = await this.#database.execute<{ present: boolean }>(sql`
      select exists (select 1 from collaboration_presence where item_id = ${itemId}
        and seen_at > now() - make_interval(secs => ${PRESENCE_STALE_SECONDS})) as present`);
    if (others.rows[0]?.present) return null;
    return this.versionLiveSession(itemId);
  }

  async #endEditors(itemId: string, node: string): Promise<void> {
    await this.#database.transaction(async (tx) => {
      const removed = await tx.execute<{ space_id: string }>(sql`
        delete from collaboration_editors e using tree_items t
        where e.item_id = ${itemId} and e.node = ${node} and t.id = e.item_id
        returning t.space_id`);
      const spaceId = removed.rows[0]?.space_id;
      if (spaceId) await signalSpaceChange(tx, { spaceId, kind: "editing", itemId });
    });
  }

  async versionIdlePages(): Promise<number> {
    await this.#database.execute(sql`
      delete from collaboration_presence where seen_at <= now() - make_interval(secs => ${PRESENCE_STALE_SECONDS * 5})`);
    await this.#database.execute(sql`
      delete from collaboration_editors where seen_at <= now() - make_interval(secs => ${PRESENCE_STALE_SECONDS * 5})`);
    const candidates = await this.#database.execute<{
      item_id: string;
      space_id: string;
      organization_id: string | null;
      idle_seconds: number;
    }>(sql`
      select d.item_id, t.space_id, s.organization_id, extract(epoch from now() - d.changed_at) as idle_seconds
      from page_documents d join tree_items t on t.id = d.item_id join spaces s on s.id = t.space_id
      where t.mode = 'live' and d.revision > d.versioned_revision and d.changed_at <= now() - interval '1 minute'
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
}

export async function insertFirstVersion(
  tx: Transaction,
  itemId: string,
  actorId: string | null,
  copiedFrom?: { itemId: string; title: string },
): Promise<void> {
  const result = await tx.execute<{ title: string; state: Buffer; snapshot: unknown; revision: number }>(sql`
    select t.title, d.state, d.snapshot, d.revision from tree_items t join page_documents d on d.item_id = t.id
    where t.id = ${itemId}`);
  const row = result.rows[0];
  if (!row) throw new SpaceError("itemNotFound", "The page does not exist");
  const doc = new Y.Doc();
  Y.applyUpdate(doc, new Uint8Array(row.state));
  const stateVector = Buffer.from(Y.encodeStateVector(doc));
  doc.destroy();
  const id = uuidv7();
  await tx.execute(sql`
    insert into page_versions (id, item_id, number, title, document, schema_version, reason, copied_from_id,
      copied_from_title, revision, state_vector, contributors, created_by)
    values (${id}, ${itemId}, 1, ${row.title}, ${JSON.stringify(row.snapshot)}::jsonb, ${editorSchemaVersion},
      ${copiedFrom ? "copied" : "published"}, ${copiedFrom?.itemId ?? null}, ${copiedFrom?.title ?? null},
      ${row.revision}, ${stateVector}, ${sql.param(actorId ? [actorId] : [])}::uuid[], ${actorId})`);
  await tx.execute(sql`update page_documents set versioned_revision = revision where item_id = ${itemId}`);
  await tx.execute(sql`update tree_items set published_version_id = ${id} where id = ${itemId}`);
}
