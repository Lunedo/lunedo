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

function foldersBefore(tag: string): string {
  const folder = mkdtempSync(path.join(tmpdir(), "pagehall-migrations-"));
  cpSync(migrations, folder, { recursive: true });
  const journalFile = path.join(folder, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalFile, "utf8")) as { entries: { tag: string }[] };
  const index = journal.entries.findIndex((entry) => entry.tag === tag);
  if (index < 0) throw new Error(`Unknown migration ${tag}`);
  journal.entries = journal.entries.slice(0, index);
  writeFileSync(journalFile, JSON.stringify(journal));
  return folder;
}

describe.skipIf(!baseUrl)("knowledge base data migrations", () => {
  let database: TemporaryDatabase | undefined;
  let pool: DatabasePool | undefined;
  let folder: string | undefined;

  afterEach(async () => {
    await pool?.end();
    await database?.drop();
    if (folder) rmSync(folder, { recursive: true, force: true });
    pool = undefined;
    database = undefined;
    folder = undefined;
  });

  async function migratedBefore(tag: string): Promise<DatabasePool> {
    database = await createTemporaryDatabase(baseUrl as string);
    pool = createDatabasePool({ connectionString: database.url, applicationName: "pagehall-test" });
    folder = foldersBefore(tag);
    await runMigrations(pool, { logger: createLogger({ service: "test", level: "silent" }), folder });
    return pool;
  }

  async function organization(target: DatabasePool) {
    const id = randomUUID();
    await target.query("insert into organizations (id, name, slug) values ($1, 'Team', $2)", [
      id,
      `team-${id.slice(0, 8)}`,
    ]);
    return id;
  }

  async function account(target: DatabasePool, type: string, organizationId: string) {
    const id = randomUUID();
    await target.query(
      "insert into accounts (id, type, state, email, name) values ($1, $2, 'active', $3, 'Person')",
      [id, type, `${id}@example.org`],
    );
    await target.query(
      "insert into memberships (id, organization_id, account_id, kind) values ($1, $2, $3, $4)",
      [randomUUID(), organizationId, id, type === "standard" ? "member" : "guest"],
    );
    return id;
  }

  async function knowledgeBase(target: DatabasePool, organizationId: string) {
    const id = randomUUID();
    await target.query(
      `insert into spaces (id, organization_id, key, name, visibility, type, audience)
       values ($1, $2, $3, 'Help', 'private', 'knowledgeBase', 'portal')`,
      [
        id,
        organizationId,
        `K${id
          .slice(0, 6)
          .toUpperCase()
          .replace(/[^A-Z]/g, "X")}`,
      ],
    );
    return id;
  }

  it("links accepted portal invitations to the knowledge base that sent them", async () => {
    const target = await migratedBefore("0085_portal_readers");
    const organizationId = await organization(target);
    const invited = await knowledgeBase(target, organizationId);
    const other = await knowledgeBase(target, organizationId);
    const reader = await account(target, "portal", organizationId);
    const invitation = randomUUID();
    await target.query(
      `insert into invitations (id, organization_id, email, kind, token_hash, expires_at, accepted_at)
       values ($1, $2, $3, 'guest', $4, now() + interval '1 day', now())`,
      [invitation, organizationId, `${reader}@example.org`, randomUUID()],
    );
    await target.query("insert into portal_invitations (invitation_id, space_id) values ($1, $2)", [
      invitation,
      invited,
    ]);

    await runMigrations(target, { logger: createLogger({ service: "test", level: "silent" }) });

    const readers = await target.query<{ space_id: string }>(
      "select space_id from portal_readers where account_id = $1",
      [reader],
    );
    expect(readers.rows.map((row) => row.space_id)).toEqual([invited]);
    expect(readers.rows.map((row) => row.space_id)).not.toContain(other);
  });

  it("reduces roles of portal accounts to reader and reports it", async () => {
    const target = await migratedBefore("0086_portal_accounts_read_only");
    const organizationId = await organization(target);
    const space = await knowledgeBase(target, organizationId);
    const reader = await account(target, "portal", organizationId);
    const editor = await account(target, "standard", organizationId);
    const grant = async (principal: string, role: string) => {
      const id = randomUUID();
      await target.query(
        `insert into space_permissions (id, space_id, principal_kind, principal_id, role)
         values ($1, $2, 'account', $3, $4)`,
        [id, space, principal, role],
      );
      return id;
    };
    const portalRole = await grant(reader, "editor");
    const memberRole = await grant(editor, "editor");
    const lines: string[] = [];
    const logger = createLogger({
      service: "test",
      level: "warn",
      destination: { write: (line: string) => lines.push(line) },
    });

    await runMigrations(target, { logger });

    const roles = await target.query<{ id: string; role: string }>(
      "select id, role from space_permissions where id = any($1::uuid[])",
      [[portalRole, memberRole]],
    );
    expect(Object.fromEntries(roles.rows.map((row) => [row.id, row.role]))).toEqual({
      [portalRole]: "reader",
      [memberRole]: "editor",
    });
    expect(lines.join("\n")).toContain(`Space ${space}: 1 role(s) of portal accounts reduced to reader`);
  });

  it("replaces time-ordered IDs of notes and searches with random ones", async () => {
    const target = await migratedBefore("0087_random_statistics_ids");
    const organizationId = await organization(target);
    const space = await knowledgeBase(target, organizationId);
    const item = randomUUID();
    await target.query(
      "insert into tree_items (id, space_id, kind, position, title, mode) values ($1, $2, 'page', 'a0', 'Artikel', 'publish')",
      [item, space],
    );
    const timed = "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a70";
    const searched = "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a71";
    await target.query(
      "insert into portal_feedback (id, item_id, space_id, day, text) values ($1, $2, $3, current_date, 'Hinweis')",
      [timed, item, space],
    );
    await target.query(
      "insert into portal_searches (id, space_id, term, results, searched_at) values ($1, $2, 'vpn', 1, date_trunc('hour', now()))",
      [searched, space],
    );

    await runMigrations(target, { logger: createLogger({ service: "test", level: "silent" }) });

    const rows = await target.query<{ id: string; kind: string }>(
      "select id, 'feedback' as kind from portal_feedback union all select id, 'search' from portal_searches",
    );
    expect(rows.rows.map((row) => row.kind).sort()).toEqual(["feedback", "search"]);
    for (const row of rows.rows) {
      expect([timed, searched]).not.toContain(row.id);
      expect(row.id[14]).toBe("4");
    }
  });
});
