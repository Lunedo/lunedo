import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { imageReferences, playwrightImageProblems, playwrightVersions } from "./playwright-image.ts";

const digest = "a".repeat(64);
const lock = (version: string) =>
  `importers:\n  apps/web:\n    devDependencies:\n      '@playwright/test':\n        specifier: ^${version}\n        version: ${version}\n`;
const workflow = (image: string) => `jobs:\n  e2e:\n    container:\n      image: ${image}\n`;

describe("playwrightVersions", () => {
  it("reads the resolved version of @playwright/test", () => {
    assert.deepEqual(playwrightVersions(lock("1.64.0")), ["1.64.0"]);
  });
});

describe("imageReferences", () => {
  it("reads the version from a tag or from the comment behind a digest", () => {
    const text = `image: mcr.microsoft.com/playwright:v1.64.0-noble\nimage: mcr.microsoft.com/playwright@sha256:${digest} # v1.63.0-noble\nimage: postgres:16`;
    assert.deepEqual(imageReferences(text), [
      { line: 1, version: "1.64.0" },
      { line: 2, version: "1.63.0" },
    ]);
  });
});

describe("playwrightImageProblems", () => {
  it("accepts an image that matches the package", () => {
    const files = { "ci.yml": workflow(`mcr.microsoft.com/playwright@sha256:${digest} # v1.64.0-noble`) };
    assert.deepEqual(playwrightImageProblems(files, lock("1.64.0")), []);
  });

  it("rejects an image from another version and names file and line", () => {
    const files = { "ci.yml": workflow(`mcr.microsoft.com/playwright@sha256:${digest} # v1.63.0-noble`) };
    assert.deepEqual(playwrightImageProblems(files, lock("1.64.0")), [
      "ci.yml:4 uses the Playwright image 1.63.0, @playwright/test is 1.64.0",
    ]);
  });

  it("rejects a digest without a version comment", () => {
    const files = { "ci.yml": workflow(`mcr.microsoft.com/playwright@sha256:${digest}`) };
    assert.equal(playwrightImageProblems(files, lock("1.64.0")).length, 1);
  });

  it("fails when the package version cannot be determined", () => {
    assert.equal(playwrightImageProblems({}, "importers: {}\n").length, 1);
  });
});
