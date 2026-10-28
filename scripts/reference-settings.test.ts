import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { loadEntry } from "./docs-reference.ts";
import {
  describedSettings,
  formatDefault,
  renderSettings,
  type SettingEntry,
  type SettingsPageEntry,
  type SettingsSource,
  settingsReference,
} from "./reference-settings.ts";

const root = path.resolve(import.meta.dirname, "..");

const pages: SettingsPageEntry[] = [
  { id: "instance.general", order: 10, section: "instance", labelKey: "navigation.general" },
  { id: "account.notifications", order: 30, section: "account", labelKey: "navigation.notifications" },
  {
    id: "organization.notifications",
    order: 30,
    section: "organization",
    labelKey: "navigation.notifications",
    groupKey: "navigationGroups.people",
  },
];

function setting(patch: Partial<SettingEntry> & { key: string }): SettingEntry {
  return {
    levels: ["organization", "user"],
    lockable: true,
    default: true,
    schema: { type: "boolean" },
    format: null,
    ...patch,
  };
}

function source(patch: Partial<SettingsSource> = {}): SettingsSource {
  return {
    settings: [
      setting({
        key: "instance.name",
        levels: ["instance"],
        lockable: false,
        default: "Lunedo",
        schema: { type: "string", maxLength: 100 },
      }),
      setting({ key: "notifications.mentions.inApp" }),
      setting({
        key: "notifications.mentions.email",
        default: "daily",
        schema: { type: "string", enum: ["off", "daily"] },
      }),
      setting({
        key: "hidden.flag",
        levels: ["user"],
        lockable: false,
        default: false,
        format: "A flag of its own.",
      }),
    ],
    index: {
      "instance.general": [
        {
          titleKey: "titles.identity",
          entries: [
            {
              id: "instance.name",
              labelKey: "settings.keys.instance_name.label",
              descriptionKey: "settings.keys.instance_name.description",
            },
            { id: "logo", labelKey: "titles.logo" },
          ],
        },
      ],
      "account.notifications": [
        {
          titleKey: "titles.events",
          entries: [{ id: "notifications.mentions", labelKey: "events.mentions" }],
        },
      ],
      "organization.notifications": [
        {
          titleKey: "titles.events",
          entries: [{ id: "notifications.mentions", labelKey: "events.mentions" }],
        },
      ],
    },
    messages: {
      navigation: {
        myAccount: "My account",
        organization: "Organization",
        instance: "Instance",
        general: "General",
        notifications: "Notifications",
      },
      navigationGroups: { people: "People" },
      titles: { identity: "Identity", logo: "Logo", events: "Events" },
      events: { mentions: "Mentions of me" },
      notifications: { channels: { inApp: "In the app", email: "E-mail" } },
      settings: {
        levels: { instance: "instance", organization: "organization", user: "user" },
        keys: {
          instance_name: { label: "Instance name", description: "On the sign-in page." },
          hidden_flag: { label: "Hidden flag", description: "Not in the search." },
        },
      },
    },
    pages,
    ...patch,
  };
}

describe("settings reference", () => {
  it("orders pages as the navigation does and names each page by its path", () => {
    const page = renderSettings(source());
    const headings = page.split("\n").filter((line) => line.startsWith("## "));
    assert.deepEqual(headings, [
      "## My account › Notifications",
      "## Organization › People › Notifications",
      "## Instance › General",
      "## Other settings",
    ]);
  });

  it("lists key, label, levels, default, allowed values, lock and hint, and skips entries that are no setting", () => {
    const page = renderSettings(source());
    assert.match(
      page,
      /\| `instance\.name` \| Instance name \| instance \| `Lunedo` \| Text of at most 100 characters\. \| no \| On the sign-in page\. \|/,
    );
    assert.doesNotMatch(page, /Logo/);
  });

  it("expands an entry into its channel settings and refers to an identical earlier section", () => {
    const page = renderSettings(source());
    assert.match(
      page,
      /\| `notifications\.mentions\.inApp` \| Mentions of me: In the app \| organization, user \| `true` \| `true` or `false`\. \| yes \| {2}\|/,
    );
    assert.match(
      page,
      /\| `notifications\.mentions\.email` \| Mentions of me: E-mail \| .* \| `off` or `daily`\. \|/,
    );
    assert.match(
      page,
      /The same settings as in \[My account › Notifications\]\(#my-account--notifications\)\./,
    );
    assert.equal(page.match(/`notifications\.mentions\.inApp`/g)?.length, 1);
  });

  it("puts settings without a search entry under other settings and prefers the format the code names", () => {
    const page = renderSettings(source());
    const others = page.slice(page.indexOf("## Other settings"));
    assert.match(
      others,
      /\| `hidden\.flag` \| Hidden flag \| user \| `false` \| A flag of its own\. \| no \| Not in the search\. \|/,
    );
  });

  it("fails when the search index names a page the navigation does not have", () => {
    const index = { ...source().index, "instance.unknown": [] };
    assert.throws(() => renderSettings(source({ index })), /has no page instance\.unknown/);
  });

  it("reports settings without a label", () => {
    const texts = describedSettings(
      source({ settings: [...source().settings, setting({ key: "new.thing", levels: ["instance"] })] }),
    );
    assert.equal(texts.get("new.thing")?.label, "");
    assert.equal(texts.get("notifications.mentions.email")?.label, "Mentions of me: E-mail");
  });

  it("shortens long defaults", () => {
    assert.equal(formatDefault(null), "none");
    assert.equal(formatDefault(""), "empty");
    assert.equal(formatDefault([]), "empty");
    assert.equal(formatDefault(30), "`30`");
    assert.equal(
      formatDefault(Array.from({ length: 30 }, (_, index) => `service-${index}`)),
      "a list of 30 entries",
    );
    assert.equal(formatDefault({ text: "x".repeat(100) }), "a structured value");
  });

  it("takes the pages from the module the settings navigation registers", async () => {
    assert.ok(settingsReference.sources.includes("apps/web/src/shell/settings-pages.ts"));
    const loaded = (await loadEntry(root, "settings-source", settingsReference.entry)) as SettingsSource;
    const module = await loadEntry(
      root,
      "settings-pages",
      'import { settingsPages } from "./apps/web/src/shell/settings-pages.ts";\nexport default settingsPages;',
    );
    assert.deepEqual(loaded.pages, module);
  });
});
