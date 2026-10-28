import { type SQL, sql } from "drizzle-orm";
import type { Principal } from "../accounts/principal.js";
import type { AuthorizationService } from "../authorization/service.js";
import { spaceRoleConditionFor } from "../authorization/space-access.js";
import type { Database, Executor } from "../database/database.js";
import { afterKey, FIRST_PAGE, type Page, type PageRequest, pageLimit, toPage } from "../database/keyset.js";
import { seriesParticipant } from "../meetings/participants.js";

export interface Person {
  id: string;
  name: string;
  email: string | null;
  type: string;
  pictureRef: string | null;
}

export interface VisiblePerson {
  name: string;
  jobTitle: string | null;
  pictureRef: string | null;
}

export class PeopleService {
  readonly #database: Database;
  readonly #authorization: AuthorizationService;

  constructor(options: { database: Database; authorization: AuthorizationService }) {
    this.#database = options.database;
    this.#authorization = options.authorization;
  }

  colleagueCondition(viewer: Principal, account: SQL): SQL {
    if (viewer.type === "system") return sql`true`;
    if (viewer.type === "anonymous") return sql`false`;
    const viewerId = sql`${viewer.id}::uuid`;
    return sql`(${account} = ${viewerId}
      or exists (select 1 from memberships mv join memberships ma on ma.organization_id = mv.organization_id
        where mv.account_id = ${viewerId} and mv.kind = 'member'
          and (mv.expires_at is null or mv.expires_at > now())
          and ma.account_id = ${account} and (ma.expires_at is null or ma.expires_at > now()))
      or exists (select 1 from service_accounts sa join memberships mv on mv.organization_id = sa.organization_id
        where sa.account_id = ${account} and mv.account_id = ${viewerId} and mv.kind = 'member'
          and (mv.expires_at is null or mv.expires_at > now())))`;
  }

  visibleCondition(viewer: Principal, account: SQL): SQL {
    if (viewer.type === "system") return sql`true`;
    if (viewer.type === "anonymous") return sql`false`;
    return sql`(${this.colleagueCondition(viewer, account)}
      or exists (select 1 from accounts pa join memberships pm on pm.organization_id = pa.home_organization_id
        where pa.id = ${account} and pa.state = 'placeholder' and pm.account_id = ${viewer.id}::uuid
          and pm.kind = 'member' and (pm.expires_at is null or pm.expires_at > now()))
      or exists (select 1 from space_permissions sp join spaces vs on vs.id = sp.space_id
        where sp.principal_kind = 'account' and sp.principal_id = ${account}
          and ${this.#authorization.spaceFilter(viewer, sql`vs`)}))`;
  }

  async canSee(viewer: Principal, accountId: string, executor: Executor = this.#database): Promise<boolean> {
    const result = await executor.execute<{ visible: boolean }>(sql`
      select ${this.visibleCondition(viewer, sql`a.id`)} as visible
      from accounts a where a.id = ${accountId} and a.state in ('active', 'invited')`);
    return result.rows[0]?.visible === true;
  }

  async search(
    viewer: Principal,
    page: PageRequest = FIRST_PAGE,
    options: {
      spaceId?: string | undefined;
      seriesId?: string | undefined;
      ids?: readonly string[] | undefined;
    } = {},
  ): Promise<Page<Person>> {
    const term = page.search?.trim() ?? "";
    const pattern = `%${term.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
    const sortName = sql`lower(a.name)`;
    const result = await this.#database.execute<{
      id: string;
      name: string;
      email: string | null;
      type: string;
      picture_ref: string | null;
      sort_name: string;
    }>(sql`
      select a.id, a.name, case when ${this.colleagueCondition(viewer, sql`a.id`)} then a.email end as email,
        a.type::text as type, a.picture_ref, ${sortName} as sort_name
      from accounts a
      where a.state = 'active' and ${this.visibleCondition(viewer, sql`a.id`)}
        ${term ? sql`and (a.name ilike ${pattern} or (a.email ilike ${pattern} and ${this.colleagueCondition(viewer, sql`a.id`)}))` : sql``}
        ${options.ids ? sql`and a.id = any(${sql.param([...options.ids])}::uuid[])` : sql``}
        ${options.spaceId ? sql`and exists (select 1 from spaces ps where ps.id = ${options.spaceId} and ${spaceRoleConditionFor(sql`a.id`, sql`ps`, "reader")})` : sql``}
        ${options.seriesId ? sql`and ${seriesParticipant(sql`${options.seriesId}::uuid`, sql`a.id`)}` : sql``}
        ${page.after ? sql`and ${afterKey([sortName, sql`a.id`], page.after)}` : sql``}
      order by ${sortName}, a.id
      limit ${pageLimit(page)}`);
    return toPage(
      result.rows,
      page,
      (row) => [row.sort_name, row.id],
      (row) => ({
        id: row.id,
        name: row.name,
        email: row.email,
        type: row.type,
        pictureRef: row.picture_ref,
      }),
    );
  }

  visibleName(viewer: Principal, account: SQL): SQL {
    return sql`(case when ${this.visibleCondition(viewer, sql`${account}.id`)} then ${account}.name end)`;
  }

  visiblePictureRef(viewer: Principal, account: SQL): SQL {
    return sql`(case when ${this.visibleCondition(viewer, sql`${account}.id`)} then ${account}.picture_ref end)`;
  }

  async visibleNames(viewer: Principal, ids: readonly string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const result = await this.#database.execute<{ id: string; name: string }>(sql`
      select a.id, coalesce(m.name, a.name) as name from accounts a left join accounts m on m.id = a.merged_into_id
      where a.id = any(${sql.param([...new Set(ids)])}::uuid[])
        and ${this.visibleCondition(viewer, sql`coalesce(m.id, a.id)`)}`);
    return new Map(result.rows.map((row) => [row.id, row.name]));
  }

  async visiblePeople(viewer: Principal, ids: readonly string[]): Promise<Map<string, VisiblePerson>> {
    if (ids.length === 0) return new Map();
    const result = await this.#database.execute<{
      id: string;
      name: string;
      job_title: string | null;
      picture_ref: string | null;
    }>(sql`
      select a.id, coalesce(m.name, a.name) as name, case when m.id is null then a.job_title else m.job_title end as job_title,
        case when m.id is null then a.picture_ref else m.picture_ref end as picture_ref
      from accounts a left join accounts m on m.id = a.merged_into_id
      where a.id = any(${sql.param([...new Set(ids)])}::uuid[])
        and ${this.visibleCondition(viewer, sql`coalesce(m.id, a.id)`)}`);
    return new Map(
      result.rows.map((row) => [
        row.id,
        { name: row.name, jobTitle: row.job_title, pictureRef: row.picture_ref },
      ]),
    );
  }

  async names(ids: readonly string[], executor: Executor = this.#database): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const result = await executor.execute<{ id: string; name: string }>(
      sql`select a.id, coalesce(m.name, a.name) as name from accounts a left join accounts m on m.id = a.merged_into_id
        where a.id = any(${sql.param([...new Set(ids)])}::uuid[])`,
    );
    return new Map(result.rows.map((row) => [row.id, row.name]));
  }
}
