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
    pool = createDatabasePool({ connectionString: database.url, applicationName: "lunedo-test" });
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

  async function ownNumber(target: DatabasePool, itemId: string): Promise<number> {
    const result = await target.query<{ number: string }>("select number from tree_items where id = $1", [
      itemId,
    ]);
    return Number(result.rows[0]?.number);
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
  it("keeps old slugs only for titles published in the current knowledge base", async () => {
    const target = await migratedBefore("0088_published_slug_history");
    const organizationId = await organization(target);
    const space = await knowledgeBase(target, organizationId);
    const page = async (title: string) => {
      const id = randomUUID();
      await target.query(
        "insert into tree_items (id, space_id, kind, position, title, mode) values ($1, $2, 'page', $3, $4, 'publish')",
        [id, space, `a${id.slice(0, 4)}`, title],
      );
      return id;
    };
    const publish = async (itemId: string, number: number, title: string) => {
      const version = randomUUID();
      await target.query(
        `insert into page_versions (id, item_id, number, title, document, schema_version, reason, revision, state_vector)
         values ($1, $2, $3, $4, '{"type":"doc","content":[]}'::jsonb, 1, 'published', 0, decode('00', 'hex'))`,
        [version, itemId, number, title],
      );
      await target.query("update tree_items set published_version_id = $1 where id = $2", [version, itemId]);
    };
    const draft = await page("Entwurf intern");
    const published = await page("Neuer Titel");
    await publish(published, 1, "Alter Titel");
    await publish(published, 2, "Neuer Titel");
    await target.query(
      "insert into article_slugs (item_id, slug) values ($1, 'nie-veroeffentlicht'), ($1, 'alter-titel') on conflict do nothing",
      [published],
    );

    await runMigrations(target, { logger: createLogger({ service: "test", level: "silent" }) });

    const titles = await target.query<{ item_id: string; space_id: string; title: string }>(
      "select item_id, space_id, title from article_titles where item_id = any($1::uuid[]) order by title",
      [[draft, published]],
    );
    expect(titles.rows).toEqual([
      { item_id: published, space_id: space, title: "Alter Titel" },
      { item_id: published, space_id: space, title: "Neuer Titel" },
    ]);
  });

  it("moves portal addresses to the instance-wide numbers and keeps published titles per knowledge base", async () => {
    const target = await migratedBefore("0105_portal_instance_numbers");
    const organizationId = await organization(target);
    const first = await knowledgeBase(target, organizationId);
    const second = await knowledgeBase(target, organizationId);
    for (const space of [first, second]) {
      await target.query("insert into knowledge_bases (space_id, portal_path) values ($1, $2)", [
        space,
        `kb-${space.slice(0, 8)}`,
      ]);
    }
    const page = async (space: string, title: string, translationOf: string | null = null) => {
      const id = randomUUID();
      await target.query(
        `insert into tree_items (id, space_id, kind, position, title, mode, translation_of, content_language, parent_id)
         values ($1, $2, 'page', $3, $4, 'publish', $5, $6, $5)`,
        [id, space, `a${id.slice(0, 4)}`, title, translationOf, translationOf ? "de" : null],
      );
      return id;
    };
    const publish = async (itemId: string, number: number, title: string) => {
      const version = randomUUID();
      await target.query(
        `insert into page_versions (id, item_id, number, title, document, schema_version, reason, revision, state_vector)
         values ($1, $2, $3, $4, '{"type":"doc","content":[]}'::jsonb, 1, 'published', 0, decode('00', 'hex'))`,
        [version, itemId, number, title],
      );
      await target.query("update tree_items set published_version_id = $1 where id = $2", [version, itemId]);
    };
    const article = await page(first, "Drucker einrichten");
    await publish(article, 1, "Drucker verbinden");
    await publish(article, 2, "Drucker einrichten");
    const translation = await page(first, "Set up the printer", article);
    await publish(translation, 1, "Set up the printer");
    const moved = await page(first, "Größe ändern");
    await publish(moved, 1, "Größe ändern");
    await target.query("update tree_items set space_id = $1 where id = $2", [second, moved]);
    const before = await target.query<{ space_id: string; number: number; item_id: string }>(
      "select space_id, number, item_id from article_numbers where item_id = any($1::uuid[]) order by number",
      [[article, translation, moved]],
    );
    expect(before.rows.length).toBeGreaterThan(0);

    await runMigrations(target, { logger: createLogger({ service: "test", level: "silent" }) });

    const numbers = new Map(
      (
        await target.query<{ id: string; number: string }>(
          "select id, number from tree_items where id = any($1::uuid[])",
          [[article, translation, moved]],
        )
      ).rows.map((row) => [row.id, Number(row.number)]),
    );
    const synced = await target.query<{ item_id: string; number: string }>(
      "select item_id, number from article_sync where item_id = any($1::uuid[])",
      [[article, translation, moved]],
    );
    for (const row of synced.rows) {
      const own = row.item_id === translation ? article : row.item_id;
      expect(Number(row.number), row.item_id).toBe(numbers.get(own));
    }
    expect(synced.rows.map((row) => row.item_id)).toEqual(expect.arrayContaining([article, translation]));
    const titles = await target.query<{ item_id: string; space_id: string; title: string }>(
      "select item_id, space_id, title from article_titles where item_id = any($1::uuid[]) order by item_id, space_id, title",
      [[article, translation, moved]],
    );
    expect(titles.rows).toEqual(
      expect.arrayContaining([
        { item_id: article, space_id: first, title: "Drucker einrichten" },
        { item_id: article, space_id: first, title: "Drucker verbinden" },
        { item_id: translation, space_id: first, title: "Set up the printer" },
        { item_id: moved, space_id: first, title: "Größe ändern" },
        { item_id: moved, space_id: second, title: "Größe ändern" },
      ]),
    );
    expect(titles.rows).toHaveLength(5);
    const dropped = await target.query<{ name: string }>(
      `select table_name as name from information_schema.tables where table_name in ('article_numbers', 'article_slugs')
       union all select column_name from information_schema.columns
         where table_name = 'knowledge_bases' and column_name = 'next_article_number'
       union all select proname from pg_proc where proname in ('article_slug', 'tree_items_article_address')`,
    );
    expect(dropped.rows).toEqual([]);

    const later = await page(first, "Neu");
    await publish(later, 1, "Neu veröffentlicht");
    const added = await target.query<{ title: string; number: string | null }>(
      `select h.title, a.number from article_titles h
       left join article_sync a on a.item_id = h.item_id where h.item_id = $1`,
      [later],
    );
    expect(added.rows).toEqual([
      { title: "Neu veröffentlicht", number: String(await ownNumber(target, later)) },
    ]);
  });
});
