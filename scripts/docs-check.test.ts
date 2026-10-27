import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { anchors, checkDocs, type DocsTree, links, slug } from "./docs-check.ts";

const navigation = (pages: string[]) =>
  JSON.stringify({
    sections: [
      { title: "Get started", pages },
      { title: "API", pages: [] },
    ],
  });

function tree(
  patch: Partial<{
    files: Record<string, string>;
    targets: Record<string, string>;
    code: Record<string, string>;
  }> = {},
): DocsTree {
  const files = {
    "README.md": "# Lunedo\n\nSee [the docs](docs/README.md) and [the license](LICENSE).\n",
    LICENSE: "AGPL",
    "docs/README.md":
      "# Documentation\n\n- [Installation](admin/installation.md)\n- [Format](api/format.md#fields)\n",
    "docs/navigation.json": navigation(["admin/installation.md", "api/format.md"]),
    "docs/admin/installation.md":
      "# Installation\n\n## Chromium's sandbox\n\nSee [fields](../api/format.md#fields), [below](#rollback) and [the schema](../api/format.schema.json).\n\n## Rollback\n",
    "docs/api/format.md": "# Format\n\n## Fields\n\n```md\n# Not a heading\n[not a link](missing.md)\n```\n",
    "docs/api/format.schema.json": "{}",
    "docs/development/ci.md": "# CI\n\n# Second title is fine here\n",
    ...patch.files,
  };
  return {
    files: new Map(Object.entries(files)),
    targets: patch.targets ?? { index: "README.md", sandbox: "admin/installation.md#chromiums-sandbox" },
    code: new Map(
      Object.entries(
        patch.code ?? {
          "apps/web/src/help.tsx": 'open(docsUrl(documentationTargets.index));\nconst file = "notes.md";\n',
        },
      ),
    ),
  };
}

describe("checkDocs", () => {
  it("accepts a consistent docs tree", () => {
    assert.deepEqual(checkDocs(tree()), []);
  });

  it("reports targets of the module whose page or heading does not exist", () => {
    assert.deepEqual(
      checkDocs(tree({ targets: { gone: "admin/gone.md", anchor: "admin/installation.md#updates" } })),
      [
        "packages/shared/src/documentation.ts: gone points to admin/gone.md, but docs/admin/gone.md does not exist",
        "packages/shared/src/documentation.ts: anchor points to admin/installation.md#updates, but docs/admin/installation.md has no heading #updates",
      ],
    );
  });

  it("reports relative links and anchors that lead nowhere, in docs and in the root documents", () => {
    const problems = checkDocs(
      tree({
        files: {
          "CONTRIBUTING.md": "# Contributing\n\nSee [the guide](docs/development/setup.md).\n",
          "docs/user/pages.md":
            "# Pages\n\n[Up](../admin/installation.md#update) and [here](#missing) and [abs](/api/docs)\n",
          "docs/navigation.json": navigation(["admin/installation.md", "api/format.md", "user/pages.md"]),
        },
      }),
    );
    assert.deepEqual(problems, [
      "CONTRIBUTING.md:3: docs/development/setup.md is broken, docs/development/setup.md does not exist",
      "docs/user/pages.md:3: ../admin/installation.md#update is broken, docs/admin/installation.md has no heading #update",
      "docs/user/pages.md:3: #missing is broken, docs/user/pages.md has no heading #missing",
      "docs/user/pages.md:3: /api/docs is not a relative link",
    ]);
  });

  it("reports paths into docs/ in application code outside the target module", () => {
    const problems = checkDocs(
      tree({
        code: {
          "apps/web/src/screen.tsx": 'href={docsUrl("admin/rendering.md")}\n',
          "packages/server/src/status.ts": 'const links = { docs: "admin/installation.md#rollback" };\n',
          "packages/server/src/config.ts": "/** Documented in `docs/configuration.md`. */\n",
          "packages/server/src/status.test.ts": 'expect(item.docs).toBe("admin/installation.md");\n',
          "packages/shared/src/documentation.ts":
            'export const documentationTargets = { index: "README.md" };\n',
          "scripts/install.sh": 'echo "see docs/admin/installation.md"\n',
        },
      }),
    );
    assert.deepEqual(problems, [
      "apps/web/src/screen.tsx:1: admin/rendering.md points into docs/; use an entry of packages/shared/src/documentation.ts",
      "packages/server/src/status.ts:1: admin/installation.md#rollback points into docs/; use an entry of packages/shared/src/documentation.ts",
      "packages/server/src/config.ts:1: docs/configuration.md points into docs/; use an entry of packages/shared/src/documentation.ts",
    ]);
  });

  it("reports navigation entries that are missing, listed twice, unpublished or absent", () => {
    const problems = checkDocs(
      tree({
        files: {
          "docs/user/pages.md": "# Pages\n",
          "docs/navigation.json": navigation([
            "admin/installation.md",
            "admin/installation.md",
            "admin/gone.md",
            "development/ci.md",
            "api/format.md",
          ]),
        },
      }),
    );
    assert.deepEqual(problems, [
      "docs/navigation.json lists admin/installation.md twice",
      "docs/navigation.json lists admin/gone.md, which does not exist",
      "docs/navigation.json lists development/ci.md, but development pages are not published",
      "docs/user/pages.md is published but missing from docs/navigation.json",
    ]);
    assert.deepEqual(
      checkDocs(tree({ files: { "docs/navigation.json": "{" } }))[0]?.startsWith(
        "docs/navigation.json is not valid JSON",
      ),
      true,
    );
  });

  it("reports published pages without exactly one H1", () => {
    const problems = checkDocs(
      tree({
        files: {
          "docs/user/none.md": "## Only a section\n",
          "docs/user/two.md": "# One\n\n# Two\n",
          "docs/navigation.json": navigation([
            "admin/installation.md",
            "api/format.md",
            "user/none.md",
            "user/two.md",
          ]),
        },
      }),
    );
    assert.deepEqual(problems, [
      "docs/user/none.md has 0 H1 headings; a published page needs exactly one",
      "docs/user/two.md has 2 H1 headings; a published page needs exactly one",
    ]);
  });
});

describe("anchors and links", () => {
  it("follows the slug rule of GitHub, including repeated headings", () => {
    assert.equal(slug("Chromium's sandbox"), "chromiums-sandbox");
    assert.equal(slug("TLS and the instance address"), "tls-and-the-instance-address");
    assert.equal(slug("`LUNEDO_URL` and [links](x.md)"), "lunedo_url-and-links");
    assert.equal(slug("Größe – Überblick"), "größe--überblick");
    assert.deepEqual(
      [...anchors("# Setup\n## Steps\n## Steps\n```\n## Code\n```\n")],
      ["setup", "steps", "steps-1"],
    );
  });

  it("finds links outside code", () => {
    assert.deepEqual(links('[a](a.md) `[b](b.md)` ![c](c.png "title")\n```\n[d](d.md)\n```\n'), [
      { line: 1, href: "a.md" },
      { line: 1, href: "c.png" },
    ]);
  });
});
