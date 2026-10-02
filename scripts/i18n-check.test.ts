import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  compareKeys,
  findEmptyMessages,
  findMissingKeys,
  findUntranslatedText,
  readSettingFields,
  requiredCatalogKeys,
} from "./i18n-check.ts";

describe("findUntranslatedText", () => {
  it("finds literal text in elements and user-facing attributes", () => {
    const source = [
      "export function Example({ t }) {",
      "  return (",
      '    <section aria-label="Members">',
      "      <h1>Members</h1>",
      '      <Field label={"Name"} hint={t("hint")} />',
      '      <img alt="Logo" src="/logo.png" />',
      "    </section>",
      "  );",
      "}",
    ].join("\n");
    assert.deepEqual(findUntranslatedText("example.tsx", source), [
      { line: 3, text: 'aria-label="Members"' },
      { line: 4, text: "Members" },
      { line: 5, text: 'label="Name"' },
      { line: 6, text: 'alt="Logo"' },
    ]);
  });

  it("accepts translated text, symbols, numbers and technical attributes", () => {
    const source = [
      "export function Example({ t }) {",
      "  return (",
      '    <div className="flex gap-2" data-theme="light" role="status">',
      '      {t("members.title")} · {count} %',
      '      <input type="email" autoComplete="username" aria-label={t("auth.email")} />',
      '      <span aria-hidden="true">·</span>',
      "    </div>",
      "  );",
      "}",
    ].join("\n");
    assert.deepEqual(findUntranslatedText("example.tsx", source), []);
  });
});

describe("compareKeys", () => {
  it("reports keys that exist in one language only", () => {
    const result = compareKeys({
      en: { members: { title: "Members", invite: "Invite" }, only: "English" },
      de: { members: { title: "Mitglieder" } },
    });
    assert.deepEqual(result, [{ language: "de", missing: ["members.invite", "only"] }]);
  });

  it("accepts languages with the same keys", () => {
    assert.deepEqual(compareKeys({ en: { a: { b: "x" } }, de: { a: { b: "y" } } }), []);
  });
});

describe("findEmptyMessages", () => {
  it("finds empty and blank messages", () => {
    assert.deepEqual(findEmptyMessages({ a: "", b: { c: "  ", d: "text" } }), ["a", "b.c"]);
  });
});

describe("catalog keys", () => {
  const source = [
    "const fields: SettingField[] = [",
    '  { key: "instance.name", type: { kind: "text" } },',
    '  { key: "branding.accentColor", type: { kind: "enum", values: accentColors, labelPrefix: "settings.values.accentColor" } },',
    "];",
    "",
  ].join("\n");

  it("reads setting keys and the value lists behind their labels", () => {
    assert.deepEqual(readSettingFields(source), [
      { key: "instance.name" },
      {
        key: "branding.accentColor",
        values: { source: "accentColors", labelPrefix: "settings.values.accentColor" },
      },
    ]);
  });

  it("requires a label for every audit event, setting and setting value", () => {
    const { keys, problems } = requiredCatalogKeys({
      auditEvents: ["settings.changed"],
      settingFields: readSettingFields(source),
      valueLists: { accentColors: ["petrol", "blue"] },
    });
    assert.deepEqual(problems, []);
    const messages = {
      audit: { events: { "settings.changed": "Setting changed" } },
      settings: {
        keys: { instance_name: { label: "Name" }, branding_accentColor: { label: "Accent color" } },
        values: { accentColor: { petrol: "Petrol" } },
      },
    };
    assert.deepEqual(findMissingKeys(messages, keys), ["settings.values.accentColor.blue"]);
    assert.deepEqual(findMissingKeys({}, ["audit.events.settings.changed"]), [
      "audit.events.settings.changed",
    ]);
  });

  it("reports value lists it does not know", () => {
    const { problems } = requiredCatalogKeys({
      auditEvents: [],
      settingFields: readSettingFields(source),
      valueLists: {},
    });
    assert.deepEqual(problems, ["setting branding.accentColor: the value list accentColors is unknown"]);
  });
});
