import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import { ImportFolder } from "./folder.js";

const ACME = "0c9d6a3e-5f2b-4c1a-9e8d-7b6a5c4d3e2f";
const GLOBEX = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const INITECH = "f0e1d2c3-b4a5-4968-8776-655443322110";

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
  const own = path.join(directory, ACME);
  mkdirSync(own, { recursive: true });
  writeFileSync(path.join(own, "export.zip"), "zip content");
  mkdirSync(path.join(own, "nested"));
  writeFileSync(path.join(own, "nested", "inner.zip"), "inner");
  writeFileSync(path.join(own, ".hidden.zip"), "hidden");
  mkdirSync(path.join(directory, GLOBEX));
  writeFileSync(path.join(directory, GLOBEX, "other.zip"), "other organization");
  mkdirSync(path.join(directory, "acme"));
  writeFileSync(path.join(directory, "acme", "slug.zip"), "named after a slug");
  writeFileSync(path.join(directory, "top.zip"), "top level");
  writeFileSync(path.join(root, "outside.zip"), "outside");
  const linked = link(path.join(root, "outside.zip"), path.join(own, "link.zip"));
  return { root, directory, linked };
}

describe("import folder", () => {
  it("lists only regular files directly inside the organization's subfolder", async () => {
    const { directory } = folder();
    const files = await new ImportFolder(directory).list(ACME);
    expect(files.map((file) => file.name)).toEqual(["export.zip"]);
    expect(files[0]?.size).toBe(11);
  });

  it("names the subfolder after the organization's ID", () => {
    expect(new ImportFolder("/data/import").pathFor(ACME)).toBe(path.join("/data/import", ACME));
  });

  it("reads a listed file by its name", async () => {
    const { directory } = folder();
    const file = await new ImportFolder(directory).open(ACME, "export.zip");
    expect((await buffer(await file.read(0, file.size))).toString()).toBe("zip content");
    expect((await buffer(await file.read(4, 7))).toString()).toBe("con");
    await file.close();
  });

  it("never offers files of another organization, of a slug folder or of the top level", async () => {
    const { directory } = folder();
    const files = new ImportFolder(directory);
    expect((await files.list(GLOBEX)).map((file) => file.name)).toEqual(["other.zip"]);
    for (const name of ["other.zip", "top.zip", "slug.zip", `../${GLOBEX}/other.zip`, "../acme/slug.zip"]) {
      await expect(files.open(ACME, name), name).rejects.toMatchObject({ code: "importFileUnavailable" });
    }
  });

  it("offers nothing while the organization's subfolder does not exist", async () => {
    const { directory } = folder();
    const files = new ImportFolder(directory);
    expect(await files.list(INITECH)).toEqual([]);
    await expect(files.open(INITECH, "export.zip")).rejects.toMatchObject({
      code: "importFileUnavailable",
    });
  });

  it.each([
    "..",
    ".",
    "",
    "acme",
    `../${ACME}`,
    `${ACME}/..`,
    `${ACME}/nested`,
    "/etc",
    "C:\\data",
    `..\\${ACME}`,
    ACME.toUpperCase(),
    `${ACME} `,
    `${ACME}\0`,
  ])("refuses the folder key %j", async (key) => {
    const { directory } = folder();
    const files = new ImportFolder(directory);
    expect(() => files.pathFor(key)).toThrow();
    await expect(files.list(key)).rejects.toMatchObject({ code: "importFolderUnavailable" });
    await expect(files.open(key, "export.zip")).rejects.toMatchObject({ code: "importFolderUnavailable" });
  });

  it("refuses a subfolder that is a symbolic link", async (context) => {
    const { root, directory } = folder();
    mkdirSync(path.join(root, "elsewhere"));
    writeFileSync(path.join(root, "elsewhere", "export.zip"), "elsewhere");
    if (!link(path.join(root, "elsewhere"), path.join(directory, INITECH), "junction")) context.skip();
    const files = new ImportFolder(directory);
    await expect(files.list(INITECH)).rejects.toMatchObject({ code: "importFolderUnavailable" });
    await expect(files.open(INITECH, "export.zip")).rejects.toMatchObject({
      code: "importFolderUnavailable",
    });
  });

  it("refuses a subfolder that is a file", async () => {
    const { directory } = folder();
    writeFileSync(path.join(directory, INITECH), "not a folder");
    await expect(new ImportFolder(directory).list(INITECH)).rejects.toMatchObject({
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
    await expect(new ImportFolder(directory).open(ACME, name)).rejects.toMatchObject({
      code: "importFileUnavailable",
    });
  });

  it("refuses symbolic links", async (context) => {
    const { directory, linked } = folder();
    if (!linked) context.skip();
    await expect(new ImportFolder(directory).open(ACME, "link.zip")).rejects.toMatchObject({
      code: "importFileUnavailable",
    });
    expect((await new ImportFolder(directory).list(ACME)).map((file) => file.name)).not.toContain("link.zip");
  });

  it("reports a missing folder", async () => {
    await expect(
      new ImportFolder(path.join(tmpdir(), "pagehall-missing-folder")).list(ACME),
    ).rejects.toMatchObject({
      code: "importFolderUnavailable",
    });
  });
});
