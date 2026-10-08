import type { TaskReportDue, TaskReportStatus } from "@pagehall/editor-schema";
import { uuidv7 } from "@pagehall/shared";
import { type SQL, sql } from "drizzle-orm";
import type { Principal } from "../accounts/principal.js";
import { accountScopeChain } from "../accounts/scope.js";
import type { AuthorizationService } from "../authorization/service.js";
import type { Database } from "../database/database.js";
import { timeZoneSetting } from "../settings/builtin.js";
import type { SettingsService } from "../settings/service.js";
import { actorIdOf, SpaceError } from "../spaces/common.js";
import { signalSpaceChange } from "../spaces/signals.js";
import { visibleItem } from "../spaces/visibility.js";

export const MAX_TASK_PAGE = 200;

export interface TaskStatus {
  id: string;
  done: boolean;
  changedAt: Date | null;
  changedBy: { id: string; name: string | null } | null;
}

export interface TaskEntry {
  id: string;
  text: string;
  done: boolean;
  dueDate: string | null;
  overdue: boolean;
  assignee: { id: string; name: string } | null;
  item: {
    id: string;
    kind: "page" | "blogPost";
    title: string;
    spaceId: string;
    spaceKey: string;
    spaceName: string;
  };
}

export interface TaskFilter {
  assignee?: string | undefined;
  spaceId?: string | undefined;
  status?: TaskReportStatus | undefined;
  due?: TaskReportDue | undefined;
  after?: [sortDate: string, id: string] | undefined;
  limit?: number | undefined;
}

export interface TaskList {
  items: TaskEntry[];
  counts: { open: number; done: number; overdue: number };
  next: [string, string] | null;
}

const NO_DUE_DATE = "9999-12-31";

export class TaskService {
  readonly #database: Database;
  readonly #authorization: AuthorizationService;
  readonly #settings: SettingsService;

  constructor(options: {
    database: Database;
    authorization: AuthorizationService;
    settings: SettingsService;
  }) {
    this.#database = options.database;
    this.#authorization = options.authorization;
    this.#settings = options.settings;
  }

  async setStatus(actor: Principal, taskId: string, done: boolean): Promise<TaskStatus> {
    const actorId = actorIdOf(actor);
    await this.#database.transaction(async (tx) => {
      const locked = await tx.execute<{ done: boolean; space_id: string; item_id: string }>(sql`
        select k.done, t.space_id, k.item_id from tasks k join tree_items t on t.id = k.item_id
        where k.id = ${taskId} for update of k`);
      const row = locked.rows[0];
      if (!row) throw new SpaceError("taskNotFound", "The task does not exist");
      if (row.done === done) return;
      await tx.execute(sql`
        update tasks set done = ${done}, status_changed_at = now(), status_changed_by = ${actorId}, updated_at = now()
        where id = ${taskId}`);
      await tx.execute(
        sql`insert into task_status_changes (id, task_id, done, actor_id) values (${uuidv7()}, ${taskId}, ${done}, ${actorId})`,
      );
      await signalSpaceChange(tx, { spaceId: row.space_id, kind: "tasks", itemId: row.item_id });
    });
    const status = (await this.#statuses(sql`k.id = ${taskId}`))[0];
    if (!status) throw new SpaceError("taskNotFound", "The task does not exist");
    return status;
  }

  async #statuses(condition: SQL): Promise<TaskStatus[]> {
    const result = await this.#database.execute<{
      id: string;
      done: boolean;
      status_changed_at: Date | string | null;
      status_changed_by: string | null;
      name: string | null;
    }>(sql`
      select k.id, k.done, k.status_changed_at, k.status_changed_by, a.name
      from tasks k left join accounts a on a.id = k.status_changed_by
      where ${condition} order by k.position, k.id`);
    return result.rows.map((row) => ({
      id: row.id,
      done: row.done,
      changedAt: row.status_changed_at === null ? null : new Date(row.status_changed_at),
      changedBy: row.status_changed_by ? { id: row.status_changed_by, name: row.name } : null,
    }));
  }

  async statuses(viewer: Principal, itemId: string): Promise<TaskStatus[]> {
    const editor = (await this.#authorization.explain(viewer, "item.edit", { type: "item", id: itemId }))
      .allowed;
    return this.#statuses(sql`k.item_id = ${itemId} ${editor ? sql`` : sql`and k.published`}`);
  }

  async history(
    taskId: string,
  ): Promise<{ done: boolean; changedAt: Date; changedBy: { id: string; name: string | null } | null }[]> {
    const result = await this.#database.execute<{
      done: boolean;
      changed_at: Date | string;
      actor_id: string | null;
      name: string | null;
    }>(sql`
      select c.done, c.changed_at, c.actor_id, a.name from task_status_changes c
      left join accounts a on a.id = c.actor_id
      where c.task_id = ${taskId} order by c.changed_at desc, c.id desc limit 100`);
    return result.rows.map((row) => ({
      done: row.done,
      changedAt: new Date(row.changed_at),
      changedBy: row.actor_id ? { id: row.actor_id, name: row.name } : null,
    }));
  }

  async #today(viewer: Principal): Promise<string> {
    const accountId = actorIdOf(viewer);
    const timeZone = accountId
      ? await this.#settings.get(timeZoneSetting, {
          ...(await accountScopeChain(this.#database, accountId)),
          user: accountId,
        })
      : "UTC";
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  }

  async list(viewer: Principal, filter: TaskFilter): Promise<TaskList> {
    const today = await this.#today(viewer);
    const limit = Math.min(Math.max(filter.limit ?? 100, 1), MAX_TASK_PAGE);
    const assignee = filter.assignee === "me" ? actorIdOf(viewer) : filter.assignee;
    const sortDate = sql`coalesce(k.due_date, ${NO_DUE_DATE}::date)`;
    const due = filter.due ?? "any";
    const dueCondition =
      due === "overdue"
        ? sql`and k.due_date < ${today}::date`
        : due === "next7Days"
          ? sql`and k.due_date <= ${today}::date + 7`
          : due === "next30Days"
            ? sql`and k.due_date <= ${today}::date + 30`
            : due === "none"
              ? sql`and k.due_date is null`
              : sql``;
    const base = sql`
      from tasks k join tree_items t on t.id = k.item_id join spaces s on s.id = t.space_id
      left join accounts a on a.id = k.assignee_id
      where k.published and t.archived_root_id is null and s.archived_at is null
        and ${visibleItem(this.#authorization, viewer, sql`t`, sql`s`)}
        ${assignee ? sql`and k.assignee_id = ${assignee}` : sql``}
        ${filter.spaceId ? sql`and t.space_id = ${filter.spaceId}` : sql``}
        ${dueCondition}`;
    const status = filter.status ?? "open";
    const statusCondition =
      status === "open" ? sql`and not k.done` : status === "done" ? sql`and k.done` : sql``;
    const counts = await this.#database.execute<{ open: string; done: string; overdue: string }>(sql`
      select count(*) filter (where not k.done) as open, count(*) filter (where k.done) as done,
        count(*) filter (where not k.done and k.due_date < ${today}::date) as overdue
      ${base}`);
    const result = await this.#database.execute<{
      id: string;
      text: string;
      done: boolean;
      due_date: string | null;
      sort_date: string;
      assignee_id: string | null;
      assignee_name: string | null;
      item_id: string;
      kind: "page" | "blogPost";
      title: string;
      space_id: string;
      key: string;
      space_name: string;
    }>(sql`
      select k.id, k.text, k.done, k.due_date::text as due_date, ${sortDate}::text as sort_date, k.assignee_id,
        a.name as assignee_name, t.id as item_id, t.kind, t.title, t.space_id, s.key, s.name as space_name
      ${base} ${statusCondition}
        ${filter.after ? sql`and (${sortDate}, k.id) > (${filter.after[0]}::date, ${filter.after[1]}::uuid)` : sql``}
      order by ${sortDate}, k.id
      limit ${limit + 1}`);
    const rows = result.rows.slice(0, limit);
    const last = rows.at(-1);
    const count = counts.rows[0];
    return {
      items: rows.map((row) => ({
        id: row.id,
        text: row.text,
        done: row.done,
        dueDate: row.due_date,
        overdue: !row.done && row.due_date !== null && row.due_date < today,
        assignee:
          row.assignee_id && row.assignee_name ? { id: row.assignee_id, name: row.assignee_name } : null,
        item: {
          id: row.item_id,
          kind: row.kind,
          title: row.title,
          spaceId: row.space_id,
          spaceKey: row.key,
          spaceName: row.space_name,
        },
      })),
      counts: {
        open: Number(count?.open ?? 0),
        done: Number(count?.done ?? 0),
        overdue: Number(count?.overdue ?? 0),
      },
      next: result.rows.length > limit && last ? [last.sort_date, last.id] : null,
    };
  }
}
