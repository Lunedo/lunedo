import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import { ImportFolder } from "./folder.js";

function link(target: string, location: string, type?: "dir" | "junction"): boolean {
  try {
    symlinkSync(target, location, type);
    return true;
  } catch {
    return false;
  }
}

function folder() {
  const root = mkdtempSync(path.join(tmpdir(), "pagehall-import-"));
  const directory = path.join(root, "import");
  const own = path.join(directory, "acme");
  mkdirSync(own, { recursive: true });
  writeFileSync(path.join(own, "export.zip"), "zip content");
  mkdirSync(path.join(own, "nested"));
  writeFileSync(path.join(own, "nested", "inner.zip"), "inner");
  writeFileSync(path.join(own, ".hidden.zip"), "hidden");
  mkdirSync(path.join(directory, "globex"));
  writeFileSync(path.join(directory, "globex", "other.zip"), "other organization");
  writeFileSync(path.join(directory, "top.zip"), "top level");
  writeFileSync(path.join(root, "outside.zip"), "outside");
  const linked = link(path.join(root, "outside.zip"), path.join(own, "link.zip"));
  return { root, directory, linked };
}

describe("import folder", () => {
  it("lists only regular files directly inside the organization's subfolder", async () => {
    const { directory } = folder();
    const files = await new ImportFolder(directory).list("acme");
    expect(files.map((file) => file.name)).toEqual(["export.zip"]);
    expect(files[0]?.size).toBe(11);
  });

  it("names the subfolder after the organization's slug", () => {
    expect(new ImportFolder("/data/import").pathFor("acme")).toBe(path.join("/data/import", "acme"));
  });

  it("reads a listed file by its name", async () => {
    const { directory } = folder();
    const file = await new ImportFolder(directory).open("acme", "export.zip");
    expect((await buffer(await file.read(0, file.size))).toString()).toBe("zip content");
    expect((await buffer(await file.read(4, 7))).toString()).toBe("con");
    await file.close();
  });

  it("never offers files of another organization or of the top level", async () => {
    const { directory } = folder();
    const files = new ImportFolder(directory);
    expect((await files.list("globex")).map((file) => file.name)).toEqual(["other.zip"]);
    for (const name of ["other.zip", "top.zip", "../globex/other.zip", "../top.zip"]) {
      await expect(files.open("acme", name), name).rejects.toMatchObject({ code: "importFileUnavailable" });
    }
  });

  it("offers nothing while the organization's subfolder does not exist", async () => {
    const { directory } = folder();
    const files = new ImportFolder(directory);
    expect(await files.list("initech")).toEqual([]);
    await expect(files.open("initech", "export.zip")).rejects.toMatchObject({
      code: "importFileUnavailable",
    });
  });

  it.each([
    "..",
    ".",
    "",
    "../acme",
    "acme/..",
    "acme/nested",
    "/etc",
    "C:\\data",
    "..\\acme",
    "Acme",
    "-acme",
    "acme\0",
  ])("refuses the slug %j", async (slug) => {
    const { directory } = folder();
    const files = new ImportFolder(directory);
    expect(() => files.pathFor(slug)).toThrow();
    await expect(files.list(slug)).rejects.toMatchObject({ code: "importFolderUnavailable" });
    await expect(files.open(slug, "export.zip")).rejects.toMatchObject({ code: "importFolderUnavailable" });
  });

  it("refuses a subfolder that is a symbolic link", async (context) => {
    const { root, directory } = folder();
    mkdirSync(path.join(root, "elsewhere"));
    writeFileSync(path.join(root, "elsewhere", "export.zip"), "elsewhere");
    if (!link(path.join(root, "elsewhere"), path.join(directory, "linked"), "junction")) context.skip();
    const files = new ImportFolder(directory);
    await expect(files.list("linked")).rejects.toMatchObject({ code: "importFolderUnavailable" });
    await expect(files.open("linked", "export.zip")).rejects.toMatchObject({
      code: "importFolderUnavailable",
    });
  });

  it("refuses a subfolder that is a file", async () => {
    const { directory } = folder();
    writeFileSync(path.join(directory, "initech"), "not a folder");
    await expect(new ImportFolder(directory).list("initech")).rejects.toMatchObject({
      code: "importFolderUnavailable",
    });
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
    await expect(new ImportFolder(directory).open("acme", name)).rejects.toMatchObject({
      code: "importFileUnavailable",
    });
  });

  it("refuses symbolic links", async (context) => {
    const { directory, linked } = folder();
    if (!linked) context.skip();
    await expect(new ImportFolder(directory).open("acme", "link.zip")).rejects.toMatchObject({
      code: "importFileUnavailable",
    });
    expect((await new ImportFolder(directory).list("acme")).map((file) => file.name)).not.toContain(
      "link.zip",
    );
  });

  it("reports a missing folder", async () => {
    await expect(
      new ImportFolder(path.join(tmpdir(), "pagehall-missing-folder")).list("acme"),
    ).rejects.toMatchObject({
      code: "importFolderUnavailable",
    });
  });
});
