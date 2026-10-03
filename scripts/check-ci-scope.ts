import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { scopeOf } from "./ci-scope.ts";

interface PullRequestEvent {
  pull_request?: { draft?: boolean; base: { sha: string }; head: { sha: string } };
}

const eventName = process.env.GITHUB_EVENT_NAME ?? "";
const eventPath = process.env.GITHUB_EVENT_PATH;
const payload: PullRequestEvent = eventPath ? JSON.parse(readFileSync(eventPath, "utf8")) : {};
const pullRequest = payload.pull_request;

function changedFiles(): string[] | null {
  if (!pullRequest) return null;
  try {
    const output = execFileSync(
      "git",
      ["diff", "--name-only", `${pullRequest.base.sha}...${pullRequest.head.sha}`],
      { encoding: "utf8" },
    );
    return output.split("\n").filter((line) => line.length > 0);
  } catch (error) {
    console.error(`Could not list the changed files, running everything: ${String(error)}`);
    return null;
  }
}

const files = changedFiles();
const scope = scopeOf({ event: eventName, draft: pullRequest?.draft ?? false, files });
const outputs = {
  ...scope,
  base: pullRequest?.base.sha ?? "",
  head: pullRequest?.head.sha ?? process.env.GITHUB_SHA ?? "",
};

const lines = Object.entries(outputs).map(([key, value]) => `${key}=${value}`);
console.log(lines.join("\n"));
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join("\n")}\n`);
if (process.env.GITHUB_STEP_SUMMARY) {
  const summary = [
    `## ${scope.lane === "fast" ? "Fast lane" : "Full lane"}`,
    "",
    `- Changed files: ${files === null ? "unknown, running everything" : files.length}`,
    `- End-to-end, accessibility and visual tests: ${scope.endToEnd ? "run" : "skipped"}`,
    `- Sign-in through identity providers: ${scope.identityProviders ? "run" : "skipped"}`,
    `- Backup round trip: ${scope.backup ? "run" : "skipped"}`,
  ];
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary.join("\n")}\n`);
}
