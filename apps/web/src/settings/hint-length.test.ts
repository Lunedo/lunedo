import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resources } from "../i18n/resources.js";
import { knownSettingKeys, settingDescriptionKey } from "./setting-fields.js";

const MAX_HINT = 50;
const settingsScreens = [
  "screens/account",
  "screens/organization",
  "screens/instance",
  "screens/settings",
  "screens/identity",
  "spaces/settings",
  "knowledge-bases/settings",
  "notifications",
  "embeds",
  "components",
];

function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return files(full);
    return /\.tsx$/.test(entry.name) && !/\.test\.tsx$|dialog|wizard|credentials/.test(entry.name)
      ? [full]
      : [];
  });
}

function hintKeys(): string[] {
  const keys = new Set<string>();
  for (const file of settingsScreens.flatMap((folder) => files(path.resolve("src", folder)))) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/hint=\{\s*t\("([\w.]+)"/g)) if (match[1]) keys.add(match[1]);
    for (const block of text.split("<SettingRow").slice(1)) {
      const match = block.slice(0, 600).match(/description=\{\s*t\("([\w.]+)"/);
      if (match?.[1]) keys.add(match[1]);
    }
  }
  return [...keys];
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

describe("hints of settings", () => {
  it("are one short sentence that fits in one line, with longer explanations behind the help", () => {
    const keys = [...hintKeys(), ...knownSettingKeys.map(settingDescriptionKey)];
    expect(keys.length).toBeGreaterThan(150);
    for (const language of Object.keys(resources) as (keyof typeof resources)[]) {
      const long = keys.filter((key) => {
        const text = lookup(language, key);
        return typeof text === "string" && text.length > MAX_HINT;
      });
      expect(long, language).toEqual([]);
    }
  });
});

function allFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return allFiles(full);
    return /\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name) ? [full] : [];
  });
}

function dialogHintKeys(): string[] {
  const keys = new Set<string>();
  for (const file of allFiles(path.resolve("src"))) {
    const text = readFileSync(file, "utf8");
    if (!/<Dialog\b|<ConfirmDialog\b|\bsteps\b/.test(text) && !/dialog|wizard|setup/i.test(file)) continue;
    for (const match of text.matchAll(/hint=\{\s*t\("([\w.]+)"\)\s*\}/g)) if (match[1]) keys.add(match[1]);
  }
  return [...keys];
}

describe("hints in dialogs and wizards", () => {
  it("say one sentence below the field and keep the rest behind the help", () => {
    const keys = dialogHintKeys();
    expect(keys.length).toBeGreaterThan(40);
    for (const language of Object.keys(resources) as (keyof typeof resources)[]) {
      const long = keys.filter((key) => {
        const text = lookup(language, key);
        if (typeof text !== "string") return false;
        const sentences = text.split(/(?<=[.!?])\s+(?=[A-ZÄÖÜ„"(])/).filter(Boolean);
        return text.length > 70 && sentences.length > 1;
      });
      expect(long, language).toEqual([]);
    }
  });
});
