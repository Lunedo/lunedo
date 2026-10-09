import { sql } from "drizzle-orm";
import type { Principal } from "../accounts/principal.js";
import type { Database, Transaction } from "../database/database.js";
import type { NotificationService } from "../notifications/service.js";
import { actorIdOf, SpaceError } from "../spaces/common.js";
import { spaceKeyCandidates, suggestSpaceKey } from "../spaces/keys.js";
import type { PeopleService } from "../spaces/people.js";
import type { SpacePermissionService } from "../spaces/permissions.js";
import { signalSpaceChange } from "../spaces/signals.js";
import type { HolderValidation, SpaceService } from "../spaces/spaces.js";
import { type MeetingService, ONE_ON_ONE_TEMPLATE_ID, type SeriesScheduleInput } from "./meetings.js";
import { rhythmOf } from "./schedule.js";

export interface OneOnOneOrganization {
  id: string;
  name: string;
}

export interface OneOnOneSummary {
  spaceId: string;
  spaceKey: string;
  seriesId: string | null;
  partners: { id: string; name: string | null }[];
  nextMeeting: { id: string; startsAt: Date | null } | null;
}

function partnerOf(actor: Principal): string {
  if (actor.type !== "account")
    throw new SpaceError("oneOnOneNeedsAccount", "A one-on-one is between two people");
  return actor.id;
}

export class OneOnOneService {
  readonly #database: Database;
  readonly #spaces: SpaceService;
  readonly #permissions: SpacePermissionService;
  readonly #holders: HolderValidation;
  readonly #meetings: MeetingService;
  readonly #people: PeopleService;
  readonly #notifications: NotificationService;

  constructor(options: {
    database: Database;
    spaces: SpaceService;
    permissions: SpacePermissionService;
    holders: HolderValidation;
    meetings: MeetingService;
    people: PeopleService;
    notifications: NotificationService;
  }) {
    this.#database = options.database;
    this.#spaces = options.spaces;
    this.#permissions = options.permissions;
    this.#holders = options.holders;
    this.#meetings = options.meetings;
    this.#people = options.people;
    this.#notifications = options.notifications;
  }

  async organizations(actor: Principal, otherId: string): Promise<OneOnOneOrganization[]> {
    const accountId = partnerOf(actor);
    if (!(await this.#people.canSee(actor, otherId))) return [];
    const result = await this.#database.execute<{ id: string; name: string }>(sql`
      select o.id, o.name from organizations o
      where exists (select 1 from memberships m join accounts a on a.id = m.account_id
          where m.organization_id = o.id and m.account_id = ${accountId} and m.kind = 'member'
            and a.type = 'standard' and (m.expires_at is null or m.expires_at > now()))
        and exists (select 1 from memberships m join accounts a on a.id = m.account_id
          where m.organization_id = o.id and m.account_id = ${otherId} and m.kind = 'member'
            and a.type = 'standard' and a.state = 'active' and (m.expires_at is null or m.expires_at > now()))
      order by lower(o.name), o.id`);
    return result.rows;
  }

  async #key(tx: Transaction, names: string[]): Promise<string> {
    const initials = names.map((name) => suggestSpaceKey(name).slice(0, 2)).join("");
    for (const candidate of spaceKeyCandidates(initials.length >= 2 ? initials : "ONE")) {
      if (await this.#spaces.keyAvailable(candidate, tx)) return candidate;
    }
    throw new SpaceError("keyTaken", "No free key could be found for this one-on-one");
  }

  async create(
    actor: Principal,
    input: SeriesScheduleInput & { otherId: string; organizationId: string },
    options: { tx?: Transaction } = {},
  ): Promise<{ spaceId: string; seriesId: string }> {
    const accountId = partnerOf(actor);
    const otherId = input.otherId.toLowerCase();
    if (otherId === accountId)
      throw new SpaceError("invalidMember", "Choose the other person of the one-on-one");
    const shared = await this.organizations(actor, otherId);
    if (!shared.some((organization) => organization.id === input.organizationId)) {
      throw new SpaceError(
        "noSharedOrganization",
        "A one-on-one needs an organization in which both of you are members",
      );
    }
    const run = async (tx: Transaction) => {
      const names = await this.#people.names([accountId, otherId], tx);
      const ownName = names.get(accountId) ?? "";
      const otherName = names.get(otherId) ?? "";
      const name = `${ownName} · ${otherName}`.slice(0, 100);
      const space = await this.#spaces.create(
        actor,
        input.organizationId,
        {
          name,
          key: await this.#key(tx, [ownName, otherName]),
          visibility: "private",
          confidential: true,
          grants: [{ principalKind: "account", principalId: otherId, role: "admin" }],
        },
        this.#holders,
        { tx, oneOnOne: true },
      );
      const seriesId = await this.#meetings.createSeries(
        actor,
        space.id,
        {
          name,
          parentId: null,
          members: [accountId, otherId],
          templateId: ONE_ON_ONE_TEMPLATE_ID,
          rhythm: input.rhythm,
          startsOn: input.startsOn,
          startTime: input.startTime,
          timeZone: input.timeZone,
          durationMinutes: input.durationMinutes,
        },
        { tx },
      );
      await this.#notifications.notify(tx, {
        type: "oneOnOne.started",
        recipients: [otherId],
        organizationId: input.organizationId,
        targetId: seriesId,
        actor,
        params: { itemTitle: name, spaceKey: space.key, startedBy: accountId },
      });
      return { spaceId: space.id, seriesId };
    };
    return options.tx ? run(options.tx) : this.#database.transaction(run);
  }

  async list(actor: Principal): Promise<OneOnOneSummary[]> {
    const accountId = partnerOf(actor);
    const result = await this.#database.execute<{
      space_id: string;
      key: string;
      series_id: string | null;
      meeting_id: string | null;
      starts_at: Date | string | null;
    }>(sql`
      select s.id as space_id, s.key, ms.item_id as series_id, m.item_id as meeting_id, m.starts_at
      from spaces s
      join space_permissions sp on sp.space_id = s.id and sp.principal_kind = 'account' and sp.principal_id = ${accountId}
      left join lateral (select ms.item_id from meeting_series ms join tree_items t on t.id = ms.item_id
        where t.space_id = s.id and t.trash_entry_id is null and t.archived_root_id is null
        order by t.created_at limit 1) ms on true
      left join meetings m on m.series_id = ms.item_id and m.state = 'upcoming'
      where s.one_on_one and s.deleted_at is null and s.archived_at is null
      order by m.starts_at nulls last, s.key
      limit 200`);
    const summaries: OneOnOneSummary[] = [];
    for (const row of result.rows) {
      const partners = await this.#database.execute<{ id: string; name: string | null }>(sql`
        select a.id, ${this.#people.visibleName(actor, sql`a`)} as name from space_permissions sp
        join accounts a on a.id = sp.principal_id
        where sp.space_id = ${row.space_id} and sp.principal_kind = 'account' and a.id <> ${accountId}
          and a.state = 'active'
        order by lower(a.name), a.id`);
      summaries.push({
        spaceId: row.space_id,
        spaceKey: row.key,
        seriesId: row.series_id,
        partners: partners.rows,
        nextMeeting: row.meeting_id
          ? { id: row.meeting_id, startsAt: row.starts_at === null ? null : new Date(row.starts_at) }
          : null,
      });
    }
    return summaries;
  }

  async changePerson(
    actor: Principal,
    spaceId: string,
    input: { previousId: string; successorId: string; mode: "add" | "new" } & Partial<SeriesScheduleInput>,
  ): Promise<{ spaceId: string; seriesId: string | null }> {
    const accountId = partnerOf(actor);
    const space = await this.#spaces.require(spaceId);
    if (!space.oneOnOne || !space.organizationId) {
      throw new SpaceError("notOneOnOne", "Only a one-on-one can change one of its people");
    }
    if (input.previousId === accountId || input.successorId === accountId) {
      throw new SpaceError("invalidMember", "Choose the person who leaves and the person who follows");
    }
    if (!(await this.#people.canSee(actor, input.successorId))) {
      throw new SpaceError("invalidMember", "Choose a successor among the people you can see");
    }
    if (input.mode === "new") {
      const series = await this.#database.execute<{
        recurrence: string | null;
        starts_on: string;
        start_time: string;
        time_zone: string;
        duration_minutes: number;
      }>(sql`
        select ms.recurrence, ms.starts_on, ms.start_time, ms.time_zone, ms.duration_minutes
        from meeting_series ms join tree_items t on t.id = ms.item_id where t.space_id = ${spaceId}
        order by t.created_at limit 1`);
      const current = series.rows[0];
      const rhythm = input.rhythm ?? rhythmOf(current?.recurrence ?? null);
      const created = await this.create(actor, {
        otherId: input.successorId,
        organizationId: space.organizationId,
        rhythm: rhythm ?? { frequency: "none", interval: 1 },
        startsOn: input.startsOn ?? current?.starts_on ?? new Date().toISOString().slice(0, 10),
        startTime: input.startTime ?? current?.start_time ?? "09:00",
        timeZone: input.timeZone ?? current?.time_zone ?? "UTC",
        durationMinutes: input.durationMinutes ?? current?.duration_minutes ?? 30,
      });
      return created;
    }
    return this.#database.transaction(async (tx) => {
      const permissions = await this.#permissions.list(spaceId, tx);
      const own = permissions.find(
        (entry) => entry.principalKind === "account" && entry.principalId === accountId,
      );
      if (own?.role !== "admin") {
        throw new SpaceError("notOneOnOneMember", "Only the remaining person of the one-on-one can do this");
      }
      if (!permissions.some((entry) => entry.principalId === input.successorId)) {
        await this.#permissions.apply(
          actor,
          spaceId,
          { action: "grant", principalKind: "account", principalId: input.successorId, role: "admin" },
          { tx },
        );
      }
      const previous = permissions.find((entry) => entry.principalId === input.previousId);
      if (previous)
        await this.#permissions.apply(
          actor,
          spaceId,
          { action: "remove", permissionId: previous.id },
          { tx },
        );
      const series = await tx.execute<{ item_id: string }>(sql`
        select ms.item_id from meeting_series ms join tree_items t on t.id = ms.item_id
        where t.space_id = ${spaceId} and t.trash_entry_id is null`);
      for (const row of series.rows) {
        await tx.execute(sql`
          update meeting_series_members set account_id = ${input.successorId}, updated_at = now()
          where series_id = ${row.item_id} and account_id = ${input.previousId}
            and not exists (select 1 from meeting_series_members x
              where x.series_id = ${row.item_id} and x.account_id = ${input.successorId})`);
        await tx.execute(sql`
          delete from meeting_series_members where series_id = ${row.item_id} and account_id = ${input.previousId}`);
        await tx.execute(sql`
          insert into meeting_attendees (meeting_id, account_id, position, added_by)
          select m.item_id, ${input.successorId}, 1, ${actorIdOf(actor)} from meetings m
          where m.series_id = ${row.item_id} and m.state = 'upcoming'
          on conflict do nothing`);
        await tx.execute(sql`
          delete from meeting_attendees a using meetings m
          where a.meeting_id = m.item_id and m.series_id = ${row.item_id} and m.state = 'upcoming'
            and a.account_id = ${input.previousId}`);
      }
      const name = await this.#people.names([accountId, input.successorId], tx);
      await this.#notifications.notify(tx, {
        type: "oneOnOne.started",
        recipients: [input.successorId],
        organizationId: space.organizationId,
        targetId: series.rows[0]?.item_id ?? null,
        actor,
        params: {
          itemTitle: `${name.get(accountId) ?? ""} · ${name.get(input.successorId) ?? ""}`,
          spaceKey: space.key,
          startedBy: accountId,
        },
      });
      await signalSpaceChange(tx, { spaceId, kind: "meetings", itemId: null });
      return { spaceId, seriesId: series.rows[0]?.item_id ?? null };
    });
  }
}
