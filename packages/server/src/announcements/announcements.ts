import { uuidv7 } from "@pagehall/shared";
import { sql } from "drizzle-orm";
import type { Principal } from "../accounts/principal.js";
import type { AuditLog } from "../audit/audit-log.js";
import type { AuthorizationService } from "../authorization/service.js";
import type { Database, Executor } from "../database/database.js";
import { OrganizationError } from "../organizations/organizations.js";
import { INSTANCE_SCOPE_ID } from "../settings/service.js";
import { auditScopeOf } from "../spaces/common.js";
import type { PeopleService } from "../spaces/people.js";
import type { AnnouncementSeverity } from "./schema.js";

export const ANNOUNCEMENT_CHANGES_CHANNEL = "pagehall_announcement_changes";
export const ANNOUNCEMENT_TEXT_MAX_LENGTH = 300;
export const ANNOUNCEMENT_LINK_LABEL_MAX_LENGTH = 60;
export const ANNOUNCEMENT_URL_MAX_LENGTH = 2000;

export type AnnouncementScope = "instance" | "organization";

export interface AnnouncementChangeSignal {
  scope: AnnouncementScope;
  organizationId: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function parseAnnouncementChangeSignal(payload: string): AnnouncementChangeSignal | null {
  try {
    const parsed = JSON.parse(payload) as Partial<AnnouncementChangeSignal>;
    if (parsed.scope === "instance" && parsed.organizationId === null) {
      return { scope: "instance", organizationId: null };
    }
    if (
      parsed.scope === "organization" &&
      typeof parsed.organizationId === "string" &&
      UUID.test(parsed.organizationId)
    ) {
      return { scope: "organization", organizationId: parsed.organizationId };
    }
  } catch {
    return null;
  }
  return null;
}

export interface AnnouncementInput {
  severity: AnnouncementSeverity;
  text: string;
  link: { url: string; label: string } | null;
  startsAt: Date | null;
  endsAt: Date;
}

export interface Announcement {
  id: string;
  scope: AnnouncementScope;
  organizationId: string | null;
  version: string;
  severity: AnnouncementSeverity;
  text: string;
  link: { url: string; label: string } | null;
  startsAt: Date;
  endsAt: Date;
}

export interface ManagedAnnouncement extends Announcement {
  updatedAt: Date;
  updatedBy: { id: string; name: string | null } | null;
}

export interface ShownAnnouncement extends Announcement {
  dismissed: boolean;
}

type Row = {
  id: string;
  organization_id: string | null;
  version: string;
  severity: AnnouncementSeverity;
  text: string;
  link_url: string | null;
  link_label: string | null;
  starts_at: Date | string;
  ends_at: Date | string;
};

function toAnnouncement(row: Row): Announcement {
  return {
    id: row.id,
    scope: row.organization_id ? "organization" : "instance",
    organizationId: row.organization_id,
    version: row.version,
    severity: row.severity,
    text: row.text,
    link: row.link_url && row.link_label ? { url: row.link_url, label: row.link_label } : null,
    startsAt: new Date(row.starts_at),
    endsAt: new Date(row.ends_at),
  };
}

function invalid(message: string): OrganizationError {
  return new OrganizationError("invalidAnnouncement", message);
}

function cleanText(value: string, max: number, what: string): string {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length === 0 || text.length > max) throw invalid(`The ${what} needs 1 to ${max} characters`);
  return text;
}

function cleanLink(link: { url: string; label: string } | null): { url: string; label: string } | null {
  if (!link) return null;
  const url = link.url.trim();
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw invalid("The link needs a complete address starting with https:// or http://");
  }
  if (!["http:", "https:"].includes(parsed.protocol) || url.length > ANNOUNCEMENT_URL_MAX_LENGTH) {
    throw invalid("The link needs a complete address starting with https:// or http://");
  }
  return { url: parsed.href, label: cleanText(link.label, ANNOUNCEMENT_LINK_LABEL_MAX_LENGTH, "link text") };
}

const COLUMNS = sql`a.id, a.organization_id, a.version, a.severity, a.text, a.link_url, a.link_label, a.starts_at,
  a.ends_at`;

export class AnnouncementService {
  readonly #database: Database;
  readonly #authorization: AuthorizationService;
  readonly #audit: AuditLog;
  readonly #people: PeopleService;
  readonly #clock: () => Date;

  constructor(options: {
    database: Database;
    authorization: AuthorizationService;
    audit: AuditLog;
    people: PeopleService;
    clock?: () => Date;
  }) {
    this.#database = options.database;
    this.#authorization = options.authorization;
    this.#audit = options.audit;
    this.#people = options.people;
    this.#clock = options.clock ?? (() => new Date());
  }

  async get(viewer: Principal, organizationId: string | null): Promise<ManagedAnnouncement | null> {
    const result = await this.#database.execute<
      Row & { updated_at: Date | string; updated_by: string | null; updater_name: string | null }
    >(sql`
      select ${COLUMNS}, a.updated_at, a.updated_by, ${this.#people.visibleName(viewer, sql`u`)} as updater_name
      from announcements a left join accounts u on u.id = a.updated_by
      where a.scope_id = ${organizationId ?? INSTANCE_SCOPE_ID}`);
    const row = result.rows[0];
    if (!row) return null;
    return {
      ...toAnnouncement(row),
      updatedAt: new Date(row.updated_at),
      updatedBy: row.updated_by ? { id: row.updated_by, name: row.updater_name } : null,
    };
  }

  async set(
    actor: Principal,
    organizationId: string | null,
    input: AnnouncementInput,
  ): Promise<ManagedAnnouncement> {
    const text = cleanText(input.text, ANNOUNCEMENT_TEXT_MAX_LENGTH, "text");
    const link = cleanLink(input.link);
    const now = this.#clock();
    const startsAt = input.startsAt ?? now;
    if (input.endsAt.getTime() <= startsAt.getTime()) {
      throw invalid("The end needs to be after the start");
    }
    if (input.endsAt.getTime() <= now.getTime()) throw invalid("The end needs to be in the future");
    await this.#database.transaction(async (tx) => {
      const scopeId = organizationId ?? INSTANCE_SCOPE_ID;
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`announcement:${scopeId}`}, 0))`);
      const previous = await tx.execute<{ id: string }>(
        sql`select id from announcements where scope_id = ${scopeId}`,
      );
      const actorId = actor.type === "account" ? actor.id : null;
      const id = previous.rows[0]?.id ?? uuidv7();
      await tx.execute(sql`
        insert into announcements (id, scope_id, organization_id, version, severity, text, link_url, link_label,
          starts_at, ends_at, updated_by)
        values (${id}, ${scopeId}, ${organizationId}, ${uuidv7()}, ${input.severity}, ${text}, ${link?.url ?? null},
          ${link?.label ?? null}, ${startsAt}, ${input.endsAt}, ${actorId})
        on conflict (scope_id) do update set version = excluded.version, severity = excluded.severity,
          text = excluded.text, link_url = excluded.link_url, link_label = excluded.link_label,
          starts_at = excluded.starts_at, ends_at = excluded.ends_at, updated_by = excluded.updated_by,
          updated_at = now()`);
      await this.#audit.record(tx, {
        name: "announcement.changed",
        actor,
        targetId: id,
        fields: {
          level: organizationId ? "organization" : "instance",
          replaced: previous.rows.length > 0,
          severity: input.severity,
          text,
          linkUrl: link?.url ?? null,
          linkLabel: link?.label ?? null,
          startsAt: startsAt.toISOString(),
          endsAt: input.endsAt.toISOString(),
        },
        scope: auditScopeOf({ organizationId }),
      });
      await this.#signal(tx, organizationId);
    });
    const saved = await this.get(actor, organizationId);
    if (!saved) throw new Error("The announcement was not saved");
    return saved;
  }

  async remove(actor: Principal, organizationId: string | null): Promise<boolean> {
    return this.#database.transaction(async (tx) => {
      const removed = await tx.execute<{ id: string; severity: AnnouncementSeverity; text: string }>(sql`
        delete from announcements where scope_id = ${organizationId ?? INSTANCE_SCOPE_ID}
        returning id, severity, text`);
      const row = removed.rows[0];
      if (!row) return false;
      await this.#audit.record(tx, {
        name: "announcement.removed",
        actor,
        targetId: row.id,
        fields: {
          level: organizationId ? "organization" : "instance",
          severity: row.severity,
          text: row.text,
        },
        scope: auditScopeOf({ organizationId }),
      });
      await this.#signal(tx, organizationId);
      return true;
    });
  }

  async #signal(executor: Executor, organizationId: string | null): Promise<void> {
    const signal: AnnouncementChangeSignal = organizationId
      ? { scope: "organization", organizationId }
      : { scope: "instance", organizationId: null };
    await executor.execute(sql`select pg_notify(${ANNOUNCEMENT_CHANGES_CHANNEL}, ${JSON.stringify(signal)})`);
  }

  async #organizationsOf(viewer: Principal): Promise<string[]> {
    if (viewer.type !== "account") return [];
    const result = await this.#database.execute<{ organization_id: string }>(sql`
      select distinct a.organization_id from announcements a
      where a.organization_id is not null and a.ends_at > ${this.#clock()}::timestamptz`);
    const allowed: string[] = [];
    for (const row of result.rows) {
      const decision = await this.#authorization.explain(viewer, "organization.view", {
        type: "organization",
        id: row.organization_id,
      });
      if (decision.allowed) allowed.push(row.organization_id);
    }
    return allowed;
  }

  async shown(viewer: Principal): Promise<ShownAnnouncement[]> {
    if (viewer.type !== "account") return [];
    const organizations = await this.#organizationsOf(viewer);
    const result = await this.#database.execute<Row & { dismissed: boolean }>(sql`
      select ${COLUMNS}, (d.version is not distinct from a.version) as dismissed
      from announcements a
      left join announcement_dismissals d on d.announcement_id = a.id and d.account_id = ${viewer.id}
      where a.ends_at > ${this.#clock()}::timestamptz
        and (a.organization_id is null or a.organization_id = any(${sql.param(organizations)}::uuid[]))
      order by a.organization_id nulls first, a.id`);
    return result.rows.map((row) => ({ ...toAnnouncement(row), dismissed: row.dismissed }));
  }

  async dismiss(viewer: Principal, announcementId: string, version: string): Promise<void> {
    if (viewer.type !== "account") throw new OrganizationError("notFound", "The announcement does not exist");
    const shown = (await this.shown(viewer)).find((announcement) => announcement.id === announcementId);
    if (!shown) throw new OrganizationError("notFound", "The announcement does not exist");
    if (shown.severity === "warning") {
      throw new OrganizationError(
        "announcementNotDismissible",
        "A warning stays until its end and cannot be dismissed",
      );
    }
    if (shown.version !== version) {
      throw new OrganizationError(
        "announcementChanged",
        "The announcement changed in the meantime; read the new text before dismissing it",
      );
    }
    await this.#database.execute(sql`
      insert into announcement_dismissals (announcement_id, account_id, version)
      values (${announcementId}, ${viewer.id}, ${version})
      on conflict (announcement_id, account_id) do update set version = excluded.version, updated_at = now()`);
  }
}
