import { parseArgs } from "node:util";

export type Command =
  | { name: "backup create"; output: string }
  | { name: "backup create before update" }
  | { name: "backup skip-before-update" }
  | { name: "backup verify"; input: string }
  | { name: "backup restore"; input: string; force: boolean; configDir: string | undefined }
  | { name: "keys rotate" }
  | { name: "keys status" }
  | { name: "audit verify" }
  | { name: "search rebuild" }
  | { name: "search status" }
  | { name: "help" };

export class UsageError extends Error {
  override name = "UsageError";
}

export const usage = `Usage:
  pagehall backup create --output <file>
  pagehall backup create --before-update
  pagehall backup skip-before-update
  pagehall backup verify --input <file>
  pagehall backup restore --input <file> [--force] [--config-dir <dir>]
  pagehall keys rotate
  pagehall keys status
  pagehall audit verify
  pagehall search rebuild
  pagehall search status
`;

export function parseCommand(argv: readonly string[]): Command {
  const [group, action, ...rest] = argv;
  if (group === undefined || group === "help" || group === "--help") return { name: "help" };
  const { values } = parseArgs({
    args: rest,
    options: {
      output: { type: "string" },
      input: { type: "string" },
      force: { type: "boolean", default: false },
      "config-dir": { type: "string" },
      "before-update": { type: "boolean", default: false },
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
      if (values["before-update"]) {
        if (values.output)
          throw new UsageError("--before-update writes to the backup target; leave out --output");
        return { name: "backup create before update" };
      }
      return { name: "backup create", output: require("output") };
    case "backup skip-before-update":
      return { name: "backup skip-before-update" };
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
    default:
      throw new UsageError(`Unknown command: ${[group, action].filter(Boolean).join(" ")}`);
  }
}
