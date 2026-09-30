export interface Commit {
  sha: string;
  authorName: string;
  authorEmail: string;
  message: string;
}

/** Returns the commits without a `Signed-off-by` line for their author. */
export function commitsWithoutSignOff(commits: readonly Commit[]): Commit[] {
  return commits.filter((commit) => {
    const signOffs = [...commit.message.matchAll(/^Signed-off-by:\s*(.+?)\s*<([^>]+)>\s*$/gim)];
    return !signOffs.some(([, , email]) => email?.toLowerCase() === commit.authorEmail.toLowerCase());
  });
}

const FIELD = "\x1f";
const RECORD = "\x1e";

export const gitLogFormat = `${["%H", "%an", "%ae", "%B"].join("%x1f")}%x1e`;

export function parseGitLog(output: string): Commit[] {
  return output
    .split(RECORD)
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [sha = "", authorName = "", authorEmail = "", message = ""] = record.split(FIELD);
      return { sha, authorName, authorEmail, message };
    });
}
