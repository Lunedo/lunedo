import { workflowJobs } from "./release-jobs.ts";

const SHARED_MOUNT = /(?:--volume[ =]|-v )"?\$\{?\{?\s*(?:GITHUB_WORKSPACE|CI_CACHE_DIR|vars\.CI_CACHE_DIR)/;
const RUNNER_USER = /--user[ =]/;

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

function containerOptions(workflow: string): Map<string, string> {
  const lines = workflow.split(/\r?\n/);
  const options = new Map<string, string>();
  let job = "";
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const header = /^ {2}([\w-]+):\s*$/.exec(line);
    if (header?.[1]) job = header[1];
    if (!/^ {4}container:\s*$/.test(line)) continue;
    const block: string[] = [];
    for (const next of lines.slice(index + 1)) {
      if (next.trim() !== "" && indentOf(next) <= 4) break;
      block.push(next);
    }
    options.set(job, block.join("\n"));
  }
  return options;
}

export function containerUserProblems(workflows: Readonly<Record<string, string>>): string[] {
  const problems: string[] = [];
  for (const [file, workflow] of Object.entries(workflows)) {
    for (const [job, block] of containerOptions(workflow)) {
      if (!RUNNER_USER.test(block)) {
        problems.push(
          `${file}, job ${job} runs its steps in a container without --user. The container writes into the workspace, so run it with the runner's UID and GID.`,
        );
      }
    }
    for (const job of workflowJobs(workflow)) {
      for (const command of job.commands) {
        if (!/\bdocker run\b/.test(command) || !SHARED_MOUNT.test(command)) continue;
        if (!RUNNER_USER.test(command)) {
          problems.push(
            `${file}, job ${job.id} mounts the workspace or the CI cache into "docker run" without --user. Files written there would belong to another user; add --user "$(id -u):$(id -g)".`,
          );
        }
      }
    }
  }
  return problems;
}
