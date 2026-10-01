import { and, eq, or, sql } from "drizzle-orm";
import type { Database, Executor, Transaction } from "../database/database.js";
import type { NotificationListener } from "../database/notifications.js";
import type { Logger } from "../logging/logger.js";
import { isAtLeastAsStrict, type SettingDefinition, type SettingLevel, settingLevels } from "./definition.js";
import { settingValues } from "./schema.js";

/** Scope ID of the instance level. */
export const INSTANCE_SCOPE_ID = "00000000-0000-0000-0000-000000000000";

const CHANNEL = "pagehall_settings";

/** The scopes a request belongs to. The instance is always part of the chain. */
export interface ScopeChain {
  organization?: string;
  space?: string;
  user?: string;
}

export interface Scope {
  level: SettingLevel;
  id: string;
}

export interface SettingLevelState<T> {
  scope: Scope;
  /** Whether the setting can be set at this level. */
  applies: boolean;
  /** Value stored at this level, if any. */
  value: T | undefined;
  locked: boolean;
  /** False when a lock above this level makes the stored value ineffective. */
  effective: boolean;
}

export interface SettingExplanation<T> {
  key: string;
  value: T;
  /** Where the effective value comes from. */
  source: Scope | "default";
  /** The highest scope that locks the value, if any. */
  lockedBy: Scope | null;
  levels: SettingLevelState<T>[];
}

export class SettingError extends Error {
  override name = "SettingError";
}

export class SettingLockedError extends SettingError {
  override name = "SettingLockedError";

  constructor(
    key: string,
    readonly lockedBy: Scope,
  ) {
    super(`Setting ${key} is locked at the ${lockedBy.level} level`);
  }
}

export interface SettingChange {
  key: string;
  scope: Scope;
  action: "set" | "clear" | "lock" | "unlock";
  value?: unknown;
  previousValue: unknown;
  previousLocked: boolean;
}

export type SettingChangeHandler = (tx: Transaction, change: SettingChange) => Promise<void>;

export interface WriteOptions {
  tx?: Transaction;
  audit?: boolean;
}

interface StoredRow {
  value: unknown;
  locked: boolean;
}

type ScopeRows = Map<string, StoredRow>;

function scopeKey(scope: Scope): string {
  return `${scope.level}:${scope.id}`;
}

export function scopesOf(chain: ScopeChain): Scope[] {
  const scopes: Scope[] = [{ level: "instance", id: INSTANCE_SCOPE_ID }];
  for (const level of settingLevels) {
    if (level === "instance") continue;
    const id = chain[level];
    if (id) scopes.push({ level, id });
  }
  return scopes;
}

function chainAbove(chain: ScopeChain, level: SettingLevel): ScopeChain {
  const above: ScopeChain = {};
  for (const candidate of settingLevels) {
    if (candidate === level) break;
    if (candidate !== "instance" && chain[candidate]) above[candidate] = chain[candidate];
  }
  return above;
}

/**
 * Settings inheritance: instance → organization → space → user. Each level may
 * override the inherited value and, for lockable settings, lock it for the levels below.
 */
export class SettingsService {
  readonly #database: Database;
  readonly #logger: Logger;
  readonly #cache = new Map<string, Promise<ScopeRows>>();
  readonly #onChange: SettingChangeHandler | undefined;
  #caching = false;

  constructor(options: { database: Database; logger: Logger; onChange?: SettingChangeHandler }) {
    this.#database = options.database;
    this.#logger = options.logger;
    this.#onChange = options.onChange;
  }

  /**
   * Enables caching. Every node evicts cached scopes when another node changes them;
   * after a lost connection the whole cache is dropped.
   */
  async enableCache(listener: NotificationListener): Promise<void> {
    await listener.listen(CHANNEL, (payload) => this.#cache.delete(payload));
    listener.onReconnect(() => this.#cache.clear());
    this.#caching = true;
  }

  async #rows(scopes: Scope[], executor?: Executor): Promise<Map<string, ScopeRows>> {
    const result = new Map<string, ScopeRows>();
    const missing: Scope[] = [];
    for (const scope of scopes) {
      const cached = this.#caching ? this.#cache.get(scopeKey(scope)) : undefined;
      if (cached) result.set(scopeKey(scope), await cached);
      else missing.push(scope);
    }
    if (missing.length === 0) return result;

    const loading = (executor ?? this.#database)
      .select({
        level: settingValues.level,
        scopeId: settingValues.scopeId,
        key: settingValues.key,
        value: settingValues.value,
        locked: settingValues.locked,
      })
      .from(settingValues)
      .where(
        or(
          ...missing.map((scope) =>
            and(eq(settingValues.level, scope.level), eq(settingValues.scopeId, scope.id)),
          ),
        ),
      )
      .then((rows) => {
        const byScope = new Map<string, ScopeRows>(missing.map((scope) => [scopeKey(scope), new Map()]));
        for (const row of rows) {
          byScope.get(`${row.level}:${row.scopeId}`)?.set(row.key, { value: row.value, locked: row.locked });
        }
        return byScope;
      });
    if (this.#caching && !executor) {
      for (const scope of missing) {
        const key = scopeKey(scope);
        const entry = loading.then((byScope) => byScope.get(key) ?? new Map<string, StoredRow>());
        this.#cache.set(key, entry);
        // A failed load must not stay cached; the caller receives the error through `loading`.
        entry.catch(() => {
          if (this.#cache.get(key) === entry) this.#cache.delete(key);
        });
      }
    }
    for (const [key, rows] of await loading) result.set(key, rows);
    return result;
  }

  async explain<T>(
    definition: SettingDefinition<T>,
    chain: ScopeChain,
    options: { executor?: Executor } = {},
  ): Promise<SettingExplanation<T>> {
    const scopes = scopesOf(chain);
    const rows = await this.#rows(scopes, options.executor);
    let value = definition.default;
    let source: Scope | "default" = "default";
    let lockedBy: Scope | null = null;
    const levels: SettingLevelState<T>[] = [];

    for (const scope of scopes) {
      const applies = definition.levels.includes(scope.level);
      const row = applies ? rows.get(scopeKey(scope))?.get(definition.key) : undefined;
      let stored: T | undefined;
      if (row && row.value !== null) {
        const parsed = definition.schema.safeParse(row.value);
        if (parsed.success) stored = parsed.data;
        else
          this.#logger.warn({ setting: definition.key, scope }, "Ignoring an invalid stored setting value");
      }
      const weaker =
        stored !== undefined &&
        scope.level !== definition.levels[0] &&
        !isAtLeastAsStrict(definition, stored, value);
      const effective = applies && lockedBy === null && !weaker;
      if (effective && stored !== undefined) {
        value = stored;
        source = scope;
      }
      const locked = definition.lockable && (row?.locked ?? false);
      if (effective && locked) lockedBy = scope;
      levels.push({ scope, applies, value: stored, locked, effective });
    }
    return { key: definition.key, value, source, lockedBy, levels };
  }

  async get<T>(
    definition: SettingDefinition<T>,
    chain: ScopeChain,
    options: { executor?: Executor } = {},
  ): Promise<T> {
    return (await this.explain(definition, chain, options)).value;
  }

  #target(definition: SettingDefinition<unknown>, chain: ScopeChain, level: SettingLevel): Scope {
    if (!definition.levels.includes(level)) {
      throw new SettingError(`Setting ${definition.key} cannot be set at the ${level} level`);
    }
    const scope = scopesOf(chain).find((candidate) => candidate.level === level);
    if (!scope) throw new SettingError(`The scope chain has no ${level}`);
    return scope;
  }

  async #assertNotLockedAbove(definition: SettingDefinition<unknown>, chain: ScopeChain, target: Scope) {
    const explanation = await this.explain(definition, chain);
    const lockedBy = explanation.lockedBy;
    if (lockedBy && settingLevels.indexOf(lockedBy.level) < settingLevels.indexOf(target.level)) {
      throw new SettingLockedError(definition.key, lockedBy);
    }
  }

  async #write(
    target: Scope,
    key: string,
    values: { value?: unknown; locked?: boolean },
    action: SettingChange["action"],
    options: WriteOptions,
  ) {
    await (options.tx ?? this.#database).transaction(async (tx) => {
      const [previous] = await tx
        .select({ value: settingValues.value, locked: settingValues.locked })
        .from(settingValues)
        .where(
          and(
            eq(settingValues.level, target.level),
            eq(settingValues.scopeId, target.id),
            eq(settingValues.key, key),
          ),
        )
        .for("update");
      await tx
        .insert(settingValues)
        .values({
          level: target.level,
          scopeId: target.id,
          key,
          value: values.value ?? null,
          locked: values.locked ?? false,
        })
        .onConflictDoUpdate({
          target: [settingValues.level, settingValues.scopeId, settingValues.key],
          set: { ...values, updatedAt: new Date() },
        });
      await tx.execute(sql`select pg_notify(${CHANNEL}, ${scopeKey(target)})`);
      if (options.audit === false) return;
      await this.#onChange?.(tx, {
        key,
        scope: target,
        action,
        ...(action === "set" ? { value: values.value } : {}),
        previousValue: previous?.value ?? null,
        previousLocked: previous?.locked ?? false,
      });
    });
    this.#cache.delete(scopeKey(target));
  }

  /** Stores a value at `level`, the scope of that level taken from `chain`. */
  async set<T>(
    definition: SettingDefinition<T>,
    chain: ScopeChain,
    level: SettingLevel,
    value: T,
    options: WriteOptions = {},
  ): Promise<void> {
    const target = this.#target(definition as SettingDefinition<unknown>, chain, level);
    const parsed = definition.schema.safeParse(value);
    if (!parsed.success) throw new SettingError(`Invalid value for setting ${definition.key}`);
    await this.#assertNotLockedAbove(definition as SettingDefinition<unknown>, chain, target);
    if (definition.stricterOnly && level !== definition.levels[0]) {
      const inherited = await this.get(definition, chainAbove(chain, level));
      if (!isAtLeastAsStrict(definition, parsed.data, inherited)) {
        throw new SettingError(
          `Setting ${definition.key} can only be made stricter than the inherited value at the ${level} level`,
        );
      }
    }
    await this.#write(target, definition.key, { value: parsed.data }, "set", options);
  }

  /** Removes the value stored at `level`, so the inherited value applies again. A lock stays. */
  async clear(
    definition: SettingDefinition<unknown>,
    chain: ScopeChain,
    level: SettingLevel,
    options: WriteOptions = {},
  ): Promise<void> {
    const target = this.#target(definition, chain, level);
    await this.#assertNotLockedAbove(definition, chain, target);
    await this.#write(target, definition.key, { value: null }, "clear", options);
  }

  /** Locks the effective value at `level` for all levels below it. */
  async lock(
    definition: SettingDefinition<unknown>,
    chain: ScopeChain,
    level: SettingLevel,
    options: WriteOptions = {},
  ): Promise<void> {
    if (!definition.lockable) throw new SettingError(`Setting ${definition.key} cannot be locked`);
    if (level === definition.levels.at(-1)) {
      throw new SettingError(`Setting ${definition.key} cannot be locked at its lowest level`);
    }
    const target = this.#target(definition, chain, level);
    await this.#assertNotLockedAbove(definition, chain, target);
    await this.#write(target, definition.key, { locked: true }, "lock", options);
  }

  async unlock(
    definition: SettingDefinition<unknown>,
    chain: ScopeChain,
    level: SettingLevel,
    options: WriteOptions = {},
  ): Promise<void> {
    const target = this.#target(definition, chain, level);
    await this.#assertNotLockedAbove(definition, chain, target);
    await this.#write(target, definition.key, { locked: false }, "unlock", options);
  }

  /** Removes all values of a scope, e.g. when an organization or user is deleted. */
  async removeScope(scope: Scope): Promise<void> {
    await this.#database.transaction(async (tx) => {
      await tx
        .delete(settingValues)
        .where(and(eq(settingValues.level, scope.level), eq(settingValues.scopeId, scope.id)));
      await tx.execute(sql`select pg_notify(${CHANNEL}, ${scopeKey(scope)})`);
    });
    this.#cache.delete(scopeKey(scope));
  }
}
