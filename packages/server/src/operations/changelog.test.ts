import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ChangelogError,
  newerReleases,
  parseChangelog,
  type Release,
  runningChangelog,
  UNRELEASED,
  versionFileOf,
  versionFileSchema,
} from "./changelog.js";

const CHANGELOG = `# Changelog

Introduction that is not part of a release.

## Unreleased

### New

- Something that is not released yet.

## 1.5.0 · 2026-11-02

Update from 1.3.0 or later.

### New

- Maintenance mode for scripted maintenance.
- A system status page that says
  what to fix.

### Breaking changes

- The metrics port moved.

### Manual steps

- Set \`LUNEDO_TRUSTED_PROXIES\` to the subnet of the proxy.

## 1.4.2 · 2026-10-01

### Fixed

- Uploads through Nginx.
`;

function release(version: string, notes: Partial<Release["notes"]> = {}): Release {
  return {
    version,
    date: null,
    minimumUpdateFrom: null,
    url: null,
    notes: { new: [], improved: [], fixed: [], breaking: [], manualSteps: [], ...notes },
  };
}

describe("parseChangelog", () => {
  it("reads every release with its date, minimum version and groups", () => {
    const sections = parseChangelog(CHANGELOG);
    expect(sections.map((section) => section.version)).toEqual([UNRELEASED, "1.5.0", "1.4.2"]);
    expect(sections[1]).toEqual({
      version: "1.5.0",
      date: "2026-11-02",
      minimumUpdateFrom: "1.3.0",
      notes: {
        new: ["Maintenance mode for scripted maintenance.", "A system status page that says what to fix."],
        improved: [],
        fixed: [],
        breaking: ["The metrics port moved."],
        manualSteps: ["Set `LUNEDO_TRUSTED_PROXIES` to the subnet of the proxy."],
      },
    });
    expect(sections[2]?.notes.fixed).toEqual(["Uploads through Nginx."]);
  });

  it("refuses unknown groups and versions so that a release cannot lose its notes", () => {
    expect(() => parseChangelog("## 1.0.0\n\n### Security\n\n- x")).toThrow(ChangelogError);
    expect(() => parseChangelog("## next\n")).toThrow('"next" is neither Unreleased nor a version');
  });
});

describe("the changelog of the repository", () => {
  it("follows the format so that every release can be read by the admin area and the update command", () => {
    const file = new URL("../../../../CHANGELOG.md", import.meta.url);
    const sections = parseChangelog(readFileSync(file, "utf8"));
    expect(sections[0]?.version).toBe(UNRELEASED);
    expect(sections.every((section) => Object.values(section.notes).some((notes) => notes.length > 0))).toBe(
      true,
    );
  });
});

describe("versionFileOf", () => {
  it("lists every released version with its notes and a link, and leaves out unreleased changes", () => {
    const file = versionFileOf(
      parseChangelog(CHANGELOG),
      (version) => `https://github.com/lunedo/lunedo/releases/tag/v${version}`,
    );
    expect(file.schema).toBe(1);
    expect(file.releases.map((entry) => entry.version)).toEqual(["1.5.0", "1.4.2"]);
    expect(file.releases[0]?.url).toBe("https://github.com/lunedo/lunedo/releases/tag/v1.5.0");
    expect(versionFileSchema.parse(JSON.parse(JSON.stringify(file)))).toEqual(file);
  });

  it("refuses links that are not HTTPS and entries that are too long", () => {
    expect(
      versionFileSchema.safeParse({
        schema: 1,
        releases: [{ ...release("1.0.0"), url: "javascript:alert(1)" }],
      }).success,
    ).toBe(false);
    expect(
      versionFileSchema.safeParse({ schema: 1, releases: [release("1.0.0", { new: ["x".repeat(2001)] })] })
        .success,
    ).toBe(false);
    expect(versionFileSchema.safeParse({ schema: 1, releases: [release("latest")] }).success).toBe(false);
  });
});

describe("newerReleases", () => {
  it("returns the releases after the running version, oldest first", () => {
    const releases = [release("1.5.0"), release("1.3.1"), release("1.10.0"), release("1.4.2")];
    expect(newerReleases(releases, "1.4.2").map((entry) => entry.version)).toEqual(["1.5.0", "1.10.0"]);
    expect(newerReleases(releases, "1.10.0")).toEqual([]);
    expect(newerReleases(releases, "dev").map((entry) => entry.version)).toEqual([
      "1.3.1",
      "1.4.2",
      "1.5.0",
      "1.10.0",
    ]);
  });
});

describe("runningChangelog", () => {
  it("shows the section of the running version, or the unreleased one for builds without a release", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "lunedo-changelog-"));
    const file = path.join(directory, "CHANGELOG.md");
    writeFileSync(file, CHANGELOG);
    expect((await runningChangelog(file, "1.4.2")).section?.notes.fixed).toEqual(["Uploads through Nginx."]);
    expect((await runningChangelog(file, "v1.5.0")).section?.version).toBe("1.5.0");
    expect((await runningChangelog(file, "0a1b2c3")).section?.version).toBe(UNRELEASED);
    expect(await runningChangelog(file, "9.9.9")).toEqual({ available: true, section: null });
    expect(await runningChangelog(path.join(directory, "missing.md"), "1.4.2")).toEqual({
      available: false,
      section: null,
    });
  });
});
