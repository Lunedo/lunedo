export type Lane = "fast" | "full";

export interface ScopeInput {
  event: string;
  draft: boolean;
  files: readonly string[] | null;
}

export interface Scope {
  lane: Lane;
  endToEnd: boolean;
  identityProviders: boolean;
  backup: boolean;
}

export const everythingPaths = [
  ".github/workflows/",
  ".github/actions/",
  ".nvmrc",
  ".npmrc",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "turbo.json",
  "packages/config/",
];

export const endToEndPaths = ["apps/web/", "packages/ui/", "packages/tokens/"];

export const identityProviderPaths = [
  "packages/server/src/identity/",
  "packages/server/src/auth/",
  "packages/server/src/testing/fake-oidc.ts",
  "packages/server/src/testing/fakes/",
  "apps/api/src/identity/",
  "apps/api/src/auth/",
  "apps/web/src/screens/auth/",
  "apps/web/src/screens/identity/",
  "apps/web/src/session/",
  "apps/web/e2e/idp/",
  "apps/web/e2e/support/",
  "apps/web/e2e/global-setup.ts",
  "apps/web/playwright.config.ts",
  "docker/idp/",
  "docker/compose.dev.yml",
];

export const backupPaths = [
  "packages/server/src/backup/",
  "packages/server/drizzle/",
  "apps/worker/src/cli/",
  "docker/",
  "scripts/backup-roundtrip.sh",
];

export function matches(file: string, paths: readonly string[]): boolean {
  return paths.some((path) => (path.endsWith("/") ? file.startsWith(path) : file === path));
}

function touches(files: readonly string[], paths: readonly string[]): boolean {
  return files.some((file) => matches(file, paths));
}

export function scopeOf(input: ScopeInput): Scope {
  const pullRequest = input.event === "pull_request";
  const lane: Lane = pullRequest && input.draft ? "fast" : "full";
  if (lane === "fast") return { lane, endToEnd: false, identityProviders: false, backup: false };
  const files = input.files;
  if (!pullRequest || files === null || touches(files, everythingPaths)) {
    return { lane, endToEnd: true, identityProviders: true, backup: true };
  }
  return {
    lane,
    endToEnd: touches(files, endToEndPaths),
    identityProviders: touches(files, identityProviderPaths),
    backup: touches(files, backupPaths),
  };
}
