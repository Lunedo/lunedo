export interface CapturedEntry {
  kind: "captured";
  file: string;
  title: string;
  route: string;
  role: string;
  state: string;
  language: string;
  theme: string;
  device: string;
}

export interface FailedEntry {
  kind: "failed";
  title: string;
  reason: string;
}

export type CaptureEntry = CapturedEntry | FailedEntry;

export const USAGE = "Usage: pnpm screens:capture <output directory> [--skip-build]";

export interface CaptureOptions {
  output: string;
  build: boolean;
}

export function parseArguments(args: readonly string[]): CaptureOptions {
  const flags = args.filter((arg) => arg.startsWith("--"));
  const positional = args.filter((arg) => !arg.startsWith("--"));
  const unknown = flags.filter((flag) => flag !== "--skip-build");
  if (unknown.length > 0) throw new Error(`Unknown option ${unknown.join(", ")}. ${USAGE}`);
  if (positional.length !== 1 || !positional[0]) {
    throw new Error(`Name exactly one output directory. ${USAGE}`);
  }
  return { output: positional[0], build: !flags.includes("--skip-build") };
}

export function parseLog(text: string): CaptureEntry[] {
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as CaptureEntry);
}

function cell(value: string): string {
  return value.replaceAll("|", "|").replaceAll("\n", " ");
}

export function renderIndex(
  entries: readonly CaptureEntry[],
  heading: { date: string; commit: string },
): string {
  const captured = entries.filter((entry): entry is CapturedEntry => entry.kind === "captured");
  const gaps = entries.filter((entry): entry is FailedEntry => entry.kind !== "captured");
  const lines = [
    "# Screens",
    "",
    `Captured on ${heading.date} from commit ${heading.commit}: ${captured.length} screenshots.`,
    "",
    "| File | Screen | Route | Role | State | Language | Theme | Device |",
    "|---|---|---|---|---|---|---|---|",
    ...[...captured]
      .sort((a, b) => a.file.localeCompare(b.file))
      .map((entry) =>
        [
          `[${entry.file}](${entry.file})`,
          entry.title,
          `\`${entry.route}\``,
          entry.role,
          entry.state,
          entry.language,
          entry.theme,
          entry.device,
        ]
          .map(cell)
          .join(" | "),
      )
      .map((row) => `| ${row} |`),
  ];
  if (gaps.length > 0) {
    lines.push("", "## Not captured", "");
    for (const gap of gaps) {
      lines.push(`- ${gap.title}: ${cell(gap.reason)}`);
    }
  }
  return `${lines.join("\n")}\n`;
}
