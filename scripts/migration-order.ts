export interface JournalEntry {
  readonly idx: number;
  readonly when: number;
  readonly tag: string;
}

const TAG = /^(\d{4})_[a-z0-9_]+$/;

export function parseJournal(content: string): JournalEntry[] {
  const parsed = JSON.parse(content) as { entries?: unknown };
  if (!Array.isArray(parsed.entries)) throw new Error("The migration journal has no list of entries.");
  return parsed.entries as JournalEntry[];
}

export function migrationOrderProblems(entries: readonly JournalEntry[], files: readonly string[]): string[] {
  const problems: string[] = [];
  const tags = new Set<string>();
  let previous: JournalEntry | undefined;
  for (const [position, entry] of entries.entries()) {
    const match = TAG.exec(entry.tag);
    if (!match) {
      problems.push(`${entry.tag}: the name must start with a four-digit number and an underscore`);
    } else if (Number(match[1]) !== position) {
      problems.push(
        `${entry.tag}: expected number ${String(position).padStart(4, "0")}; numbers must follow each other without gaps or duplicates`,
      );
    }
    if (entry.idx !== position) problems.push(`${entry.tag}: idx is ${entry.idx}, expected ${position}`);
    if (tags.has(entry.tag)) problems.push(`${entry.tag}: listed twice in the journal`);
    tags.add(entry.tag);
    if (!Number.isInteger(entry.when)) problems.push(`${entry.tag}: when is not a timestamp`);
    else if (previous && entry.when <= previous.when) {
      problems.push(
        `${entry.tag}: when (${entry.when}) is not newer than that of ${previous.tag} (${previous.when}), so the migrator would skip it on databases that applied ${previous.tag}`,
      );
    }
    if (!files.includes(`${entry.tag}.sql`))
      problems.push(`${entry.tag}: the file ${entry.tag}.sql is missing`);
    const snapshot = `meta/${entry.tag.slice(0, 4)}_snapshot.json`;
    if (match && !files.includes(snapshot))
      problems.push(`${entry.tag}: the snapshot ${snapshot} is missing`);
    previous = entry;
  }
  for (const file of files) {
    if (file.endsWith(".sql") && !tags.has(file.slice(0, -4)))
      problems.push(`${file}: not listed in meta/_journal.json`);
  }
  return problems;
}
