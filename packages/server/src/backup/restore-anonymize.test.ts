import { spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { accountPrincipal, SYSTEM } from "../accounts/principal.js";
import { formatKeyEntry, keyFingerprint, parseKeyRing } from "../crypto/key-ring.js";
import { currentSchemaVersion } from "../database/migrate.js";
import { createLogger } from "../logging/logger.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { createBackup, restoreBackup } from "./archive.js";
import { PostgresArchiver } from "./postgres.js";

const baseUrl = testDatabaseBaseUrl();
const logger = createLogger({ service: "test", level: "silent" });
const hasTools = spawnSync("pg_dump", ["--version"]).status === 0;

describe.skipIf(!baseUrl || !hasTools)("anonymizing after a restore", () => {
  const opened: TestServices[] = [];
  const dirs: string[] = [];

  afterAll(async () => {
    for (const services of opened) await services.close();
    for (const dir of dirs) await rm(dir, { recursive: true, force: true });
  });

  it("finds an old invitation through the restored address key", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "lunedo-restore-anonymize-"));
    dirs.push(dir);
    const masterKey = randomBytes(32);
    const masterKeys = parseKeyRing(formatKeyEntry(1, masterKey));
    const backupKeys = parseKeyRing(formatKeyEntry(1, randomBytes(32)));
    const source = await createTestServices(baseUrl ?? "", { masterKey });
    opened.push(source);
    const email = `invited.${randomUUID().slice(0, 8)}@example.org`;
    const owner = await source.database.transaction((tx) =>
      source.services.accounts.createStandard(tx, {
        email: `${randomUUID()}@example.org`,
        name: "Owner",
        password: "a long test passphrase",
        homeOrganizationId: null,
      }),
    );
    const organization = await source.services.organizations.createAsActor(SYSTEM, {
      name: `Organization ${randomUUID().slice(0, 8)}`,
      ownerAccountId: owner.id,
    });
    const invitation = await source.services.invitations.create(SYSTEM, organization.id, {
      email,
      kind: "member",
    });
    await source.pool.query("update invitations set expires_at = now() - interval '31 days' where id = $1", [
      invitation.id,
    ]);
    await source.services.invitations.cleanup();
    const tagged = await source.pool.query<{ subject_id: string }>(
      "select subject_id from audit_subject_keys where address_digest is not null",
    );
    expect(tagged.rowCount).toBeGreaterThan(0);

    const output = path.join(dir, "backup.ldbak");
    await createBackup({
      output,
      stagingDir: path.join(path.dirname(output), "work"),
      backupKeys,
      masterKeys: [{ version: 1, fingerprint: keyFingerprint("master", masterKeys.get(1)) }],
      database: new PostgresArchiver({ databaseUrl: source.url }),
      filesDir: path.join(dir, "files"),
      config: {},
      lunedoVersion: "test",
      schemaVersion: currentSchemaVersion(),
      logger,
    });

    const target = await createTestServices(baseUrl ?? "", {
      masterKey,
      beforeMigrations: (url) =>
        restoreBackup({
          input: output,
          backupKeys,
          masterKeys,
          database: new PostgresArchiver({ databaseUrl: url }),
          filesDir: path.join(dir, "restored-files"),
          force: false,
          knownSchemaVersions: [currentSchemaVersion()],
          logger,
        }),
    });
    opened.push(target);
    const person = await target.database.transaction((tx) =>
      target.services.accounts.createStandard(tx, {
        email,
        name: "Invited Person",
        password: "a long test passphrase",
        homeOrganizationId: null,
      }),
    );
    await target.services.roles.assign(SYSTEM, {
      scope: "instance",
      organizationId: null,
      role: { builtIn: "administrator" },
      principal: { kind: "account", id: owner.id },
    });
    await target.services.accountLifecycle.anonymize(accountPrincipal(owner.id), person.id, {
      reason: "Erasure request",
      confirmation: "Invited Person",
    });
    const left = await target.pool.query(
      "select 1 from audit_subject_keys where subject_id = any($1::uuid[])",
      [tagged.rows.map((row) => row.subject_id)],
    );
    expect(left.rowCount).toBe(0);
  });
});
