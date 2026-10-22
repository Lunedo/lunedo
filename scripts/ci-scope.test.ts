import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { scopeOf } from "./ci-scope.ts";

const none = { endToEnd: false, sweeps: false, identityProviders: false, backup: false, operations: false };
const all = { endToEnd: true, sweeps: true, identityProviders: true, backup: true, operations: true };

function ready(files: string[] | null) {
  return scopeOf({ event: "pull_request", draft: false, files });
}

describe("scopeOf", () => {
  it("runs only the fast lane for draft pull requests, whatever changed", () => {
    assert.deepEqual(scopeOf({ event: "pull_request", draft: true, files: [".github/workflows/ci.yml"] }), {
      lane: "fast",
      ...none,
    });
  });

  it("runs everything on pushes to main and manual runs", () => {
    assert.deepEqual(scopeOf({ event: "push", draft: false, files: ["README.md"] }), {
      lane: "full",
      ...all,
    });
    assert.deepEqual(scopeOf({ event: "workflow_dispatch", draft: false, files: null }), {
      lane: "full",
      ...all,
    });
  });

  it("runs everything when workflows or shared dependencies change", () => {
    for (const file of [".github/workflows/image.yml", "pnpm-lock.yaml", "package.json", "turbo.json"]) {
      assert.deepEqual(ready([file]), { lane: "full", ...all }, file);
    }
  });

  it("runs everything when the changed files are unknown", () => {
    assert.deepEqual(ready(null), { lane: "full", ...all });
  });

  it("runs no expensive job for changes outside their areas", () => {
    assert.deepEqual(ready(["packages/shared/src/settings.ts", "docs/api.md"]), { lane: "full", ...none });
  });

  it("runs the browser tests for the web client, ui and tokens", () => {
    for (const file of [
      "apps/web/src/app.tsx",
      "packages/ui/src/button.tsx",
      "packages/tokens/src/index.ts",
    ]) {
      assert.deepEqual(ready([file]), { lane: "full", ...none, endToEnd: true, sweeps: true }, file);
    }
  });

  it("runs the identity provider tests for identity, authentication, sign-in and their setup", () => {
    for (const file of [
      "packages/server/src/identity/oidc.ts",
      "packages/server/src/identity/saml.ts",
      "packages/server/src/identity/ldap.ts",
      "packages/server/src/testing/fakes/ldap-directory.ts",
      "packages/shared/src/identity-providers.ts",
      "docker/idp/openldap/seed.ldif",
      "packages/server/src/auth/sign-in.ts",
      "apps/api/src/auth/auth.controller.ts",
      "docker/idp/keycloak/pagehall-realm.json",
    ]) {
      assert.equal(ready([file]).identityProviders, true, file);
    }
    assert.deepEqual(ready(["apps/web/e2e/idp/sign-in.spec.ts"]), {
      lane: "full",
      ...none,
      endToEnd: true,
      sweeps: true,
      identityProviders: true,
    });
  });

  it("runs the sweeps for the web client, ui, tokens and the end-to-end tests, not for other web files", () => {
    for (const file of [
      "apps/web/src/screens/home.tsx",
      "apps/web/e2e/flows/shell.spec.ts",
      "apps/web/e2e/sweeps/settings.spec.ts",
      "apps/web/playwright.config.ts",
      "apps/web/index.html",
      "packages/ui/src/button.tsx",
      "packages/tokens/src/index.ts",
    ]) {
      assert.equal(ready([file]).sweeps, true, file);
    }
    for (const file of [
      "apps/web/package.json",
      "apps/web/vitest.config.ts",
      "apps/web/tsconfig.json",
      "apps/render/src/chromium.ts",
    ]) {
      assert.deepEqual(ready([file]), { lane: "full", ...none, endToEnd: true }, file);
    }
  });

  it("runs the backup round trip for backup, the file storage, migrations and the Docker setup", () => {
    for (const file of [
      "packages/server/src/backup/restore.ts",
      "packages/server/src/files/store.ts",
      "packages/server/src/files/attachments.ts",
      "packages/server/src/crypto/stream.ts",
      "packages/server/drizzle/0015_identity_providers.sql",
      "docker/Dockerfile",
      "docker/start.sh",
      "scripts/backup-roundtrip.sh",
    ]) {
      assert.equal(ready([file]).backup, true, file);
    }
    for (const file of [
      "docker/compose.dev.yml",
      "docker/idp/keycloak/pagehall-realm.json",
      "docker/dev-healthcheck.ts",
    ]) {
      assert.equal(ready([file]).backup, false, file);
    }
    assert.equal(ready(["packages/server/src/backupish.ts"]).backup, false);
    assert.equal(ready(["packages/server/src/filesystem.ts"]).backup, false);
  });

  it("runs the installation, update and reverse proxy checks for the image and the operations code", () => {
    for (const file of [
      "docker/Dockerfile",
      "docker/compose.yml",
      "scripts/install.sh",
      "scripts/reverse-proxy-check.sh",
      "docs/reverse-proxy.md",
      "scripts/backup-network-check.sh",
      "docs/backup.md",
      "packages/server/src/operations/status.ts",
      "packages/server/src/portal/portals.ts",
      "packages/server/drizzle/0094_operations.sql",
      "apps/api/src/health/tls-ask.controller.ts",
      "apps/collab/src/server.ts",
    ]) {
      assert.equal(ready([file]).operations, true, file);
    }
    for (const file of ["docs/setup.md", "apps/web/src/app.tsx", "docker/compose.dev.yml"]) {
      assert.equal(ready([file]).operations, false, file);
    }
  });

  it("runs the identity provider job, not the backup job, for the compose file", () => {
    assert.deepEqual(ready(["docker/compose.ci.yml"]), { lane: "full", ...none, identityProviders: true });
    assert.deepEqual(ready(["docker/compose.dev.yml"]), { lane: "full", ...none, identityProviders: true });
  });

  it("runs every job for scheduled runs", () => {
    assert.deepEqual(scopeOf({ event: "schedule", draft: false, files: null }), { lane: "full", ...all });
  });

  it("does not take a nested package.json for a shared dependency", () => {
    assert.deepEqual(ready(["apps/worker/package.json"]), { lane: "full", ...none });
  });
});
