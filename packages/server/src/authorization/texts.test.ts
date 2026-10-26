import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resourceTypes } from "./resources.js";
import { denials } from "./service.js";

const locales = path.resolve(import.meta.dirname, "../../../../apps/web/src/i18n/locales");

function messages(language: string): unknown {
  return JSON.parse(readFileSync(path.join(locales, `${language}.json`), "utf8"));
}

function lookup(messages: unknown, key: string): unknown {
  return key
    .split(".")
    .reduce<unknown>(
      (node, part) =>
        node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined,
      messages,
    );
}

describe("texts of permission explanations in the web client", () => {
  it("exist in every language for every action, rule and reason the permission views show", () => {
    const types = resourceTypes({ get: async () => true } as never).filter(
      (type) => type.type === "instance" || type.type === "organization",
    );
    const keys = [
      ...types.flatMap((type) =>
        Object.keys(type.actions).map((name) => `actions.${name.replaceAll(".", "_")}`),
      ),
      ...types.flatMap((type) => Object.keys(type.rules ?? {}).map((rule) => `grants.rules.${rule}`)),
      ...denials.map((denial) => `denials.${denial}`),
    ];
    expect(keys.length).toBeGreaterThan(60);
    for (const language of ["de", "en"]) {
      const texts = messages(language);
      expect(
        keys.filter((key) => typeof lookup(texts, key) !== "string"),
        language,
      ).toEqual([]);
    }
  });
});
