import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { withDeclaredLicense } from "./license-files.ts";
import { UNDECLARED_LICENSE } from "./license-policy.ts";

describe("withDeclaredLicense", () => {
  const root = mkdtempSync(join(tmpdir(), "license-files-"));
  after(() => rmSync(root, { recursive: true, force: true }));

  const packageDir = (name: string, manifest: Record<string, unknown>, files: Record<string, string>) => {
    const directory = join(root, name);
    mkdirSync(directory);
    writeFileSync(join(directory, "package.json"), JSON.stringify(manifest));
    for (const [file, text] of Object.entries(files)) writeFileSync(join(directory, file), text);
    return directory;
  };
  const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

  it("reports a package without a declared license as undeclared, whatever pnpm read from its files", () => {
    const text = "The MIT License (MIT)";
    const directory = packageDir("lowercase", { name: "lowercase", version: "2.1.0" }, { license: text });
    const result = withDeclaredLicense({
      name: "lowercase",
      versions: ["2.1.0"],
      license: "MIT",
      paths: [directory],
    });
    assert.deepEqual(result, {
      name: "lowercase",
      versions: ["2.1.0"],
      license: UNDECLARED_LICENSE,
      licenseFiles: { "2.1.0": sha256(text) },
    });
  });

  it("keeps the license of a package that declares one", () => {
    const directory = packageDir(
      "declared",
      { name: "declared", version: "1.0.0", license: "MIT" },
      { LICENSE: "MIT" },
    );
    const result = withDeclaredLicense({
      name: "declared",
      versions: ["1.0.0"],
      license: "MIT",
      paths: [directory],
    });
    assert.deepEqual(result, { name: "declared", versions: ["1.0.0"], license: "MIT" });
  });

  it("pins no file when the license file is ambiguous or missing", () => {
    const two = packageDir(
      "two",
      { name: "two", version: "1.0.0" },
      { LICENSE: "MIT", "COPYING.txt": "GPL" },
    );
    const none = packageDir("none", { name: "none", version: "2.0.0" }, {});
    const result = withDeclaredLicense({
      name: "pkg",
      versions: ["1.0.0", "2.0.0"],
      license: "MIT",
      paths: [two, none],
    });
    assert.equal(result.license, UNDECLARED_LICENSE);
    assert.deepEqual(result.licenseFiles, {});
  });
});
