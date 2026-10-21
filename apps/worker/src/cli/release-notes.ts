import { readFile } from "node:fs/promises";
import {
  changelogFileOf,
  parseChangelog,
  RELEASES_URL,
  releaseNotesText,
  versionFileOf,
} from "@pagehall/server";

export interface ReleaseNotesCommand {
  since: string | null;
  json: boolean;
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
  const lines = releaseNotesText(sections, command.since);
  if (lines.length === 0) {
    write(command.since ? `No release after ${command.since}.` : "No release yet.");
    return;
  }
  for (const line of lines) write(line);
}
