import { readFileSync } from "node:fs";
import { configSettings } from "./definitions.js";
import type { Env } from "./load.js";

/** Settings that hold or point to key material; backups never contain them. */
const KEY_SETTINGS = new Set([
  "LUNEDO_MASTER_KEYS",
  "LUNEDO_MASTER_KEYS_FILE",
  "LUNEDO_MASTER_KEYS_PATH",
  "LUNEDO_BACKUP_KEY",
  "LUNEDO_BACKUP_KEY_FILE",
]);

/**
 * Configuration files for a backup: the configuration file without key settings and a
 * summary of the settings from the environment, where secret values are replaced by
 * whether they are set.
 */
export function configurationForBackup(env: Env): Record<string, string> {
  const files: Record<string, string> = {};
  const configFile = env.LUNEDO_CONFIG_FILE?.trim();
  if (configFile) {
    const values = JSON.parse(readFileSync(configFile, "utf8")) as Record<string, unknown>;
    for (const key of KEY_SETTINGS) delete values[key];
    files["lunedo.json"] = `${JSON.stringify(values, null, 2)}\n`;
  }

  const environment: Record<string, string> = {};
  for (const setting of configSettings) {
    if (KEY_SETTINGS.has(setting.name)) continue;
    for (const name of setting.secret ? [setting.name, `${setting.name}_FILE`] : [setting.name]) {
      const value = env[name];
      if (value === undefined || value === "") continue;
      environment[name] = setting.secret && !name.endsWith("_FILE") ? "[set]" : value;
    }
  }
  files["environment.json"] = `${JSON.stringify(environment, null, 2)}\n`;
  return files;
}
