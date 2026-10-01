import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { commitsWithoutSignOff, parseIdent } from "./dco.ts";

const messageFile = process.argv[2];
if (!messageFile) {
  console.error("Usage: node scripts/check-sign-off.ts <commit message file>");
  process.exit(2);
}

const author = parseIdent(execFileSync("git", ["var", "GIT_AUTHOR_IDENT"], { encoding: "utf8" }));
const message = readFileSync(messageFile, "utf8");
if (commitsWithoutSignOff([{ sha: "", ...author, message }]).length > 0) {
  console.error(
    `The commit message has no Signed-off-by line for ${author.authorName} <${author.authorEmail}>.`,
  );
  console.error("Sign off with `git commit -s`. See CONTRIBUTING.md.");
  process.exit(1);
}
