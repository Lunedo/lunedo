import { code, defineReference, table } from "./docs-reference.ts";

export interface CliOptionEntry {
  readonly flag: string;
  readonly description: string;
}

export interface CliCommandEntry {
  readonly synopsis: string;
  readonly description: string;
  readonly options: readonly CliOptionEntry[];
}

export interface ExitCodeEntry {
  readonly code: number;
  readonly description: string;
}

export interface CliSource {
  readonly commands: readonly CliCommandEntry[];
  readonly exitCodes: readonly ExitCodeEntry[];
  readonly wrapper: string;
}

export interface UsageSection {
  readonly title: string;
  readonly entries: readonly { readonly name: string; readonly description: string }[];
  readonly notes: readonly string[];
}

const COMMANDS = "apps/worker/src/cli/commands.ts";
const WRAPPER = "scripts/install.sh";

export function usageSections(script: string): UsageSection[] {
  const start = script.indexOf("cat <<'USAGE'\n");
  const end = script.indexOf("\nUSAGE\n", start);
  if (start < 0 || end < 0) throw new Error(`${WRAPPER} has no usage text`);
  const sections: { title: string; entries: { name: string; description: string }[]; notes: string[] }[] = [];
  for (const line of script.slice(start + "cat <<'USAGE'\n".length, end).split("\n")) {
    const section = sections.at(-1);
    const title = /^(\S.*):$/.exec(line)?.[1];
    const entry = /^ {2}(\S.*?) {2,}(\S.*)$/.exec(line);
    const continued = /^ {4,}(\S.*)$/.exec(line)?.[1];
    if (title !== undefined) {
      sections.push({ title, entries: [], notes: [] });
    } else if (section && entry) {
      section.entries.push({ name: entry[1] ?? "", description: entry[2] ?? "" });
    } else if (section && continued !== undefined && section.entries.length > 0) {
      const last = section.entries.at(-1);
      if (last) last.description = `${last.description} ${continued}`;
    } else if (section && line.trim() !== "") {
      section.notes.push(line.trim());
    }
  }
  return sections;
}

function sentence(text: string): string {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

const LITERAL =
  /(?<![`\w])(--[a-z][\w-]*(?: <[^>\s]+>)?|[a-z][\w.+-]*:\/\/\S*?|~?\/[\w./-]+?|LUNEDO_[A-Z0-9_]+|\S*<[^>\s]+>\S*?)(?=[.,;:)]{0,2}(?:\s|$))/g;

export function prose(text: string): string {
  return text.replace(LITERAL, (literal) => code(literal));
}

const WRAPPER_HEADERS: Readonly<Record<string, readonly string[]>> = {
  Usage: ["Command", "Description"],
  Options: ["Option", "Description"],
  "Exit codes": ["Code", "Meaning"],
};

function renderCommand(command: CliCommandEntry): string {
  const options =
    command.options.length === 0
      ? []
      : [
          table(
            ["Option", "Description"],
            command.options.map((option) => [code(option.flag), prose(option.description)]),
          ),
        ];
  return [`### ${code(`lunedo ${command.synopsis}`)}`, prose(command.description), ...options].join("\n\n");
}

function renderWrapper(script: string): string[] {
  return usageSections(script).map((section) => {
    const header = WRAPPER_HEADERS[section.title] ?? [section.title, "Description"];
    const rows = section.entries.map((entry) => [code(entry.name), prose(sentence(entry.description))]);
    const notes = section.notes.map((note) => prose(sentence(note)));
    return [`### ${section.title}`, table(header, rows), ...notes].join("\n\n");
  });
}

export function renderCli(source: CliSource): string {
  return [
    "Lunedo has two commands. `lunedo` is part of the image and works with the database, the file store and the backups of the instance. `./lunedo` is the setup script, copied into the installation directory; it installs and updates the installation and runs some commands of `lunedo` in the running container.",
    "## lunedo in the image",
    "Run it in the container with the same configuration as the instance, for example `docker compose exec lunedo lunedo <command>` while Lunedo runs, or `docker compose run --rm lunedo <command>` while it is stopped.",
    ...source.commands.map(renderCommand),
    "### Exit codes",
    table(
      ["Code", "Meaning"],
      [...source.exitCodes]
        .sort((a, b) => a.code - b.code)
        .map((exit) => [code(String(exit.code)), prose(exit.description)]),
    ),
    "## ./lunedo of the setup script",
    "Run it in the installation directory, for example `cd /opt/lunedo && ./lunedo version`, or pass `--dir`.",
    ...renderWrapper(source.wrapper),
  ].join("\n\n");
}

export const cliReference = defineReference<CliSource>({
  page: "admin/cli.md",
  title: "Command line",
  sources: [COMMANDS, WRAPPER],
  entry: `
import { cliCommands, exitCodes } from "./${COMMANDS}";
import wrapper from "./${WRAPPER}?text";

export default { commands: cliCommands, exitCodes: Object.values(exitCodes), wrapper };
`,
  render: renderCli,
});
