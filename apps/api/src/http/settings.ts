import { BadRequestException, NotFoundException } from "@nestjs/common";
import type {
  ScopeChain,
  SettingDefinition,
  SettingLevel,
  SettingsRegistry,
  SettingsService,
} from "@pagehall/server";
import { z } from "zod";

export const settingUpdateSchema = z
  .object({ value: z.json().optional(), clear: z.literal(true).optional(), locked: z.boolean().optional() })
  .strict()
  .refine((body) => body.value !== undefined || body.clear || body.locked !== undefined);

export type SettingUpdate = z.output<typeof settingUpdateSchema>;

const MANAGED_ELSEWHERE = new Set(["mail.smtp"]);

export function definitionFor(
  registry: SettingsRegistry,
  key: string,
  level: SettingLevel,
): SettingDefinition<unknown> {
  let definition: SettingDefinition<unknown>;
  try {
    definition = registry.get(key);
  } catch {
    throw new NotFoundException({ statusCode: 404, code: "notFound", message: "The setting does not exist" });
  }
  if (!definition.levels.includes(level)) {
    throw new NotFoundException({ statusCode: 404, code: "notFound", message: "The setting does not exist" });
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
        source: explanation.source === "default" ? "default" : explanation.source.level,
        lockedBy: explanation.lockedBy?.level ?? null,
        locked: own?.locked ?? false,
        lockable: definition.lockable,
        editable: !MANAGED_ELSEWHERE.has(definition.key),
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
    throw new BadRequestException({
      statusCode: 400,
      code: "settingManagedElsewhere",
      message: "Change this setting through its own endpoint",
    });
  }
  if (update.clear) await settings.clear(definition, chain, level);
  else if (update.value !== undefined) await settings.set(definition, chain, level, update.value);
  if (update.locked === true) await settings.lock(definition, chain, level);
  if (update.locked === false) await settings.unlock(definition, chain, level);
}
