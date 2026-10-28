import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  cell,
  code,
  defineReference,
  generatedNote,
  loadEntry,
  page,
  renderReferences,
  staleReferences,
  table,
} from "./docs-reference.ts";

const root = path.resolve(import.meta.dirname, "..");

describe("generated reference pages", () => {
  it("start with the title and a note naming the sources and the command", () => {
    const content = page({ title: "Things", sources: ["packages/a/src/things.ts"] }, "Body\n\n");
    assert.equal(content, `# Things\n\n${generatedNote(["packages/a/src/things.ts"])}\n\nBody\n`);
    assert.match(content, /generated from `packages\/a\/src\/things\.ts` by `pnpm docs:generate`/);
  });

  it("keep table cells on one line and escape pipes", () => {
    assert.equal(cell(" a |\n  b "), "a \\| b");
    assert.equal(table(["A", "B"], [["1", "x|y"]]), "| A | B |\n|---|---|\n| 1 | x\\|y |");
  });

  it("quote code that contains backticks", () => {
    assert.equal(code("plain"), "`plain`");
    assert.equal(code("a`b"), "``a`b``");
    assert.equal(code("`a"), "`` `a ``");
  });
});

describe("staleReferences", () => {
  const expected = new Map([
    ["docs/admin/a.md", "# A\n"],
    ["docs/admin/b.md", "# B\n"],
  ]);

  it("passes when every page matches", () => {
    assert.deepEqual(
      staleReferences(expected, (file) => expected.get(file)),
      [],
    );
  });

  it("names changed and missing pages", () => {
    const actual = new Map([["docs/admin/a.md", "# A\n\nEdited by hand.\n"]]);
    assert.deepEqual(
      staleReferences(expected, (file) => actual.get(file)),
      ["docs/admin/a.md is not up to date", "docs/admin/b.md is missing"],
    );
  });
});

describe("loadEntry", () => {
  it("bundles workspace sources, text files and packages and returns the default export", async () => {
    const directory = mkdtempSync(path.join(root, "scripts", ".docs-reference-"));
    try {
      writeFileSync(path.join(directory, "values.ts"), "export const values: string[] = ['b', 'a'];\n");
      writeFileSync(path.join(directory, "source.tsx"), "const x = <b>raw</b>;\n");
      const relative = path.relative(root, directory).replaceAll("\\", "/");
      const loaded = await loadEntry(
        root,
        "test",
        [
          `import { values } from "./${relative}/values.js";`,
          `import source from "./${relative}/source.tsx?text";`,
          `import { z } from "zod";`,
          "export default { values: [...values].sort(), source, parsed: z.string().parse('ok') };",
        ].join("\n"),
      );
      assert.deepEqual(loaded, { values: ["a", "b"], source: "const x = <b>raw</b>;\n", parsed: "ok" });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("renders each reference into its page, deterministically", async () => {
    const reference = defineReference<number[]>({
      page: "admin/numbers.md",
      title: "Numbers",
      sources: ["packages/server/src/numbers.ts"],
      entry: "export default [3, 1, 2];",
      render: (numbers) => numbers.map(String).join(", "),
    });
    const first = await renderReferences(root, [reference]);
    const second = await renderReferences(root, [reference]);
    assert.deepEqual([...first.keys()], ["docs/admin/numbers.md"]);
    assert.equal(first.get("docs/admin/numbers.md"), page(reference, "3, 1, 2"));
    assert.deepEqual(first, second);
  });
});
