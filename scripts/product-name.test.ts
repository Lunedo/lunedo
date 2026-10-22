import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { findFormerName, imageNameProblems } from "./product-name.ts";

const former = ["page", "hall"].join("");
const Former = `${former[0]?.toUpperCase()}${former.slice(1)}`;

describe("findFormerName", () => {
  it("finds the former name in every spelling with its line", () => {
    const content = [
      "first",
      `Welcome to ${Former}`,
      `${former.toUpperCase()}_URL=x`,
      `@${former}/server`,
    ].join("\n");
    assert.deepEqual(
      findFormerName(content, "docs/setup.md").map((finding) => finding.line),
      [2, 3, 4],
    );
  });

  it("finds the former name in a file name", () => {
    assert.deepEqual(findFormerName("", `docker/${former}.yaml`), [
      { line: 0, text: `docker/${former}.yaml` },
    ]);
  });

  it("allows applied migrations and their snapshots but no later ones", () => {
    const content = `'${former}'`;
    assert.deepEqual(findFormerName(content, "packages/server/drizzle/0048_reimport.sql"), []);
    assert.deepEqual(findFormerName(content, "packages/server/drizzle/meta/0096_snapshot.json"), []);
    assert.deepEqual(findFormerName(content, "packages/server/drizzle/0097_rename_kept_decision.sql"), []);
    assert.equal(findFormerName(content, "packages/server/drizzle/0098_next.sql").length, 1);
    assert.equal(findFormerName(content, "packages/server/drizzle/meta/_journal.json").length, 1);
  });

  it("allows the database names only as whole names", () => {
    const file = "packages/server/src/search/indexer.ts";
    assert.deepEqual(findFormerName(`const CHANNEL = "${former}_search_changes";`, file), []);
    assert.deepEqual(findFormerName(`lock(\`${former}.tree:\${id}\`)`, file), []);
    assert.deepEqual(findFormerName(`${former}_group_id`, "packages/server/src/identity/schema.ts"), []);
    assert.equal(findFormerName(`"${former}_search_changes" and ${Former}`, file).length, 1);
    assert.equal(findFormerName(`${former}.other`, file).length, 1);
  });

  it("allows the test site name only in the fixture guard and the fixture script tests", () => {
    const content = `const TEST_SITE = "${former}-test";`;
    const folder = "packages/server/src/imports/testing/confluence-cloud";
    assert.deepEqual(findFormerName(content, `${folder}/fixture-guard.test.ts`), []);
    assert.deepEqual(findFormerName(content, `${folder}/prepare.test.ts`), []);
    assert.equal(findFormerName(content, `${folder}/fixtures.ts`).length, 1);
    assert.equal(findFormerName(content, "apps/api/src/http/instance-url.test.ts").length, 1);
    assert.equal(findFormerName(`${Former}`, `${folder}/fixture-guard.test.ts`).length, 1);
  });

  it("allows the former product name only in the fixture script that replaces it", () => {
    const content = `const FORMER = "${former}"; // ${Former} ${former.toUpperCase()}`;
    const folder = "packages/server/src/imports/testing/confluence-cloud";
    assert.deepEqual(findFormerName(content, `${folder}/prepare.ts`), []);
    assert.deepEqual(findFormerName(content, `${folder}\\prepare.ts`), []);
    assert.equal(findFormerName(content, `${folder}/snapshot.ts`).length, 1);
    assert.equal(findFormerName(content, `${folder}/fixtures/PHIT.jsonl.gz`).length, 1);
  });
});

describe("imageNameProblems", () => {
  it("accepts lowercase image names with expressions and placeholders", () => {
    const content = [
      "  IMAGE: ghcr.io/lunedo/lunedo",
      `  echo "image=ghcr.io/lunedo/lunedo:\${release#v}"`,
      "  image: ghcr.io/lunedo/lunedo:<version>",
      `  tags: ghcr.io/lunedo/render:\${{ steps.version.outputs.tag }}`,
    ].join("\n");
    assert.deepEqual(imageNameProblems(content, ".github/workflows/image.yml"), []);
  });

  it("rejects image names with capitals anywhere", () => {
    const image = ["ghcr.io", "Lunedo", "lunedo:1.0"].join("/");
    assert.deepEqual(imageNameProblems(`image: ${image}`, "docs/setup.md"), [
      `docs/setup.md:1: image name ${image} must be lowercase`,
    ]);
  });

  it("rejects image names derived from the repository in workflows unless lowercased", () => {
    for (const line of [
      `  IMAGE: ghcr.io/\${{ github.repository }}`,
      `  images: ghcr.io/\${{ github.repository_owner }}/render`,
      `  tags: "$REGISTRY/\${GITHUB_REPOSITORY}:latest"`,
    ]) {
      assert.equal(imageNameProblems(line, ".github/workflows/image.yml").length, 1, line);
    }
    assert.deepEqual(
      imageNameProblems(`  image="ghcr.io/\${GITHUB_REPOSITORY,,}"`, ".github/workflows/image.yml"),
      [],
    );
    assert.deepEqual(
      imageNameProblems(
        "    if: github.event.pull_request.head.repo.full_name == github.repository",
        ".github/workflows/ci.yml",
      ),
      [],
    );
  });
});
