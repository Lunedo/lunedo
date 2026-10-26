import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  collectNotices,
  noticeOf,
  packageDirectoryOf,
  productionClosure,
  renderNotices,
} from "./third-party-notices.ts";

function project(packages: Record<string, { manifest: object; files?: Record<string, string> }>): string {
  const root = mkdtempSync(path.join(tmpdir(), "lunedo-notices-"));
  for (const [where, { manifest, files = {} }] of Object.entries(packages)) {
    const directory = path.join(root, where);
    mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(directory, "package.json"), JSON.stringify(manifest));
    for (const [name, content] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(directory, name)), { recursive: true });
      writeFileSync(path.join(directory, name), content);
    }
  }
  return realpathSync(root);
}

describe("third-party notices", () => {
  it("find the package of a bundled file, skipping nested manifests without a name", () => {
    const root = project({
      "node_modules/left-pad": {
        manifest: { name: "left-pad", version: "1.3.0", license: "WTFPL" },
        files: { "dist/esm/package.json": '{"type":"module"}', "dist/esm/index.js": "" },
      },
    });
    assert.equal(
      packageDirectoryOf(path.join(root, "node_modules/left-pad/dist/esm/index.js")),
      path.join(root, "node_modules/left-pad"),
    );
  });

  it("follow required and installed optional dependencies, and fail on a missing required one", () => {
    const root = project({
      app: {
        manifest: {
          name: "app",
          version: "1.0.0",
          dependencies: { a: "^1" },
          optionalDependencies: { gone: "^1" },
        },
      },
      "app/node_modules/a": { manifest: { name: "a", version: "1.0.0", dependencies: { b: "^1" } } },
      "node_modules/b": { manifest: { name: "b", version: "2.0.0" } },
      broken: { manifest: { name: "broken", version: "1.0.0", dependencies: { missing: "^1" } } },
    });
    const closure = [...productionClosure([path.join(root, "app")])].map((directory) =>
      path.relative(root, directory),
    );
    assert.deepEqual(
      closure.sort(),
      ["app", path.join("app", "node_modules", "a"), path.join("node_modules", "b")].sort(),
    );
    assert.throws(() => productionClosure([path.join(root, "broken")]), /broken needs missing/);
  });

  it("include every licence and notice file and leave out own workspace packages", () => {
    const root = project({
      lib: {
        manifest: { name: "lib", version: "1.0.0", license: "Apache-2.0" },
        files: { LICENSE: "Apache text\r\n", NOTICE: "Notice text", "README.md": "readme" },
      },
      own: {
        manifest: { name: "@lunedo/server", version: "0.0.0", private: true, license: "AGPL-3.0-only" },
      },
    });
    assert.deepEqual(noticeOf(path.join(root, "lib"))?.texts, [
      { file: "LICENSE", text: "Apache text" },
      { file: "NOTICE", text: "Notice text" },
    ]);
    assert.equal(noticeOf(path.join(root, "own")), null);
  });

  it("use the standard text with the author for packages that ship no licence file", () => {
    const root = project({
      mit: {
        manifest: { name: "mit", version: "1.0.0", license: "MIT", author: "Jane Doe <jane@example.org>" },
      },
    });
    const [text] = noticeOf(path.join(root, "mit"))?.texts ?? [];
    assert.match(text?.file ?? "", /^MIT \(standard text/);
    assert.match(text?.text ?? "", /Copyright \(c\) Jane Doe\n/);
  });

  it("add the LGPL and GPL texts and the reviewed licences of prebuilt native libraries", () => {
    const root = project({
      libvips: {
        manifest: { name: "@img/sharp-libvips-linux-x64", version: "1.3.4", license: "LGPL-3.0-or-later" },
        files: { "versions.json": JSON.stringify({ cairo: "1.18.4", unknown: "0.1" }) },
      },
    });
    const texts = noticeOf(path.join(root, "libvips"))?.texts ?? [];
    assert.deepEqual(
      texts.map((text) => text.file.split(" ")[0]),
      ["LGPL-3.0", "GPL-3.0", "versions.json"],
    );
    assert.deepEqual(texts[2]?.text.split("\n"), [
      "cairo 1.18.4: LGPL-2.1-only",
      "unknown 0.1: licence not reviewed",
    ]);
  });

  it("refuse to write a notices file when a licence text is missing", () => {
    const root = project({ odd: { manifest: { name: "odd", version: "1.0.0", license: "LicenseRef-Odd" } } });
    assert.throws(
      () => renderNotices("Lunedo", collectNotices([path.join(root, "odd")])),
      /No licence text for odd@1\.0\.0/,
    );
  });

  it("list each package version once, sorted, with its licence", () => {
    const root = project({
      b: { manifest: { name: "b", version: "1.0.0", license: "MIT" }, files: { LICENSE: "b" } },
      a2: { manifest: { name: "a", version: "2.0.0", license: "ISC" }, files: { LICENSE: "a2" } },
      a1: { manifest: { name: "a", version: "1.0.0", license: "ISC" }, files: { LICENSE: "a1" } },
    });
    const notices = collectNotices(["b", "a2", "a1", "b"].map((name) => path.join(root, name)));
    const text = renderNotices("Lunedo", notices);
    assert.match(text, /following 3 third-party packages/);
    assert.match(text, /- a 1\.0\.0 \(ISC\)\n- a 2\.0\.0 \(ISC\)\n- b 1\.0\.0 \(MIT\)/);
  });
});
