import { execFileSync } from "node:child_process";

// Docker builds and source archives have no Git work tree; there is nothing to install then.
try {
  execFileSync("git", ["rev-parse", "--is-inside-work-tree"], { stdio: "ignore" });
} catch {
  process.exit(0);
}
execFileSync("git", ["config", "core.hooksPath", ".githooks"]);
