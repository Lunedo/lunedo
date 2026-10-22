import { readFile } from "node:fs/promises";
import { z } from "zod";
import { compareVersions, parseReleaseVersion } from "./version.js";

export const UNRELEASED = "Unreleased";
export const changelogGroups = ["new", "improved", "fixed", "breaking", "manualSteps"] as const;
export type ChangelogGroup = (typeof changelogGroups)[number];

export const MAX_ENTRY_LENGTH = 2000;
export const MAX_ENTRIES_PER_GROUP = 200;
export const MAX_RELEASES = 500;

const HEADINGS: Record<string, ChangelogGroup> = {
  new: "new",
  improved: "improved",
  fixed: "fixed",
  "breaking changes": "breaking",
  "manual steps": "manualSteps",
};

const entries = z.array(z.string().min(1).max(MAX_ENTRY_LENGTH)).max(MAX_ENTRIES_PER_GROUP);
const releaseVersion = z.string().regex(/^\d{1,6}\.\d{1,6}\.\d{1,6}$/, "is not a release version like 1.4.2");

export const releaseNotesSchema = z.object({
  new: entries.default([]),
  improved: entries.default([]),
  fixed: entries.default([]),
  breaking: entries.default([]),
  manualSteps: entries.default([]),
});

export type ReleaseNotes = z.output<typeof releaseNotesSchema>;

export const releaseSchema = z.object({
  version: releaseVersion,
  date: z.iso.date().nullable(),
  minimumUpdateFrom: releaseVersion.nullable(),
  url: z
    .url({ protocol: /^https$/ })
    .max(500)
    .nullable()
    .default(null),
  notes: releaseNotesSchema,
});

export type Release = z.output<typeof releaseSchema>;

export const versionFileSchema = z.object({
  schema: z.literal(1),
  releases: z.array(releaseSchema).max(MAX_RELEASES),
});

export type VersionFile = z.output<typeof versionFileSchema>;

const downloadedFileSchema = z.object({
  schema: z.literal(1),
  releases: z.array(z.unknown()).max(MAX_RELEASES),
});

export function downloadedReleases(parsed: unknown): { releases: Release[]; ignored: number } | null {
  const file = downloadedFileSchema.safeParse(parsed);
  if (!file.success) return null;
  const releases: Release[] = [];
  for (const entry of file.data.releases) {
    const release = releaseSchema.safeParse(entry);
    if (release.success) releases.push(release.data);
  }
  return { releases, ignored: file.data.releases.length - releases.length };
}

export interface ChangelogSection {
  version: string;
  date: string | null;
  minimumUpdateFrom: string | null;
  notes: ReleaseNotes;
}

function emptyNotes(): ReleaseNotes {
  return { new: [], improved: [], fixed: [], breaking: [], manualSteps: [] };
}

export class ChangelogError extends Error {
  override name = "ChangelogError";
}

export function parseChangelog(markdown: string): ChangelogSection[] {
  const sections: ChangelogSection[] = [];
  let current: ChangelogSection | null = null;
  let group: ChangelogGroup | null = null;
  let entry: string[] | null = null;
  const flush = () => {
    if (current && group && entry) current.notes[group].push(entry.join(" ").trim());
    entry = null;
  };
  for (const [index, line] of markdown.replaceAll("\r\n", "\n").split("\n").entries()) {
    const release = /^## (\S+)(?: · (\d{4}-\d{2}-\d{2}))?\s*$/.exec(line);
    if (release) {
      flush();
      const version = release[1] as string;
      if (version !== UNRELEASED && parseReleaseVersion(version) === null) {
        throw new ChangelogError(
          `Line ${index + 1}: "${version}" is neither ${UNRELEASED} nor a version like 1.4.2`,
        );
      }
      current = { version, date: release[2] ?? null, minimumUpdateFrom: null, notes: emptyNotes() };
      sections.push(current);
      group = null;
      continue;
    }
    if (!current) continue;
    const minimum = /^Update from (\d+\.\d+\.\d+) or later\.?\s*$/.exec(line);
    if (minimum && group === null) {
      current.minimumUpdateFrom = minimum[1] as string;
      continue;
    }
    const heading = /^### (.+?)\s*$/.exec(line);
    if (heading) {
      flush();
      const found = HEADINGS[(heading[1] as string).toLowerCase()];
      if (!found) throw new ChangelogError(`Line ${index + 1}: unknown group "${heading[1]}"`);
      group = found;
      continue;
    }
    const item = /^- (.+)$/.exec(line);
    if (item && group) {
      flush();
      entry = [item[1] as string];
      continue;
    }
    if (entry && /^\s{2,}\S/.test(line)) {
      entry.push(line.trim());
      continue;
    }
    if (line.trim() !== "") flush();
  }
  flush();
  return sections;
}

export function versionFileOf(
  sections: readonly ChangelogSection[],
  releaseUrl: (version: string) => string,
): VersionFile {
  const releases = sections
    .filter((section) => section.version !== UNRELEASED)
    .map((section) =>
      releaseSchema.parse({
        version: section.version,
        date: section.date,
        minimumUpdateFrom: section.minimumUpdateFrom,
        url: releaseUrl(section.version),
        notes: section.notes,
      }),
    );
  return versionFileSchema.parse({ schema: 1, releases });
}

export function newerReleases(releases: readonly Release[], running: string): Release[] {
  const current = parseReleaseVersion(running);
  return releases
    .flatMap((release) => {
      const version = parseReleaseVersion(release.version);
      return version && (!current || compareVersions(version, current) > 0) ? [{ release, version }] : [];
    })
    .sort((left, right) => compareVersions(left.version, right.version))
    .map(({ release }) => release);
}

export interface RunningChangelog {
  available: boolean;
  section: ChangelogSection | null;
}

export async function runningChangelog(file: string, running: string): Promise<RunningChangelog> {
  let markdown: string;
  try {
    markdown = await readFile(file, "utf8");
  } catch {
    return { available: false, section: null };
  }
  const sections = parseChangelog(markdown);
  const release = parseReleaseVersion(running) ? running.replace(/^v/, "") : UNRELEASED;
  return { available: true, section: sections.find((section) => section.version === release) ?? null };
}

export function releaseNotesText(sections: readonly ChangelogSection[], since: string | null): string[] {
  const after = since ? parseReleaseVersion(since) : null;
  const lines: string[] = [];
  const labels: Record<ChangelogGroup, string> = {
    breaking: "Breaking changes",
    manualSteps: "Manual steps",
    new: "New",
    improved: "Improved",
    fixed: "Fixed",
  };
  for (const section of sections) {
    const version = parseReleaseVersion(section.version);
    if (!version || (after && compareVersions(version, after) <= 0)) continue;
    lines.push(`Lunedo ${section.version}${section.date ? ` (${section.date})` : ""}`);
    if (section.minimumUpdateFrom) lines.push(`  Update from ${section.minimumUpdateFrom} or later.`);
    for (const group of ["breaking", "manualSteps", "new", "improved", "fixed"] as const) {
      if (section.notes[group].length === 0) continue;
      lines.push(`  ${labels[group]}:`);
      for (const entry of section.notes[group]) lines.push(`    - ${entry}`);
    }
  }
  return lines;
}
