export type Lane = "fast" | "full";

export interface ScopeInput {
  event: string;
  draft: boolean;
  files: readonly string[] | null;
}

export interface Scope {
  lane: Lane;
  endToEnd: boolean;
  sweeps: boolean;
  identityProviders: boolean;
  backup: boolean;
  operations: boolean;
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

export const endToEndPaths = ["apps/web/", "apps/render/", "packages/ui/", "packages/tokens/"];

export const sweepPaths = [
  "apps/web/src/",
  "apps/web/e2e/",
  "apps/web/public/",
  "apps/web/index.html",
  "apps/web/vite.config.ts",
  "apps/web/playwright.config.ts",
  "packages/ui/",
  "packages/tokens/",
];

export const identityProviderPaths = [
  "packages/server/src/identity/",
  "packages/server/src/auth/",
  "packages/server/src/testing/fake-oidc.ts",
  "packages/server/src/testing/fakes/",
  "packages/shared/src/identity-providers.ts",
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
  "docker/compose.ci.yml",
];

export const backupPaths = [
  "packages/server/src/backup/",
  "packages/server/src/files/",
  "packages/server/src/crypto/stream.ts",
  "packages/server/drizzle/",
  "apps/worker/src/cli/",
  "docker/Dockerfile",
  "docker/start.sh",
  "docker/runtime/",
  "scripts/bundle-server.ts",
  "scripts/backup-roundtrip.sh",
];

export const operationsPaths = [
  "docker/Dockerfile",
  "docker/start.sh",
  "docker/runtime/",
  "scripts/bundle-server.ts",
  "docker/compose.yml",
  "scripts/install.sh",
  "scripts/install-update-check.sh",
  "scripts/reverse-proxy-check.sh",
  "scripts/backup-network-check.sh",
  "docs/reverse-proxy.md",
  "docs/backup.md",
  "packages/server/src/operations/",
  "packages/server/src/portal/",
  "packages/server/src/config/",
  "packages/server/drizzle/",
  "apps/api/src/health/",
  "apps/api/src/portal/",
  "apps/api/src/http/",
  "apps/api/src/main.ts",
  "apps/collab/",
  "apps/worker/src/cli/",
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
  if (lane === "fast")
    return {
      lane,
      endToEnd: false,
      sweeps: false,
      identityProviders: false,
      backup: false,
      operations: false,
    };
  const files = input.files;
  if (!pullRequest || files === null || touches(files, everythingPaths)) {
    return { lane, endToEnd: true, sweeps: true, identityProviders: true, backup: true, operations: true };
  }
  const endToEnd = touches(files, endToEndPaths);
  return {
    lane,
    endToEnd,
    sweeps: endToEnd && touches(files, sweepPaths),
    identityProviders: touches(files, identityProviderPaths),
    backup: touches(files, backupPaths),
    operations: touches(files, operationsPaths),
  };
}
