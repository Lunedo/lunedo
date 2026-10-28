import { randomUUID } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createLogger } from "../logging/logger.js";
import { createTemporaryDatabase, type TemporaryDatabase, testDatabaseBaseUrl } from "../testing/database.js";
import { runMigrations } from "./migrate.js";
import { createDatabasePool, type DatabasePool } from "./pool.js";

const baseUrl = testDatabaseBaseUrl();
const migrations = fileURLToPath(new URL("../../drizzle", import.meta.url));
const logger = createLogger({ service: "test", level: "silent" });

function foldersBefore(tag: string): string {
  const folder = mkdtempSync(path.join(tmpdir(), "lunedo-migrations-"));
  cpSync(migrations, folder, { recursive: true });
  const journalFile = path.join(folder, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalFile, "utf8")) as { entries: { tag: string }[] };
  const index = journal.entries.findIndex((entry) => entry.tag === tag);
  if (index < 0) throw new Error(`Unknown migration ${tag}`);
  journal.entries = journal.entries.slice(0, index);
  writeFileSync(journalFile, JSON.stringify(journal));
  return folder;
}

describe.skipIf(!baseUrl)("private space grants migration", () => {
  let database: TemporaryDatabase | undefined;
  let pool: DatabasePool | undefined;
  let folder: string | undefined;

  afterEach(async () => {
    await pool?.end();
    await database?.drop();
    if (folder) rmSync(folder, { recursive: true, force: true });
  });

  async function space(target: DatabasePool, organizationId: string, visibility: string, name: string) {
    const id = randomUUID();
    await target.query(
      "insert into spaces (id, organization_id, key, name, visibility) values ($1, $2, $3, $4, $5)",
      [id, organizationId, `K${randomUUID().slice(0, 6).toUpperCase()}`, name, visibility],
    );
    return id;
  }

  async function grant(
    target: DatabasePool,
    spaceId: string,
    kind: string,
    role: string,
    principalId?: string,
  ) {
    await target.query(
      "insert into space_permissions (id, space_id, principal_kind, principal_id, role) values ($1, $2, $3, $4, $5)",
      [randomUUID(), spaceId, kind, principalId ?? null, role],
    );
  }

  it("removes roles for everyone from private spaces only and keeps them for the audit", async () => {
    database = await createTemporaryDatabase(baseUrl as string);
    pool = createDatabasePool({ connectionString: database.url, applicationName: "lunedo-test", max: 4 });
    folder = foldersBefore("0109_private_space_grants");
    await runMigrations(pool, { logger, folder });

    const organizationId = randomUUID();
    await pool.query("insert into organizations (id, name, slug) values ($1, 'Org', $2)", [
      organizationId,
      `org-${randomUUID().slice(0, 8)}`,
    ]);
    const person = randomUUID();
    await pool.query(
      "insert into accounts (id, type, state, email, name) values ($1, 'standard', 'active', $2, 'P')",
      [person, `${person}@example.org`],
    );
    const closed = await space(pool, organizationId, "private", "Closed");
    await grant(pool, closed, "organizationMembers", "editor");
    await grant(pool, closed, "instanceUsers", "reader");
    await grant(pool, closed, "account", "admin", person);
    const open = await space(pool, organizationId, "organization", "Open");
    await grant(pool, open, "organizationMembers", "editor");
    const untouched = await space(pool, organizationId, "private", "Untouched");
    await grant(pool, untouched, "account", "admin", person);

    await runMigrations(pool, { logger });

    const remaining = await pool.query<{ space_id: string; principal_kind: string }>(
      "select space_id, principal_kind::text from space_permissions order by space_id, principal_kind",
    );
    expect(remaining.rows).toEqual(
      expect.arrayContaining([
        { space_id: closed, principal_kind: "account" },
        { space_id: open, principal_kind: "organizationMembers" },
        { space_id: untouched, principal_kind: "account" },
      ]),
    );
    expect(remaining.rows).toHaveLength(3);
    const removals = await pool.query(
      "select space_id, organization_id, name, grants from private_space_grant_removals",
    );
    expect(removals.rows).toEqual([
      {
        space_id: closed,
        organization_id: organizationId,
        name: "Closed",
        grants: [
          { principalKind: "instanceUsers", role: "reader" },
          { principalKind: "organizationMembers", role: "editor" },
        ],
      },
    ]);
  });
});
