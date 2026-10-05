import type {
  ScopeChain,
  SettingDefinition,
  SettingLevel,
  SettingsRegistry,
  SettingsService,
} from "@pagehall/server";
import { z } from "zod";
import { ProblemException } from "./problems.js";

export const settingUpdateSchema = z
  .object({
    value: z.json().optional().describe("New value. Its type depends on the setting."),
    clear: z.literal(true).optional().describe("Remove the value at this level, so the level above applies."),
    locked: z.boolean().optional().describe("Lock or unlock the setting for the levels below."),
  })
  .strict()
  .refine((body) => body.value !== undefined || body.clear || body.locked !== undefined)
  .describe("A change to a setting. Send at least one field.");

export type SettingUpdate = z.output<typeof settingUpdateSchema>;

const MANAGED_ELSEWHERE = new Set([
  "mail.smtp",
  "mail.method",
  "mail.graph",
  "auth.emergencySignInRecipients",
  "instance.url",
]);

export function definitionFor(
  registry: SettingsRegistry,
  key: string,
  level: SettingLevel,
): SettingDefinition<unknown> {
  let definition: SettingDefinition<unknown>;
  try {
    definition = registry.get(key);
  } catch {
    throw new ProblemException("notFound", "The setting does not exist");
  }
  if (!definition.levels.includes(level)) {
    throw new ProblemException("notFound", "The setting does not exist");
  }
  return definition;
}

export async function listSettings(
  settings: SettingsService,
  registry: SettingsRegistry,
  level: SettingLevel,
  chain: ScopeChain,
) {
  const definitions = registry.all().filter((definition) => definition.levels.includes(level));
  return Promise.all(
    definitions.map(async (definition) => {
      const explanation = await settings.explain(definition, chain);
      const own = explanation.levels.find((state) => state.scope.level === level);
      return {
        key: definition.key,
        value: explanation.value,
        defaultValue: definition.default,
        source: explanation.source === "default" ? "default" : explanation.source.level,
        lockedBy: explanation.lockedBy?.level ?? null,
        locked: own?.locked ?? false,
        lockable: definition.lockable,
        levelsBelow: definition.levels.slice(definition.levels.indexOf(level) + 1),
        editable: !MANAGED_ELSEWHERE.has(definition.key),
        levels: explanation.levels
          .filter((state) => state.applies)
          .map((state) => ({
            level: state.scope.level,
            value: state.value ?? null,
            locked: state.locked,
            effective: state.effective,
          })),
      };
    }),
  );
}

export async function updateSetting(
  settings: SettingsService,
  definition: SettingDefinition<unknown>,
  level: SettingLevel,
  chain: ScopeChain,
  update: SettingUpdate,
): Promise<void> {
  if (MANAGED_ELSEWHERE.has(definition.key)) {
    throw new ProblemException("settingManagedElsewhere", "Change this setting through its own endpoint");
  }
  if (update.clear) await settings.clear(definition, chain, level);
  else if (update.value !== undefined) await settings.set(definition, chain, level, update.value);
  if (update.locked === true) await settings.lock(definition, chain, level);
  if (update.locked === false) await settings.unlock(definition, chain, level);
}
