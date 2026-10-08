import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { uuidv7 } from "@pagehall/shared";
import { sql } from "drizzle-orm";
import type { Principal } from "../accounts/principal.js";
import type { AuditLog } from "../audit/audit-log.js";
import type { PasswordHasher } from "../auth/passwords.js";
import { clientSubject, type RateLimiter } from "../auth/throttle.js";
import { activeLinkCondition, linkScopeCondition } from "../authorization/item-access.js";
import { type AuthorizationService, ForbiddenError } from "../authorization/service.js";
import type { Encryption } from "../crypto/envelope.js";
import type { Database, Executor, Transaction } from "../database/database.js";
import type { SettingsService } from "../settings/service.js";
import { actorIdOf, auditScopeOf, SpaceError } from "../spaces/common.js";
import type { PeopleService } from "../spaces/people.js";
import { signalSpaceChange } from "../spaces/signals.js";
import type { HolderKind } from "./page-access.js";
import type { ShareLinkScope } from "./schema.js";
import { anyoneLinkMaxDaysSetting, anyoneLinksSetting, shareLinksSetting } from "./settings.js";
import type { ValueSigner } from "./signer.js";

const LOOKUP_BYTES = 12;
const SECRET_BYTES = 24;
const TOKEN_PATTERN = /^([A-Za-z0-9_-]{16})([A-Za-z0-9_-]{32})$/;
const PASSWORD_MAX_LENGTH = 200;
const PASSWORD_ATTEMPTS = 10;
const PASSWORD_WINDOW_SECONDS = 15 * 60;
const CLIENT_FAILURES = 30;
const CLIENT_WINDOW_SECONDS = 15 * 60;
const UNLOCK_HOURS = 12;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_PEOPLE = 100;

export class ShareLinkError extends SpaceError {
  override name = "ShareLinkError";
}

export class ShareLinkRateLimitedError extends Error {
  override name = "ShareLinkRateLimitedError";

  constructor(readonly retryAfterSeconds: number) {
    super("Too many attempts to open this link");
  }
}

export interface ShareLink {
  id: string;
  token: string | null;
  itemId: string;
  scope: ShareLinkScope;
  expiresAt: Date | null;
  hasPassword: boolean;
  people: { kind: HolderKind; id: string; name: string | null }[];
  createdBy: { id: string; name: string | null } | null;
  createdAt: Date;
  visitors: number;
}

export interface ShareLinkInput {
  scope: ShareLinkScope;
  expiresAt?: Date | null | undefined;
  password?: string | null | undefined;
  people?: { kind: HolderKind; id: string }[] | undefined;
}

export interface ShareLinkOptions {
  enabled: boolean;
  anyone: boolean;
  anyoneMaxDays: number;
}

export type OpenResult =
  | { kind: "account"; itemId: string }
  | { kind: "anonymous"; itemId: string; unlock: string | null };

interface LinkRow {
  id: string;
  item_id: string;
  scope: ShareLinkScope;
  secret_hash: Buffer;
  password_hash: string | null;
  expires_at: Date | string | null;
  revoked_at: Date | string | null;
  space_id: string;
  organization_id: string | null;
  title: string;
  restricted?: boolean;
  [key: string]: unknown;
}

function secretContext(linkId: string): string {
  return `share_links.secret:${linkId}`;
}

function secretHash(secret: string): Buffer {
  return createHash("sha256").update(secret, "utf8").digest();
}

function passwordFingerprint(hash: string | null): string {
  return hash ? createHash("sha256").update(hash, "utf8").digest("base64url") : "";
}

export function splitLinkToken(token: string): { lookup: string; secret: string } | null {
  const match = TOKEN_PATTERN.exec(token);
  return match?.[1] && match[2] ? { lookup: match[1], secret: match[2] } : null;
}

export class ShareLinkService {
  readonly #database: Database;
  readonly #authorization: AuthorizationService;
  readonly #audit: AuditLog;
  readonly #settings: SettingsService;
  readonly #hasher: PasswordHasher;
  readonly #rateLimiter: RateLimiter;
  readonly #people: PeopleService;
  readonly #signer: ValueSigner;
  readonly #encryption: Encryption;

  constructor(options: {
    database: Database;
    authorization: AuthorizationService;
    audit: AuditLog;
    settings: SettingsService;
    hasher: PasswordHasher;
    rateLimiter: RateLimiter;
    people: PeopleService;
    signer: ValueSigner;
    encryption: Encryption;
  }) {
    this.#encryption = options.encryption;
    this.#database = options.database;
    this.#authorization = options.authorization;
    this.#audit = options.audit;
    this.#settings = options.settings;
    this.#hasher = options.hasher;
    this.#rateLimiter = options.rateLimiter;
    this.#people = options.people;
    this.#signer = options.signer;
  }

  async options(itemId: string): Promise<ShareLinkOptions> {
    const result = await this.#database.execute<{ organization_id: string | null }>(sql`
      select s.organization_id from tree_items t join spaces s on s.id = t.space_id where t.id = ${itemId}`);
    const organizationId = result.rows[0]?.organization_id ?? null;
    const chain = organizationId ? { organization: organizationId } : {};
    return {
      enabled: await this.#settings.get(shareLinksSetting, chain),
      anyone: await this.#settings.get(anyoneLinksSetting, chain),
      anyoneMaxDays: await this.#settings.get(anyoneLinkMaxDaysSetting, chain),
    };
  }

  async list(viewer: Principal, itemId: string): Promise<ShareLink[]> {
    const result = await this.#database.execute<{
      id: string;
      item_id: string;
      lookup: string;
      secret: Buffer | null;
      scope: ShareLinkScope;
      expires_at: Date | string | null;
      has_password: boolean;
      created_by: string | null;
      created_at: Date | string;
      visitors: string;
    }>(sql`
      select l.id, l.item_id, l.lookup, l.secret, l.scope, l.expires_at, l.password_hash is not null as has_password, l.created_by,
        l.created_at, (select count(*) from share_link_accesses la where la.link_id = l.id) as visitors
      from share_links l
      where l.item_id = ${itemId} and l.revoked_at is null
      order by l.created_at desc, l.id limit 100`);
    const people = await this.#database.execute<{
      link_id: string;
      principal_kind: HolderKind;
      principal_id: string;
      name: string | null;
    }>(sql`
      select lp.link_id, lp.principal_kind, lp.principal_id,
        case when lp.principal_kind = 'group' then g.name else ${this.#people.visibleName(viewer, sql`a`)} end as name
      from share_link_people lp
      left join accounts a on lp.principal_kind = 'account' and a.id = lp.principal_id
      left join groups g on lp.principal_kind = 'group' and g.id = lp.principal_id
      where lp.link_id = any(${sql.param(result.rows.map((row) => row.id))}::uuid[])
      order by lp.created_at`);
    const names = await this.#people.visibleNames(
      viewer,
      result.rows.map((row) => row.created_by).filter((id): id is string => id !== null),
    );
    return result.rows.map((row) => ({
      id: row.id,
      token: row.secret
        ? `${row.lookup}${this.#encryption.decryptString(row.secret, secretContext(row.id))}`
        : null,
      itemId: row.item_id,
      scope: row.scope,
      expiresAt: row.expires_at ? new Date(row.expires_at) : null,
      hasPassword: row.has_password,
      people: people.rows
        .filter((person) => person.link_id === row.id)
        .map((person) => ({ kind: person.principal_kind, id: person.principal_id, name: person.name })),
      createdBy: row.created_by ? { id: row.created_by, name: names.get(row.created_by) ?? null } : null,
      createdAt: new Date(row.created_at),
      visitors: Number(row.visitors),
    }));
  }

  async #require(tx: Transaction, actor: Principal, itemId: string): Promise<void> {
    const decision = await this.#authorization.explain(
      actor,
      "item.share",
      { type: "item", id: itemId },
      { executor: tx, fresh: true },
    );
    if (!decision.allowed) throw new ForbiddenError(decision);
  }

  async #item(executor: Executor, itemId: string) {
    const result = await executor.execute<{
      space_id: string;
      organization_id: string | null;
      title: string;
      view_restricted: boolean;
    }>(sql`
      select t.space_id, s.organization_id, t.title,
        exists (select 1 from page_restrictions r where r.item_id = any(t.path) and r.kind = 'view') as view_restricted
      from tree_items t join spaces s on s.id = t.space_id where t.id = ${itemId}`);
    const row = result.rows[0];
    if (!row) throw new SpaceError("itemNotFound", "The page does not exist");
    return row;
  }

  async #validate(
    tx: Transaction,
    actor: Principal,
    itemId: string,
    input: ShareLinkInput,
  ): Promise<{ expiresAt: Date | null; people: { kind: HolderKind; id: string }[] }> {
    const options = await this.options(itemId);
    const item = await this.#item(tx, itemId);
    if (!options.enabled) {
      throw new ShareLinkError("shareLinksDisabled", "Share links are turned off for this organization");
    }
    const expiresAt = input.expiresAt ?? null;
    if (expiresAt && expiresAt.getTime() <= Date.now()) {
      throw new ShareLinkError("expiryInPast", "Choose an expiry date in the future");
    }
    if (input.scope === "anyone") {
      if (!options.anyone) {
        throw new ShareLinkError(
          "anyoneLinksDisabled",
          "Links for anyone are turned off for this organization",
        );
      }
      if (item.view_restricted) {
        throw new ShareLinkError(
          "restrictedPage",
          "A restricted page cannot be opened by anyone with the link; choose specific people instead",
        );
      }
      if (!expiresAt) {
        throw new ShareLinkError("expiryRequired", "Links for anyone need an expiry date");
      }
      if (expiresAt.getTime() > Date.now() + options.anyoneMaxDays * DAY_MS) {
        throw new ShareLinkError(
          "expiryTooLate",
          `Links for anyone can be valid for at most ${options.anyoneMaxDays} days`,
          { maxDays: options.anyoneMaxDays },
        );
      }
    }
    if (input.scope === "organization" && item.organization_id === null) {
      throw new ShareLinkError("invalidScope", "Pages of personal spaces cannot use this scope");
    }
    const people = input.scope === "people" ? (input.people ?? []) : [];
    if (input.scope === "people" && people.length === 0) {
      throw new ShareLinkError("peopleRequired", "Choose at least one person or group for this link");
    }
    if (people.length > MAX_PEOPLE) {
      throw new ShareLinkError("tooManyPeople", `A link can name up to ${MAX_PEOPLE} people or groups`);
    }
    for (const person of people) {
      if (person.kind === "account") {
        if (!(await this.#people.canSee(actor, person.id, tx))) {
          throw new SpaceError("invalidHolder", "Choose a person you can find in the search");
        }
      } else {
        const group = await tx.execute<{ organization_id: string }>(
          sql`select organization_id from groups where id = ${person.id}`,
        );
        if (
          !group.rows[0] ||
          (item.organization_id && group.rows[0].organization_id !== item.organization_id)
        ) {
          throw new SpaceError("invalidHolder", "Choose a group of the organization the page belongs to");
        }
      }
    }
    return { expiresAt, people };
  }

  async #passwordHash(password: string | null | undefined): Promise<string | null> {
    if (password === undefined || password === null || password === "") return null;
    if (password.length > PASSWORD_MAX_LENGTH) {
      throw new ShareLinkError(
        "invalidPassword",
        `The password can have up to ${PASSWORD_MAX_LENGTH} characters`,
      );
    }
    return this.#hasher.hash(password);
  }

  async create(
    actor: Principal,
    itemId: string,
    input: ShareLinkInput,
  ): Promise<{ link: ShareLink; token: string }> {
    const passwordHash = await this.#passwordHash(input.password);
    const lookup = randomBytes(LOOKUP_BYTES).toString("base64url");
    const secret = randomBytes(SECRET_BYTES).toString("base64url");
    const id = uuidv7();
    await this.#database.transaction(async (tx) => {
      await this.#require(tx, actor, itemId);
      const { expiresAt, people } = await this.#validate(tx, actor, itemId, input);
      const item = await this.#item(tx, itemId);
      await tx.execute(sql`
        insert into share_links (id, item_id, lookup, secret_hash, secret, scope, password_hash, expires_at, created_by)
        values (${id}, ${itemId}, ${lookup}, ${secretHash(secret)}, ${this.#encryption.encrypt(secret, secretContext(id))}, ${input.scope}, ${passwordHash}, ${expiresAt},
          ${actorIdOf(actor)})`);
      await this.#setPeople(tx, id, people);
      await this.#audit.record(tx, {
        name: "shareLink.created",
        actor,
        targetId: id,
        fields: {
          spaceId: item.space_id,
          itemId,
          title: item.title,
          scope: input.scope,
          expiresAt: expiresAt?.toISOString() ?? null,
          unlockRequired: passwordHash !== null,
        },
        scope: auditScopeOf({ organizationId: item.organization_id }),
      });
      await signalSpaceChange(tx, { spaceId: item.space_id, kind: "access", itemId });
    });
    const link = (await this.list(actor, itemId)).find((candidate) => candidate.id === id);
    if (!link) throw new Error("The share link was not created");
    return { link, token: `${lookup}${secret}` };
  }

  async #setPeople(
    tx: Transaction,
    linkId: string,
    people: { kind: HolderKind; id: string }[],
  ): Promise<void> {
    await tx.execute(sql`delete from share_link_people where link_id = ${linkId}`);
    for (const person of people) {
      await tx.execute(sql`
        insert into share_link_people (link_id, principal_kind, principal_id) values (${linkId}, ${person.kind}, ${person.id})
        on conflict do nothing`);
    }
  }

  async #locked(tx: Transaction, linkId: string): Promise<LinkRow> {
    const result = await tx.execute<LinkRow>(sql`
      select l.id, l.item_id, l.scope, l.secret_hash, l.password_hash, l.expires_at, l.revoked_at,
        t.space_id, s.organization_id, t.title
      from share_links l join tree_items t on t.id = l.item_id join spaces s on s.id = t.space_id
      where l.id = ${linkId} for update of l`);
    const row = result.rows[0];
    if (!row || row.revoked_at) throw new ShareLinkError("linkNotFound", "The link does not exist anymore");
    return row;
  }

  async itemOf(linkId: string): Promise<string | null> {
    const result = await this.#database.execute<{ item_id: string }>(
      sql`select item_id from share_links where id = ${linkId} and revoked_at is null`,
    );
    return result.rows[0]?.item_id ?? null;
  }

  async update(
    actor: Principal,
    linkId: string,
    changes: Partial<ShareLinkInput> & { password?: string | null | undefined },
  ): Promise<ShareLink> {
    const passwordHash =
      changes.password === undefined ? undefined : await this.#passwordHash(changes.password);
    const itemId = await this.#database.transaction(async (tx) => {
      const current = await this.#locked(tx, linkId);
      await this.#require(tx, actor, current.item_id);
      const currentPeople = await tx.execute<{ principal_kind: HolderKind; principal_id: string }>(
        sql`select principal_kind, principal_id from share_link_people where link_id = ${linkId}`,
      );
      const next: ShareLinkInput = {
        scope: changes.scope ?? current.scope,
        expiresAt:
          changes.expiresAt === undefined
            ? current.expires_at
              ? new Date(current.expires_at)
              : null
            : changes.expiresAt,
        people:
          changes.people ??
          currentPeople.rows.map((row) => ({ kind: row.principal_kind, id: row.principal_id })),
      };
      const { expiresAt, people } = await this.#validate(tx, actor, current.item_id, next);
      const changed: string[] = [];
      if (next.scope !== current.scope) changed.push("scope");
      if (
        (expiresAt?.getTime() ?? null) !==
        (current.expires_at ? new Date(current.expires_at).getTime() : null)
      )
        changed.push("expiresAt");
      if (passwordHash !== undefined) changed.push("password");
      if (changes.people) changed.push("people");
      await tx.execute(sql`
        update share_links set scope = ${next.scope}, expires_at = ${expiresAt},
          password_hash = ${passwordHash === undefined ? current.password_hash : passwordHash}, updated_at = now()
        where id = ${linkId}`);
      await this.#setPeople(tx, linkId, people);
      await this.#audit.record(tx, {
        name: "shareLink.changed",
        actor,
        targetId: linkId,
        fields: {
          spaceId: current.space_id,
          itemId: current.item_id,
          title: current.title,
          scope: next.scope,
          expiresAt: expiresAt?.toISOString() ?? null,
          unlockRequired: (passwordHash === undefined ? current.password_hash : passwordHash) !== null,
          changes: changed,
        },
        scope: auditScopeOf({ organizationId: current.organization_id }),
      });
      await signalSpaceChange(tx, { spaceId: current.space_id, kind: "access", itemId: current.item_id });
      return current.item_id;
    });
    const link = (await this.list(actor, itemId)).find((candidate) => candidate.id === linkId);
    if (!link) throw new ShareLinkError("linkNotFound", "The link does not exist anymore");
    return link;
  }

  async revoke(actor: Principal, linkId: string): Promise<void> {
    await this.#database.transaction(async (tx) => {
      const current = await this.#locked(tx, linkId);
      await this.#require(tx, actor, current.item_id);
      await tx.execute(sql`
        update share_links set revoked_at = now(), revoked_by = ${actorIdOf(actor)}, updated_at = now()
        where id = ${linkId}`);
      await tx.execute(sql`delete from share_link_accesses where link_id = ${linkId}`);
      await this.#audit.record(tx, {
        name: "shareLink.revoked",
        actor,
        targetId: linkId,
        fields: {
          spaceId: current.space_id,
          itemId: current.item_id,
          title: current.title,
          scope: current.scope,
          expiresAt: current.expires_at ? new Date(current.expires_at).toISOString() : null,
          unlockRequired: current.password_hash !== null,
        },
        scope: auditScopeOf({ organizationId: current.organization_id }),
      });
      await signalSpaceChange(tx, { spaceId: current.space_id, kind: "access", itemId: current.item_id });
    });
  }

  async #find(token: string): Promise<LinkRow | null> {
    const parts = splitLinkToken(token);
    const lookup = parts?.lookup ?? randomBytes(LOOKUP_BYTES).toString("base64url");
    const result = await this.#database.execute<LinkRow>(sql`
      select l.id, l.item_id, l.scope, l.secret_hash, l.password_hash, l.expires_at, l.revoked_at,
        t.space_id, s.organization_id, t.title,
        exists (select 1 from page_restrictions r where r.item_id = any(t.path) and r.kind = 'view') as restricted
      from share_links l join tree_items t on t.id = l.item_id join spaces s on s.id = t.space_id
      where l.lookup = ${lookup} and ${activeLinkCondition(sql`l`)}
        and t.trash_entry_id is null and s.deleted_at is null and t.reader_visible
        and organization_flag(s.organization_id, 'sharing.shareLinks', true)`);
    const row = result.rows[0];
    const expected = row?.secret_hash ?? Buffer.alloc(32);
    const provided = secretHash(parts?.secret ?? "");
    const matches = timingSafeEqual(expected, provided);
    return row && parts && matches ? row : null;
  }

  async #failure(clientIp: string): Promise<void> {
    await this.#rateLimiter.consume(
      `shareLink:failure:${clientSubject(clientIp)}`,
      CLIENT_FAILURES,
      CLIENT_WINDOW_SECONDS,
    );
  }

  async #clientBlocked(clientIp: string): Promise<void> {
    const key = `shareLink:failure:${clientSubject(clientIp)}`;
    const result = await this.#database.execute<{ count: number; retry: string }>(sql`
      select count, extract(epoch from (window_start + make_interval(secs => ${CLIENT_WINDOW_SECONDS}) - now())) as retry
      from rate_limits where key = ${key} and window_start > now() - make_interval(secs => ${CLIENT_WINDOW_SECONDS})`);
    const row = result.rows[0];
    if (row && Number(row.count) >= CLIENT_FAILURES) {
      throw new ShareLinkRateLimitedError(Math.max(1, Math.ceil(Number(row.retry))));
    }
  }

  async open(
    token: string,
    viewer: Principal,
    options: { password?: string | undefined; clientIp: string },
  ): Promise<OpenResult> {
    await this.#clientBlocked(options.clientIp);
    const link = await this.#find(token);
    if (!link) {
      await this.#failure(options.clientIp);
      throw new ShareLinkError("linkNotFound", "The link does not exist, has expired or was revoked");
    }
    if (viewer.type === "account") {
      const scope = await this.#database.execute<{ allowed: boolean }>(sql`
        select ${linkScopeCondition(sql`l`, sql`${viewer.id}::uuid`, sql`s`)} as allowed
        from share_links l join tree_items t on t.id = l.item_id join spaces s on s.id = t.space_id
        where l.id = ${link.id}`);
      if (!scope.rows[0]?.allowed) {
        throw new ShareLinkError("linkNotForYou", "This link was shared with other people");
      }
    } else if (link.scope !== "anyone" || link.restricted || !(await this.#anyoneAllowed(link))) {
      throw new ShareLinkError("signInRequired", "Sign in to open this link");
    }
    await this.#checkPassword(link, options.password, options.clientIp);
    if (viewer.type === "account") {
      await this.#database.transaction(async (tx) => {
        const inserted = await tx.execute(sql`
          insert into share_link_accesses (link_id, account_id) values (${link.id}, ${viewer.id})
          on conflict (link_id, account_id) do update set last_opened_at = now(), updated_at = now()
          returning (xmax = 0) as inserted`);
        if ((inserted.rows[0] as { inserted?: boolean } | undefined)?.inserted) {
          await this.#recordOpened(tx, viewer, link);
          await signalSpaceChange(tx, { spaceId: link.space_id, kind: "access", itemId: link.item_id });
        }
      });
      return { kind: "account", itemId: link.item_id };
    }
    const unlock = link.password_hash
      ? await this.#signer.sign(
          "shareLink",
          [link.id, passwordFingerprint(link.password_hash)],
          new Date(Date.now() + UNLOCK_HOURS * 60 * 60 * 1000),
        )
      : null;
    if (link.password_hash) {
      await this.#database.transaction((tx) => this.#recordOpened(tx, viewer, link));
    }
    return { kind: "anonymous", itemId: link.item_id, unlock };
  }

  async #recordOpened(tx: Transaction, viewer: Principal, link: LinkRow): Promise<void> {
    await this.#audit.record(tx, {
      name: "shareLink.opened",
      actor: viewer,
      targetId: link.id,
      fields: {
        spaceId: link.space_id,
        itemId: link.item_id,
        title: link.title,
        scope: link.scope,
        expiresAt: link.expires_at ? new Date(link.expires_at).toISOString() : null,
        unlockRequired: link.password_hash !== null,
      },
      scope: auditScopeOf({ organizationId: link.organization_id }),
    });
  }

  async #anyoneAllowed(link: LinkRow): Promise<boolean> {
    const chain = link.organization_id ? { organization: link.organization_id } : {};
    return this.#settings.get(anyoneLinksSetting, chain);
  }

  async #checkPassword(link: LinkRow, password: string | undefined, clientIp: string): Promise<void> {
    if (!link.password_hash) return;
    const attempts = await this.#rateLimiter.consume(
      `shareLink:password:${link.id}`,
      PASSWORD_ATTEMPTS,
      PASSWORD_WINDOW_SECONDS,
    );
    if (!attempts.allowed) throw new ShareLinkRateLimitedError(attempts.retryAfterSeconds);
    if (!password) throw new ShareLinkError("passwordRequired", "Enter the password of this link");
    const result = await this.#hasher.verify(link.password_hash, password.slice(0, PASSWORD_MAX_LENGTH));
    if (!result.valid) {
      await this.#failure(clientIp);
      throw new ShareLinkError("wrongPassword", "The password is not correct");
    }
  }

  async resolveAnonymous(token: string, unlock: string | undefined, clientIp: string): Promise<string> {
    await this.#clientBlocked(clientIp);
    const link = await this.#find(token);
    if (!link) {
      await this.#failure(clientIp);
      throw new ShareLinkError("linkNotFound", "The link does not exist, has expired or was revoked");
    }
    if (link.scope !== "anyone" || link.restricted || !(await this.#anyoneAllowed(link))) {
      throw new ShareLinkError("signInRequired", "Sign in to open this link");
    }
    if (link.password_hash) {
      const valid =
        unlock !== undefined &&
        (await this.#signer.verify("shareLink", [link.id, passwordFingerprint(link.password_hash)], unlock));
      if (!valid) throw new ShareLinkError("passwordRequired", "Enter the password of this link");
    }
    return link.item_id;
  }
}
