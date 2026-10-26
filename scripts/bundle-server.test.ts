import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { RUNTIME_DEPENDENCIES, runtimeManifestProblems } from "./bundle-server.ts";

const root = path.resolve(import.meta.dirname, "..");

function dependencies(workspace: string): Record<string, string> {
  const manifest = JSON.parse(readFileSync(path.join(root, workspace, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
  };
  return manifest.dependencies ?? {};
}

describe("server bundle", () => {
  it("deploys exactly the packages it leaves external, in the versions the server declares", () => {
    assert.deepEqual(
      runtimeManifestProblems(
        { dependencies: dependencies("docker/runtime") },
        (name, workspace) => dependencies(workspace)[name],
      ),
      [],
    );
  });

  it("names a missing, outdated or bundled runtime dependency", () => {
    const declared = (name: string) => (name === "sharp" ? "^2.0.0" : "^1.0.0");
    const listed = Object.fromEntries(Object.keys(RUNTIME_DEPENDENCIES).map((name) => [name, "^1.0.0"]));
    delete listed.minisearch;
    const problems = runtimeManifestProblems({ dependencies: { ...listed, zod: "^4.0.0" } }, declared);
    assert.deepEqual(problems.sort(), [
      "docker/runtime depends on zod, which is bundled",
      "docker/runtime must depend on minisearch ^1.0.0",
      "docker/runtime must depend on sharp ^2.0.0",
    ]);
  });
});
