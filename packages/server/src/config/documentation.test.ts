import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { configSettings } from "./definitions.js";

const documentation = readFileSync(new URL("../../../../docs/configuration.md", import.meta.url), "utf8");

describe("docs/configuration.md", () => {
  it.each(configSettings.map((setting) => setting.name))("documents %s", (name) => {
    expect(documentation).toContain(`| \`${name}\` |`);
  });
});
