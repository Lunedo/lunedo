import { parseArgs } from "node:util";
import type { MaintenanceCommand } from "./maintenance.js";
import type { ReleaseNotesCommand } from "./release-notes.js";

export type Command =
  | { name: "backup create"; output: string }
  | { name: "backup verify"; input: string }
  | { name: "backup restore"; input: string; force: boolean; configDir: string | undefined }
  | { name: "keys rotate" }
  | { name: "keys status" }
  | { name: "audit verify" }
  | { name: "search rebuild" }
  | { name: "search status" }
  | { name: "maintenance"; command: MaintenanceCommand }
  | { name: "version" }
  | { name: "release-notes"; command: ReleaseNotesCommand }
  | { name: "help" };

export class UsageError extends Error {
  override name = "UsageError";
}

export const usage = `Usage:
  pagehall backup create --output <file>
  pagehall backup verify --input <file>
  pagehall backup restore --input <file> [--force] [--config-dir <dir>]
  pagehall keys rotate
  pagehall keys status
  pagehall audit verify
  pagehall search rebuild
  pagehall search status
  pagehall maintenance on [--message <text>] [--block-sign-in]
  pagehall maintenance off
  pagehall maintenance status
  pagehall version
  pagehall release-notes [--since <version>] [--json]
`;

export function parseCommand(argv: readonly string[]): Command {
  const [group, action, ...rest] = argv;
  if (group === undefined || group === "help" || group === "--help") return { name: "help" };
  if (group === "version" && action === undefined) return { name: "version" };
  if (group === "release-notes") {
    const { values } = parseArgs({
      args: argv.slice(1),
      options: { since: { type: "string" }, json: { type: "boolean", default: false } },
      strict: true,
      allowPositionals: false,
    });
    return { name: "release-notes", command: { since: values.since ?? null, json: values.json ?? false } };
  }
  const { values } = parseArgs({
    args: rest,
    options: {
      output: { type: "string" },
      input: { type: "string" },
      force: { type: "boolean", default: false },
      "config-dir": { type: "string" },
      message: { type: "string" },
      "block-sign-in": { type: "boolean", default: false },
    },
    strict: true,
    allowPositionals: false,
  });
  const require = (option: "output" | "input") => {
    const value = values[option];
    if (!value) throw new UsageError(`--${option} is required`);
    return value;
  };

  switch (`${group} ${action}`) {
    case "backup create":
      return { name: "backup create", output: require("output") };
    case "backup verify":
      return { name: "backup verify", input: require("input") };
    case "backup restore":
      return {
        name: "backup restore",
        input: require("input"),
        force: values.force ?? false,
        configDir: values["config-dir"],
      };
    case "keys rotate":
      return { name: "keys rotate" };
    case "keys status":
      return { name: "keys status" };
    case "audit verify":
      return { name: "audit verify" };
    case "search rebuild":
      return { name: "search rebuild" };
    case "search status":
      return { name: "search status" };
    case "maintenance on":
      return {
        name: "maintenance",
        command: {
          action: "on",
          message: values.message ?? "",
          blockSignIn: values["block-sign-in"] ?? false,
        },
      };
    case "maintenance off":
      return { name: "maintenance", command: { action: "off" } };
    case "maintenance status":
      return { name: "maintenance", command: { action: "status" } };
    default:
      throw new UsageError(`Unknown command: ${[group, action].filter(Boolean).join(" ")}`);
  }
}
