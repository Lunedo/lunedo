import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { loadEntry } from "./docs-reference.ts";
import { type AuditSource, auditEvents, eventLabel } from "./reference-audit.ts";
import { type CliSource, cliReference, usageSections } from "./reference-cli.ts";
import { type EnvironmentVariable, environmentVariables } from "./reference-environment.ts";
import { describedSettings, type SettingsSource, settingsReference } from "./reference-settings.ts";

const root = path.resolve(import.meta.dirname, "..");

function undescribed(items: readonly { name: string; description: string }[]): string[] {
  return items.filter((item) => item.description.trim() === "").map((item) => item.name);
}

describe("descriptions in the code", () => {
  it("describe every environment variable", async () => {
    const variables = (await loadEntry(
      root,
      "variables",
      environmentVariables.entry,
    )) as EnvironmentVariable[];
    assert.ok(variables.length > 0);
    assert.deepEqual(undescribed(variables), []);
  });

  it("label every setting in English", async () => {
    const source = (await loadEntry(root, "settings", settingsReference.entry)) as SettingsSource;
    const texts = describedSettings(source);
    assert.equal(texts.size, source.settings.length);
    assert.deepEqual(undescribed([...texts].map(([name, text]) => ({ name, description: text.label }))), []);
  });

  it("describe every audit event in English", async () => {
    const source = (await loadEntry(root, "audit", auditEvents.entry)) as AuditSource;
    assert.ok(source.events.length > 0);
    assert.deepEqual(
      undescribed(
        source.events.map((event) => ({ name: event.name, description: eventLabel(source, event.name) })),
      ),
      [],
    );
  });

  it("describe every command, option and exit code", async () => {
    const source = (await loadEntry(root, "cli", cliReference.entry)) as CliSource;
    assert.ok(source.commands.length > 0);
    const items = [
      ...source.commands.map((command) => ({ name: command.synopsis, description: command.description })),
      ...source.commands.flatMap((command) =>
        command.options.map((option) => ({
          name: `${command.synopsis} ${option.flag}`,
          description: option.description,
        })),
      ),
      ...source.exitCodes.map((exit) => ({ name: String(exit.code), description: exit.description })),
      ...usageSections(source.wrapper).flatMap((section) => section.entries.map((entry) => ({ ...entry }))),
    ];
    assert.deepEqual(undescribed(items), []);
  });
});
