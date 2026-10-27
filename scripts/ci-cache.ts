import { accessSync, constants, mkdirSync, statSync } from "node:fs";
import path from "node:path";

export type CacheOwner = "host" | "e2e";

export interface CacheEntry {
  isDirectory: () => boolean;
  uid: number;
}

export interface CacheFileSystem {
  stat: (target: string) => CacheEntry | undefined;
  writable: (target: string) => boolean;
  mkdir: (target: string) => void;
}

const SETUP_HINT =
  'Set it up once as described in "Caches on self-hosted runners" in docs/development/self-hosted-runners.md, or point the repository variable CI_CACHE_DIR at a prepared directory.';

export const nodeFileSystem: CacheFileSystem = {
  stat: (target) => statSync(target, { throwIfNoEntry: false }),
  writable: (target) => {
    try {
      accessSync(target, constants.W_OK);
      return true;
    } catch {
      return false;
    }
  },
  mkdir: (target) => {
    mkdirSync(target, { recursive: true });
  },
};

export function parseOwner(value: string | undefined): CacheOwner {
  if (value === "host" || value === "e2e") return value;
  throw new Error(`Unknown cache owner "${value ?? ""}". Use host or e2e.`);
}

export function runnerDirectory(runner: string | undefined): string {
  const name = (runner ?? "").trim().replace(/[^A-Za-z0-9._-]+/g, "-");
  if (name === "" || /^\.+$/.test(name)) {
    throw new Error("RUNNER_NAME is not set, so the job cannot choose the Turborepo cache of its runner.");
  }
  return name;
}

export type CacheAccess = "write" | "read";

export function cacheAccess(event: string | undefined, ref: string | undefined): CacheAccess {
  return event === "push" && ref === "refs/heads/main" ? "write" : "read";
}

export function cacheEnvironment(
  root: string,
  owner: CacheOwner,
  runner: string,
  access: CacheAccess,
): Record<string, string> {
  const base = path.posix.join(root, owner);
  const own = access === "write" ? "" : "-pull-requests";
  const env: Record<string, string> = {
    pnpm_config_store_dir: path.posix.join(base, `pnpm-store${own}`),
    TURBO_CACHE_DIR: path.posix.join(base, "turbo", runner),
  };
  if (owner === "e2e") env.pnpm_config_cache_dir = path.posix.join(base, `pnpm-cache${own}`, runner);
  if (access === "read") env.TURBO_CACHE = "local:r";
  return env;
}

export function rootProblem(root: string, owner: CacheOwner, fs: CacheFileSystem): string | undefined {
  const stats = fs.stat(root);
  if (!stats) return `The CI cache directory ${root} does not exist on this runner. ${SETUP_HINT}`;
  if (!stats.isDirectory()) return `The CI cache path ${root} is not a directory. ${SETUP_HINT}`;
  if (owner === "e2e" && stats.uid === 0) {
    return `The CI cache directory mounted at ${root} belongs to root, so Docker most likely created it because it is missing on the runner host. ${SETUP_HINT}`;
  }
  if (!fs.writable(root))
    return `The CI cache directory ${root} is not writable for the runner user. ${SETUP_HINT}`;
  return undefined;
}

export function prepareCache(
  root: string,
  owner: CacheOwner,
  runner: string | undefined,
  access: CacheAccess,
  fs: CacheFileSystem = nodeFileSystem,
): Record<string, string> {
  const problem = rootProblem(root, owner, fs);
  if (problem) throw new Error(problem);
  const env = cacheEnvironment(root, owner, runnerDirectory(runner), access);
  const directories = Object.entries(env).flatMap(([name, value]) => (/_dir$/i.test(name) ? [value] : []));
  for (const directory of directories) {
    try {
      fs.mkdir(directory);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`Could not create ${directory} in the CI cache: ${reason}. ${SETUP_HINT}`);
    }
  }
  return env;
}
