import { readFile } from "node:fs/promises";
import {
  type ChangelogSection,
  changelogFileOf,
  compareVersions,
  parseChangelog,
  parseReleaseVersion,
  RELEASES_URL,
  releaseNotesText,
  versionFileOf,
} from "@pagehall/server";

export interface ReleaseNotesCommand {
  since: string | null;
  json: boolean;
  updateFrom?: string | null;
}

export class UpdateStepError extends Error {
  override name = "UpdateStepError";
}

export async function releaseNotes(
  env: Readonly<Record<string, string | undefined>>,
  command: ReleaseNotesCommand,
  write: (line: string) => void,
): Promise<void> {
  const sections = parseChangelog(await readFile(changelogFileOf(env.PAGEHALL_CHANGELOG_FILE), "utf8"));
  if (command.json) {
    write(
      JSON.stringify(
        versionFileOf(sections, (version) => `${RELEASES_URL}/tag/v${version}`),
        null,
        2,
      ),
    );
    return;
  }
  const from = command.updateFrom ?? null;
  if (from) {
    const required = minimumUpdateFrom(sections, from);
    if (required) {
      throw new UpdateStepError(
        `Pagehall ${required.target} can only be installed from ${required.minimum} or later, and ${from} is installed. Update to ${required.minimum} first, for example with ./pagehall update ${required.minimum}, then to ${required.target}.`,
      );
    }
  }
  const after = from ?? command.since;
  const lines = releaseNotesText(sections, after);
  if (lines.length === 0) {
    write(after ? `No release after ${after}.` : "No release yet.");
    return;
  }
  for (const line of lines) write(line);
}

function minimumUpdateFrom(
  sections: readonly ChangelogSection[],
  from: string,
): { target: string; minimum: string } | null {
  const installed = parseReleaseVersion(from);
  if (!installed) return null;
  const newest = sections
    .flatMap((section) => {
      const version = parseReleaseVersion(section.version);
      return version ? [{ section, version }] : [];
    })
    .sort((left, right) => compareVersions(right.version, left.version))[0];
  const minimum = newest?.section.minimumUpdateFrom
    ? parseReleaseVersion(newest.section.minimumUpdateFrom)
    : null;
  if (!newest || !minimum || compareVersions(installed, minimum) >= 0) return null;
  return { target: newest.section.version, minimum: newest.section.minimumUpdateFrom ?? "" };
}
