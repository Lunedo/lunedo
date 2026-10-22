import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { releaseNotes, UpdateStepError } from "./release-notes.js";

const CHANGELOG = `# Changelog

## Unreleased

### New

- Not released.

## 1.5.0 · 2026-11-02

Update from 1.4.0 or later.

### New

- Maintenance mode.

### Manual steps

- Set PAGEHALL_TRUSTED_PROXIES.

## 1.4.2 · 2026-10-01

### Fixed

- Uploads.
`;

function changelog(): Record<string, string> {
  const directory = mkdtempSync(path.join(tmpdir(), "pagehall-notes-"));
  const file = path.join(directory, "CHANGELOG.md");
  writeFileSync(file, CHANGELOG);
  return { PAGEHALL_CHANGELOG_FILE: file };
}

async function lines(
  env: Record<string, string>,
  since: string | null,
  json = false,
  updateFrom: string | null = null,
): Promise<string[]> {
  const written: string[] = [];
  await releaseNotes(env, { since, json, updateFrom }, (line) => written.push(line));
  return written;
}

describe("pagehall release-notes", () => {
  it("prints the notes of every release after a version, with breaking changes and manual steps first", async () => {
    expect(await lines(changelog(), "1.4.2")).toEqual([
      "Pagehall 1.5.0 (2026-11-02)",
      "  Update from 1.4.0 or later.",
      "  Manual steps:",
      "    - Set PAGEHALL_TRUSTED_PROXIES.",
      "  New:",
      "    - Maintenance mode.",
    ]);
    expect(await lines(changelog(), "1.5.0")).toEqual(["No release after 1.5.0."]);
  });

  it("refuses an update that skips a required version and allows one from a new enough version", async () => {
    await expect(lines(changelog(), null, false, "1.3.9")).rejects.toThrow(UpdateStepError);
    await expect(lines(changelog(), null, false, "1.3.9")).rejects.toThrow(
      "Pagehall 1.5.0 can only be installed from 1.4.0 or later, and 1.3.9 is installed. Update to 1.4.0 first",
    );
    expect((await lines(changelog(), null, false, "1.4.0"))[0]).toBe("Pagehall 1.5.0 (2026-11-02)");
  });

  it("prints the version file that is attached to every release", async () => {
    const [output] = await lines(changelog(), null, true);
    expect(JSON.parse(output ?? "")).toMatchObject({
      schema: 1,
      releases: [
        {
          version: "1.5.0",
          minimumUpdateFrom: "1.4.0",
          url: "https://github.com/pagehall/pagehall/releases/tag/v1.5.0",
        },
        { version: "1.4.2", notes: { fixed: ["Uploads."] } },
      ],
    });
  });
});
