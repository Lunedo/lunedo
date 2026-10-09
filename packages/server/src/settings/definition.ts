import type { z } from "zod";
import { settingLevels } from "./schema.js";

export type SettingLevel = (typeof settingLevels)[number];

export { settingLevels };

export interface SettingDefinition<T> {
  /** `<module>.<name>`, e.g. `locale.timeZone`. */
  key: string;
  schema: z.ZodType<T>;
  default: T;
  /** Levels where the setting can be set, from the list instance, organization, space, user. */
  levels: readonly SettingLevel[];
  /** Whether a level can lock the value for the levels below it. */
  lockable: boolean;
  stricterOnly?: "lower" | "higher";
  minimum?: SettingDefinition<number>;
  maximum?: SettingDefinition<Limit>;
}

export const UNLIMITED = "unlimited";
export type Limit = number | typeof UNLIMITED;

export function limitOf(value: unknown): number {
  return value === UNLIMITED ? Number.POSITIVE_INFINITY : Number(value);
}

export function defineSetting<T>(definition: SettingDefinition<T>): SettingDefinition<T> {
  if (!/^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/.test(definition.key)) {
    throw new Error(`Setting key ${definition.key} must look like <module>.<name>`);
  }
  if (definition.levels.length === 0) throw new Error(`Setting ${definition.key} applies to no level`);
  if (!definition.schema.safeParse(definition.default).success) {
    throw new Error(`The default of setting ${definition.key} does not match its schema`);
  }
  if (
    definition.stricterOnly &&
    definition.default !== null &&
    !["number", "boolean"].includes(typeof definition.default)
  ) {
    throw new Error(`Setting ${definition.key} can only be stricter-only with a number or boolean value`);
  }
  if (definition.minimum && typeof definition.default !== "number") {
    throw new Error(`Setting ${definition.key} can only have a minimum with a number value`);
  }
  if (definition.maximum && typeof definition.default !== "number" && definition.default !== UNLIMITED) {
    throw new Error(`Setting ${definition.key} can only have a maximum with a number or unlimited value`);
  }
  const levels = settingLevels.filter((level) => definition.levels.includes(level));
  return { ...definition, levels };
}

export function isAtLeastAsStrict<T>(definition: SettingDefinition<T>, candidate: T, inherited: T): boolean {
  if (!definition.stricterOnly) return true;
  const unbounded = definition.stricterOnly === "lower" ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
  const value = candidate === null ? unbounded : Number(candidate);
  const reference = inherited === null ? unbounded : Number(inherited);
  return definition.stricterOnly === "lower" ? value <= reference : value >= reference;
}

/** All settings known to this process. Modules register theirs at startup. */
export class SettingsRegistry {
  readonly #definitions = new Map<string, SettingDefinition<unknown>>();

  register(...definitions: SettingDefinition<never>[]): this {
    for (const definition of definitions) {
      if (this.#definitions.has(definition.key))
        throw new Error(`Setting ${definition.key} is registered twice`);
      this.#definitions.set(definition.key, definition as SettingDefinition<unknown>);
    }
    return this;
  }

  get(key: string): SettingDefinition<unknown> {
    const definition = this.#definitions.get(key);
    if (!definition) throw new Error(`Unknown setting ${key}`);
    return definition;
  }

  has(definition: SettingDefinition<unknown>): boolean {
    return this.#definitions.get(definition.key) === definition;
  }

  all(): SettingDefinition<unknown>[] {
    return [...this.#definitions.values()];
  }
}
