import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("release notes", () => {
  it("exist for the version of the repository, as the text of its GitHub release", () => {
    const { version } = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };
    const notes = readFileSync(`docs/releases/${version}.md`, "utf8");
    assert.match(notes, new RegExp(`^# Lunedo ${version.replaceAll(".", ".")}\n`));
  });
});
