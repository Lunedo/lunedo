export interface WorkflowJob {
  readonly id: string;
  readonly runsOn: string;
  readonly permissions: ReadonlyMap<string, string>;
  readonly commands: readonly string[];
}

const HOSTED_RUNNER = /^(ubuntu|windows|macos)-[\w.-]+$/;
const WRITE_SCOPES = ["contents", "packages"] as const;

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

function permissionsOf(lines: readonly string[], indent: number): Map<string, string> | null {
  const index = lines.findIndex((line) => indentOf(line) === indent && /^\s*permissions:/.test(line));
  if (index < 0) return null;
  const inline = /^\s*permissions:\s*(\S.*)?$/.exec(lines[index] ?? "")?.[1]?.trim();
  if (inline) return new Map([["*", inline]]);
  const permissions = new Map<string, string>();
  for (const line of lines.slice(index + 1)) {
    if (line.trim() === "") continue;
    if (indentOf(line) <= indent) break;
    const entry = /^\s*([\w-]+):\s*(\S+)/.exec(line);
    if (entry?.[1] && entry[2]) permissions.set(entry[1], entry[2]);
  }
  return permissions;
}

function commandsOf(lines: readonly string[]): string[] {
  const commands: string[] = [];
  let current: string[] = [];
  let blockIndent = -1;
  const flush = () => {
    if (current.length > 0) commands.push(current.join("\n"));
    current = [];
    blockIndent = -1;
  };
  for (const line of lines) {
    if (blockIndent >= 0) {
      if (line.trim() === "" || indentOf(line) > blockIndent) {
        current.push(line.trim());
        continue;
      }
      flush();
    }
    const run = /^(\s*)(?:- )?run:\s*(.*)$/.exec(line);
    if (!run) continue;
    const value = (run[2] ?? "").trim();
    if (value !== "" && !/^[|>][-+]?$/.test(value)) commands.push(value);
    else blockIndent = indentOf(line);
  }
  flush();
  return commands;
}

export function workflowJobs(workflow: string): WorkflowJob[] {
  const lines = workflow.split(/\r?\n/);
  const workflowPermissions = permissionsOf(lines, 0) ?? new Map<string, string>();
  const start = lines.indexOf("jobs:");
  if (start < 0) return [];
  const jobs: WorkflowJob[] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const header = /^ {2}([\w-]+):\s*$/.exec(lines[index] ?? "");
    if (!header?.[1]) continue;
    const end = lines.findIndex((line, next) => next > index && /^ {0,2}\S/.test(line));
    const body = lines.slice(index + 1, end < 0 ? undefined : end);
    const runsOn = body.find((line) => /^ {4}runs-on:/.test(line))?.replace(/^ {4}runs-on:\s*/, "") ?? "";
    jobs.push({
      id: header[1],
      runsOn: runsOn.trim(),
      permissions: permissionsOf(body, 4) ?? workflowPermissions,
      commands: commandsOf(body),
    });
  }
  return jobs;
}

function writes(job: WorkflowJob): string[] {
  const all = job.permissions.get("*");
  if (all === "write-all") return [...WRITE_SCOPES];
  return WRITE_SCOPES.filter((scope) => job.permissions.get(scope) === "write");
}

export function releaseJobProblems(workflows: Readonly<Record<string, string>>): string[] {
  const problems: string[] = [];
  for (const [file, workflow] of Object.entries(workflows)) {
    for (const job of workflowJobs(workflow)) {
      const scopes = writes(job);
      if (scopes.length === 0) continue;
      const where = `${file}, job ${job.id}`;
      if (!HOSTED_RUNNER.test(job.runsOn)) {
        problems.push(
          `${where} has ${scopes.map((scope) => `${scope}: write`).join(" and ")} but runs on "${job.runsOn}". Jobs that may write packages or the repository run only on a fixed GitHub-hosted runner, never on vars.RUNNER_LABELS or a self-hosted label.`,
        );
      }
      for (const command of job.commands) {
        for (const line of command.split("\n")) {
          if (!/\bdocker run\b/.test(line)) continue;
          if (!/@\$?\{?\w*DIGEST\}?|@sha256:/.test(line) || !/--pull[ =]always/.test(line)) {
            problems.push(
              `${where} runs an image without its digest and --pull always: "${line.trim()}". Run the image by the digest the publish job reported, so that no local image of that tag is used.`,
            );
          }
        }
      }
    }
  }
  return problems;
}
