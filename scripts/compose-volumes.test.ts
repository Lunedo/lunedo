import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const compose = readFileSync(path.join(root, "docker/compose.dev.yml"), "utf8");

function workspaceFolders(): string[] {
  return ["apps", "packages"].flatMap((parent) =>
    readdirSync(path.join(root, parent), { withFileTypes: true })
      .filter(
        (entry) => entry.isDirectory() && existsSync(path.join(root, parent, entry.name, "package.json")),
      )
      .map((entry) => `${parent}/${entry.name}`),
  );
}

describe("the development container", () => {
  it("keeps the node_modules of every workspace package in its own volume", () => {
    const mounted = new Map(
      [...compose.matchAll(/- ([\w-]+):\/repo\/(\S+)\/node_modules/g)].map((match) => [match[2], match[1]]),
    );
    for (const folder of workspaceFolders()) {
      const volume = mounted.get(folder);
      assert.ok(
        volume,
        `${folder}/node_modules has no volume, so the container would install into the host folder`,
      );
      assert.match(compose, new RegExp(`^  ${volume}:$`, "m"), `the volume ${volume} is not declared`);
    }
  });
});
