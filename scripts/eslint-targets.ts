import { readdirSync } from "node:fs";
import path from "node:path";

export const WORKSPACE_GROUPS = ["apps", "packages"] as const;
export const ROOT_TARGETS = ["scripts", "docker", "eslint.config.js"] as const;

export function eslintTargets(root: string, list = listDirectories): string[][] {
  const workspaces = WORKSPACE_GROUPS.flatMap((group) =>
    list(path.join(root, group))
      .sort()
      .map((name) => [`${group}/${name}`]),
  );
  return [...workspaces, [...ROOT_TARGETS]];
}

function listDirectories(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}
