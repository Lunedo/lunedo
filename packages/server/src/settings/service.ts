import { and, eq, or, sql } from "drizzle-orm";
import type { Database } from "../database/database.js";
import type { NotificationListener } from "../database/notifications.js";
import type { Logger } from "../logging/logger.js";
import type { SettingDefinition, SettingLevel } from "./definition.js";
import { settingLevels } from "./definition.js";
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

/**
 * Settings inheritance: instance → organization → space → user. Each level may
 * override the inherited value and, for lockable settings, lock it for the levels below.
 */
export class SettingsService {
  readonly #database: Database;
  readonly #logger: Logger;
  readonly #cache = new Map<string, Promise<ScopeRows>>();
  #caching = false;

  constructor(options: { database: Database; logger: Logger }) {
    this.#database = options.database;
    this.#logger = options.logger;
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

  async #rows(scopes: Scope[]): Promise<Map<string, ScopeRows>> {
    const result = new Map<string, ScopeRows>();
    const missing: Scope[] = [];
    for (const scope of scopes) {
      const cached = this.#caching ? this.#cache.get(scopeKey(scope)) : undefined;
      if (cached) result.set(scopeKey(scope), await cached);
      else missing.push(scope);
    }
    if (missing.length === 0) return result;

    const loading = this.#database
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
    if (this.#caching) {
      for (const scope of missing) {
        const key = scopeKey(scope);
        this.#cache.set(
          key,
          loading.then((byScope) => byScope.get(key) ?? new Map()),
        );
      }
    }
    for (const [key, rows] of await loading) result.set(key, rows);
    return result;
  }

  async explain<T>(definition: SettingDefinition<T>, chain: ScopeChain): Promise<SettingExplanation<T>> {
    const scopes = scopesOf(chain);
    const rows = await this.#rows(scopes);
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
      const effective = applies && lockedBy === null;
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

  async get<T>(definition: SettingDefinition<T>, chain: ScopeChain): Promise<T> {
    return (await this.explain(definition, chain)).value;
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

  async #write(target: Scope, key: string, values: { value?: unknown; locked?: boolean }) {
    await this.#database.transaction(async (tx) => {
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
    });
    this.#cache.delete(scopeKey(target));
  }

  /** Stores a value at `level`, the scope of that level taken from `chain`. */
  async set<T>(
    definition: SettingDefinition<T>,
    chain: ScopeChain,
    level: SettingLevel,
    value: T,
  ): Promise<void> {
    const target = this.#target(definition as SettingDefinition<unknown>, chain, level);
    const parsed = definition.schema.safeParse(value);
    if (!parsed.success) throw new SettingError(`Invalid value for setting ${definition.key}`);
    await this.#assertNotLockedAbove(definition as SettingDefinition<unknown>, chain, target);
    await this.#write(target, definition.key, { value: parsed.data });
  }

  /** Removes the value stored at `level`, so the inherited value applies again. A lock stays. */
  async clear(definition: SettingDefinition<unknown>, chain: ScopeChain, level: SettingLevel): Promise<void> {
    const target = this.#target(definition, chain, level);
    await this.#assertNotLockedAbove(definition, chain, target);
    await this.#write(target, definition.key, { value: null });
  }

  /** Locks the effective value at `level` for all levels below it. */
  async lock(definition: SettingDefinition<unknown>, chain: ScopeChain, level: SettingLevel): Promise<void> {
    if (!definition.lockable) throw new SettingError(`Setting ${definition.key} cannot be locked`);
    if (level === definition.levels.at(-1)) {
      throw new SettingError(`Setting ${definition.key} cannot be locked at its lowest level`);
    }
    const target = this.#target(definition, chain, level);
    await this.#assertNotLockedAbove(definition, chain, target);
    await this.#write(target, definition.key, { locked: true });
  }

  async unlock(
    definition: SettingDefinition<unknown>,
    chain: ScopeChain,
    level: SettingLevel,
  ): Promise<void> {
    const target = this.#target(definition, chain, level);
    await this.#assertNotLockedAbove(definition, chain, target);
    await this.#write(target, definition.key, { locked: false });
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
