import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  accentColors,
  auditEventNames,
  instanceAreas,
  organizationAreas,
  setupStepIds,
} from "@lunedo/shared";
import { describe, expect, it } from "vitest";
import { auditEventKey } from "../components/audit-log.js";
import { knownSettingKeys, settingDescriptionKey, settingLabelKey } from "../settings/setting-fields.js";
import { resources } from "./index.js";

const sourceRoot = path.resolve("src");

function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === "generated" || entry.name === "dev" ? [] : sources(full);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

function lookup(language: keyof typeof resources, key: string): unknown {
  return key
    .split(".")
    .reduce<unknown>(
      (node, part) =>
        node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined,
      resources[language].translation,
    );
}

function usedKeys(): string[] {
  const keys = new Set<string>();
  for (const file of sources(sourceRoot)) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/\bt\(\s*"([a-zA-Z0-9_.]+)"/g)) if (match[1]) keys.add(match[1]);
    for (const match of text.matchAll(/labelKey: "([a-zA-Z0-9_.]+)"/g)) if (match[1]) keys.add(match[1]);
    for (const match of text.matchAll(/translateKey\(t, "([a-zA-Z0-9_.]+)"/g))
      if (match[1]) keys.add(match[1]);
  }
  return [...keys].sort();
}

describe("translations", () => {
  it("contain every key the code uses, in every language", () => {
    const keys = usedKeys();
    expect(keys.length).toBeGreaterThan(400);
    for (const language of Object.keys(resources) as (keyof typeof resources)[]) {
      const missing = keys.filter((key) => typeof lookup(language, key) !== "string");
      expect(missing, language).toEqual([]);
    }
  });

  it("cover the keys that are built at runtime", () => {
    const families = [
      ...auditEventNames.map(auditEventKey),
      ...knownSettingKeys.flatMap((key) => [settingLabelKey(key), settingDescriptionKey(key)]),
      ...organizationAreas.flatMap((area) => [
        `areas.organization.${area}`,
        `areas.descriptions.organization.${area}`,
      ]),
      ...instanceAreas.flatMap((area) => [`areas.instance.${area}`, `areas.descriptions.instance.${area}`]),
      ...accentColors.map((color) => `settings.values.accentColor.${color}`),
      ...setupStepIds.flatMap((step) => [
        `setup.steps.${step}`,
        `setup.${step}.title`,
        `setup.${step}.description`,
      ]),
    ];
    for (const language of Object.keys(resources) as (keyof typeof resources)[]) {
      expect(
        families.filter((key) => typeof lookup(language, key) !== "string"),
        language,
      ).toEqual([]);
    }
  });
});
