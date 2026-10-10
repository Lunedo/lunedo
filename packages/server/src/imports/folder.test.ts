import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import { ImportFolder } from "./folder.js";

function folder() {
  const root = mkdtempSync(path.join(tmpdir(), "pagehall-import-"));
  const directory = path.join(root, "import");
  mkdirSync(directory);
  writeFileSync(path.join(directory, "export.zip"), "zip content");
  mkdirSync(path.join(directory, "nested"));
  writeFileSync(path.join(directory, "nested", "inner.zip"), "inner");
  writeFileSync(path.join(directory, ".hidden.zip"), "hidden");
  writeFileSync(path.join(root, "outside.zip"), "outside");
  let linked = true;
  try {
    symlinkSync(path.join(root, "outside.zip"), path.join(directory, "link.zip"));
  } catch {
    linked = false;
  }
  return { root, directory, linked };
}

describe("import folder", () => {
  it("lists only regular files directly inside the folder", async () => {
    const { directory } = folder();
    const files = await new ImportFolder(directory).list();
    expect(files.map((file) => file.name)).toEqual(["export.zip"]);
    expect(files[0]?.size).toBe(11);
  });

  it("reads a listed file by its name", async () => {
    const { directory } = folder();
    const file = await new ImportFolder(directory).open("export.zip");
    expect((await buffer(await file.read(0, file.size))).toString()).toBe("zip content");
    expect((await buffer(await file.read(4, 7))).toString()).toBe("con");
    await file.close();
  });

  it.each([
    "../outside.zip",
    "nested/inner.zip",
    "nested",
    "..",
    ".",
    "/etc/passwd",
    "C:\\x.zip",
    ".hidden.zip",
    "",
  ])("refuses the name %j", async (name) => {
    const { directory } = folder();
    await expect(new ImportFolder(directory).open(name)).rejects.toMatchObject({
      code: "importFileUnavailable",
    });
  });

  it("refuses symbolic links", async (context) => {
    const { directory, linked } = folder();
    if (!linked) context.skip();
    await expect(new ImportFolder(directory).open("link.zip")).rejects.toMatchObject({
      code: "importFileUnavailable",
    });
    expect((await new ImportFolder(directory).list()).map((file) => file.name)).not.toContain("link.zip");
  });

  it("reports a missing folder", async () => {
    await expect(
      new ImportFolder(path.join(tmpdir(), "pagehall-missing-folder")).list(),
    ).rejects.toMatchObject({
      code: "importFolderUnavailable",
    });
  });
});
