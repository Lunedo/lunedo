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
  /**
   * Levels below the instance may only make the inherited value stricter. `lower` means a
   * smaller value is stricter, `higher` a larger one; for booleans `true` is the larger value.
   */
  stricterOnly?: "lower" | "higher";
}

export function defineSetting<T>(definition: SettingDefinition<T>): SettingDefinition<T> {
  if (!/^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/.test(definition.key)) {
    throw new Error(`Setting key ${definition.key} must look like <module>.<name>`);
  }
  if (definition.levels.length === 0) throw new Error(`Setting ${definition.key} applies to no level`);
  if (!definition.schema.safeParse(definition.default).success) {
    throw new Error(`The default of setting ${definition.key} does not match its schema`);
  }
  if (definition.stricterOnly && !["number", "boolean"].includes(typeof definition.default)) {
    throw new Error(`Setting ${definition.key} can only be stricter-only with a number or boolean value`);
  }
  const levels = settingLevels.filter((level) => definition.levels.includes(level));
  return { ...definition, levels };
}

/** Whether `candidate` is at least as strict as `inherited`; always true without `stricterOnly`. */
export function isAtLeastAsStrict<T>(definition: SettingDefinition<T>, candidate: T, inherited: T): boolean {
  if (!definition.stricterOnly) return true;
  const value = Number(candidate);
  const reference = Number(inherited);
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
