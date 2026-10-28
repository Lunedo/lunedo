import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { loadEntry } from "./docs-reference.ts";
import { type EnvironmentVariable, environmentVariables } from "./reference-environment.ts";

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
});
