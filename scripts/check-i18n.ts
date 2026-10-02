import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { auditEventNames } from "../packages/shared/src/audit.ts";
import * as preferenceValues from "../packages/shared/src/preferences.ts";
import {
  compareKeys,
  findEmptyMessages,
  findMissingKeys,
  findUntranslatedText,
  readSettingFields,
  requiredCatalogKeys,
} from "./i18n-check.ts";

const root = path.resolve(import.meta.dirname, "..");
const SOURCE_DIRECTORIES = ["apps/web/src", "packages/ui/src"];
const EXCLUDED_DIRECTORIES = new Set(["generated", "dev", "node_modules"]);
const LOCALES = path.join(root, "apps/web/src/i18n/locales");

function components(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return EXCLUDED_DIRECTORIES.has(entry.name) ? [] : components(full);
    return entry.name.endsWith(".tsx") && !entry.name.endsWith(".test.tsx") ? [full] : [];
  });
}

const problems: string[] = [];

for (const directory of SOURCE_DIRECTORIES) {
  for (const file of components(path.join(root, directory))) {
    for (const finding of findUntranslatedText(file, readFileSync(file, "utf8"))) {
      problems.push(
        `${path.relative(root, file)}:${finding.line}: text is not externalized: ${finding.text}`,
      );
    }
  }
}

const languages = Object.fromEntries(
  readdirSync(LOCALES)
    .filter((name) => name.endsWith(".json"))
    .map((name) => [
      name.slice(0, -".json".length),
      JSON.parse(readFileSync(path.join(LOCALES, name), "utf8")),
    ]),
);
for (const { language, missing } of compareKeys(languages)) {
  for (const key of missing) problems.push(`${language}.json: key ${key} is missing`);
}
for (const [language, messages] of Object.entries(languages)) {
  for (const key of findEmptyMessages(messages)) problems.push(`${language}.json: key ${key} is empty`);
}

const catalog = requiredCatalogKeys({
  auditEvents: auditEventNames,
  settingFields: readSettingFields(
    readFileSync(path.join(root, "apps/web/src/settings/setting-fields.ts"), "utf8"),
  ),
  valueLists: Object.fromEntries(
    Object.entries(preferenceValues as Record<string, unknown>).filter(
      (entry): entry is [string, readonly (string | number)[]] => Array.isArray(entry[1]),
    ),
  ),
});
problems.push(...catalog.problems);
for (const [language, messages] of Object.entries(languages)) {
  for (const key of findMissingKeys(messages, catalog.keys)) {
    problems.push(`${language}.json: key ${key} is missing for an audit event, a setting or a setting value`);
  }
}

if (problems.length > 0) {
  console.error("Translations are incomplete:");
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log(`Checked ${Object.keys(languages).length} languages and every component.`);
