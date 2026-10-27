export interface VerifyStep {
  readonly name: string;
  readonly command: string;
  readonly args: readonly string[];
}

export const VERIFIED_JOBS = ["checks", "quick-checks"] as const;

const SETUP_COMMANDS = ["corepack enable", "pnpm install ", "echo ", "node scripts/prepare-ci-cache.ts "];
const SHELL_SYNTAX = /^(if|then|else|elif|fi|for|while|do|done)\b/;

export function verifySteps(base: string): VerifyStep[] {
  return [
    { name: "Lint", command: "pnpm", args: ["lint"] },
    { name: "Private references", command: "pnpm", args: ["references:check"] },
    { name: "Product name", command: "pnpm", args: ["name:check"] },
    { name: "Patched dependencies", command: "pnpm", args: ["patches:check"] },
    { name: "Playwright image", command: "pnpm", args: ["playwright-image:check"] },
    { name: "Translations", command: "pnpm", args: ["i18n:check"] },
    { name: "Documentation", command: "pnpm", args: ["docs:check"] },
    { name: "Shell scripts", command: "pnpm", args: ["shell:check"] },
    { name: "Release jobs", command: "pnpm", args: ["release-jobs:check"] },
    { name: "Container users", command: "pnpm", args: ["container-users:check"] },
    { name: "Typecheck", command: "pnpm", args: ["typecheck"] },
    { name: "Script tests", command: "node", args: ["--test", "scripts/*.test.ts"] },
    { name: "Sign-off", command: "node", args: ["scripts/check-dco.ts", `${base}..HEAD`] },
    {
      name: "API compatibility with the base branch",
      command: "node",
      args: ["scripts/check-api-compatibility.ts", base],
    },
    { name: "Licenses", command: "pnpm", args: ["licenses:check"] },
    { name: "Dependency audit", command: "pnpm", args: ["audit", "--audit-level=high"] },
  ];
}

export function signature(command: string): string {
  return command.trim().split(/\s+/).slice(0, 2).join(" ");
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

function jobLines(workflow: string, job: string): string[] {
  const lines = workflow.split(/\r?\n/);
  const start = lines.indexOf(`  ${job}:`);
  if (start < 0) throw new Error(`The workflow has no job ${job}.`);
  const end = lines.findIndex((line, index) => index > start && /^ {2}\S/.test(line));
  return lines.slice(start + 1, end < 0 ? undefined : end);
}

export function workflowCommands(workflow: string, job: string): string[] {
  const lines = jobLines(workflow, job);
  const commands: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const match = /^(\s*)(?:- )?run:\s*(.*)$/.exec(line);
    if (!match) continue;
    const value = (match[2] ?? "").trim();
    if (value !== "" && !/^[|>][-+]?$/.test(value)) {
      commands.push(value);
      continue;
    }
    const indent = indentOf(line);
    const block: string[] = [];
    while (index + 1 < lines.length) {
      const next = lines[index + 1] ?? "";
      if (next.trim() !== "" && indentOf(next) <= indent) break;
      block.push(next.trim());
      index += 1;
    }
    if (value.startsWith(">")) commands.push(block.filter(Boolean).join(" "));
    else commands.push(...block.filter(Boolean));
  }
  return commands.filter(
    (command) => !SHELL_SYNTAX.test(command) && !SETUP_COMMANDS.some((setup) => command.startsWith(setup)),
  );
}

export function uncoveredCommands(workflow: string, steps: readonly VerifyStep[]): string[] {
  const covered = new Set(steps.map((step) => signature([step.command, ...step.args].join(" "))));
  return VERIFIED_JOBS.flatMap((job) => workflowCommands(workflow, job)).filter(
    (command) => !covered.has(signature(command)),
  );
}
