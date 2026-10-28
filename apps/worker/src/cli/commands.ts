export interface CliOption {
  readonly flag: string;
  readonly description: string;
}

export interface CliCommand {
  readonly synopsis: string;
  readonly description: string;
  readonly options: readonly CliOption[];
}

const input = (what: string): CliOption => ({
  flag: "--input <file>",
  description: `The backup file to ${what}.`,
});

export const cliCommands: readonly CliCommand[] = [
  {
    synopsis: "backup create --output <file>",
    description:
      "Writes a backup with everything to a file and prints the file and the number of entries. The directory must be writable by the container user; /var/lib/lunedo/backups is. When another backup is running, the command waits for it.",
    options: [{ flag: "--output <file>", description: "The file to write the backup to." }],
  },
  {
    synopsis: "backup create --before-update",
    description:
      'Writes a backup of the class "before update" to the backup target, or to LUNEDO_BACKUP_DIR while no target is set up, and prints only its location: a path, or s3://<bucket>/<key>.',
    options: [{ flag: "--before-update", description: "Writes to the backup target instead of a file." }],
  },
  {
    synopsis: "backup skip-before-update [--for-version <version>]",
    description:
      "Lets the next start of that version apply pending migrations without the backup before the update, once. Any other start removes this request.",
    options: [
      {
        flag: "--for-version <version>",
        description:
          "The version whose next start skips the backup, like 1.4.2. Without it, the configured version.",
      },
    ],
  },
  {
    synopsis: "backup verify --input <file>",
    description:
      "Checks the header, decrypts the whole backup and checks the manifest and every checksum without restoring anything. Needs the backup key only.",
    options: [input("check")],
  },
  {
    synopsis: "backup restore --input <file> [--force] [--config-dir <dir>]",
    description:
      "Restores a backup into an empty instance after verifying it. Start Lunedo afterwards to apply pending migrations.",
    options: [
      input("restore"),
      { flag: "--force", description: "Replaces all database schemas and the content of the file store." },
      {
        flag: "--config-dir <dir>",
        description:
          "Writes the configuration files from the backup to this directory for review. They are never applied.",
      },
    ],
  },
  {
    synopsis: "keys rotate",
    description: "Starts a rotation to the newest master key. The worker re-wraps all data keys.",
    options: [],
  },
  {
    synopsis: "keys status",
    description: "Shows the current master key version, the available versions and the latest key rotation.",
    options: [],
  },
  {
    synopsis: "audit verify",
    description:
      "Checks the hash chain of the audit log of the instance and of every organization and prints one line per scope.",
    options: [],
  },
  {
    synopsis: "search rebuild",
    description:
      "Queues every page, blog post and running topic for a new search index. Search keeps answering meanwhile.",
    options: [],
  },
  {
    synopsis: "search status",
    description: "Shows the progress of a rebuild and how many pages wait for an update.",
    options: [],
  },
  {
    synopsis: "maintenance on [--message <text>] [--block-sign-in]",
    description:
      "Switches maintenance mode on: changes are refused for everyone, reading and search keep working.",
    options: [
      { flag: "--message <text>", description: "The message shown in the banner on every page." },
      { flag: "--block-sign-in", description: "Lets only instance administrators sign in while it is on." },
    ],
  },
  { synopsis: "maintenance off", description: "Switches maintenance mode off.", options: [] },
  {
    synopsis: "maintenance status",
    description:
      "Shows whether maintenance mode is on, since when, whether signing in is paused and the message.",
    options: [],
  },
  { synopsis: "version", description: "Prints the version of the image.", options: [] },
  {
    synopsis: "release-notes [--since <version>] [--update-from <version>] [--json]",
    description: "Prints the changes of the releases in the image.",
    options: [
      { flag: "--since <version>", description: "Prints only the releases after this version." },
      {
        flag: "--update-from <version>",
        description:
          "Fails when the installed version cannot update to this one directly, and otherwise prints the releases after it.",
      },
      { flag: "--json", description: "Prints the version file of the releases as JSON instead." },
    ],
  },
  { synopsis: "help", description: "Shows this usage.", options: [] },
];

export const exitCodes = {
  success: { code: 0, description: "Success." },
  failure: {
    code: 1,
    description:
      "The command failed; the message on standard error says why. audit verify also ends with 1 when an entry was changed, removed or inserted.",
  },
  usage: { code: 64, description: "Unknown command or option; the usage follows." },
  updateStep: {
    code: 65,
    description: "release-notes --update-from: the update cannot be made in one step.",
  },
  configuration: { code: 78, description: "The configuration is not valid; the message names the setting." },
} as const;

export function usageText(): string {
  const commands = cliCommands.flatMap((command) => [
    `  lunedo ${command.synopsis}`,
    `      ${command.description}`,
  ]);
  const codes = Object.values(exitCodes).map((exit) => `  ${String(exit.code).padEnd(4)}${exit.description}`);
  return ["Usage:", ...commands, "", "Exit codes:", ...codes, ""].join("\n");
}
