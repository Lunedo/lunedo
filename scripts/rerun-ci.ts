import { contextFromEnvironment, type GithubContext, githubRequest } from "./github-api.ts";

interface WorkflowRun {
  readonly id: number;
  readonly status: string;
}

const POLL_MILLISECONDS = 5000;
const POLL_LIMIT = 120;

export async function rerunCi(
  context: GithubContext,
  headSha: string,
  wait: (milliseconds: number) => Promise<void> = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
): Promise<number> {
  const runs = (await githubRequest(
    context,
    "GET",
    `/actions/workflows/ci.yml/runs?head_sha=${headSha}&event=pull_request&per_page=1`,
  )) as { workflow_runs: WorkflowRun[] };
  const run = runs.workflow_runs[0];
  if (!run) {
    throw new Error(
      `There is no CI run for commit ${headSha}. Push a commit or reopen the pull request to start one.`,
    );
  }
  if (run.status !== "completed") {
    await githubRequest(context, "POST", `/actions/runs/${run.id}/cancel`);
    for (let attempt = 0; attempt < POLL_LIMIT; attempt += 1) {
      const current = (await githubRequest(context, "GET", `/actions/runs/${run.id}`)) as WorkflowRun;
      if (current.status === "completed") break;
      if (attempt === POLL_LIMIT - 1) {
        throw new Error(
          `CI run ${run.id} did not stop after cancelling. Cancel it by hand and add the label again.`,
        );
      }
      await wait(POLL_MILLISECONDS);
    }
  }
  await githubRequest(context, "POST", `/actions/runs/${run.id}/rerun`);
  return run.id;
}

if (import.meta.main) {
  const headSha = process.argv[2];
  if (!headSha) {
    console.error("Usage: node scripts/rerun-ci.ts <head sha>");
    process.exit(2);
  }
  try {
    const id = await rerunCi(contextFromEnvironment(process.env), headSha);
    console.log(`Started CI run ${id} again.`);
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
}
