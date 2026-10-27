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

describe.skipIf(!baseUrl)("managed account migration", () => {
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
    pool = createDatabasePool({ connectionString: database.url, applicationName: "lunedo-test", max: 4 });
    folder = foldersBefore(tag);
    await runMigrations(pool, { logger, folder });
    return pool;
  }

  async function account(target: DatabasePool, email: string, type = "standard"): Promise<string> {
    const id = randomUUID();
    await target.query(
      "insert into accounts (id, type, state, email, name) values ($1, $2, 'active', $3, 'Person')",
      [id, type, email],
    );
    return id;
  }

  async function provider(
    target: DatabasePool,
    domains: string[],
    state: "active" | "deactivated" | "draft",
  ) {
    const id = randomUUID();
    await target.query(
      `insert into identity_providers (id, type, preset, name, config, draft, setup_completed_at, deactivated_at)
       values ($1, 'oidc', 'generic', $2, $3, $4, $5, $6)`,
      [
        id,
        `Provider ${id.slice(0, 6)}`,
        state === "draft" ? null : "{}",
        state === "draft" ? "{}" : null,
        state === "draft" ? null : new Date(),
        state === "deactivated" ? new Date() : null,
      ],
    );
    for (const domain of domains) {
      await target.query("insert into identity_provider_domains (domain, provider_id) values ($1, $2)", [
        domain,
        id,
      ]);
    }
    return id;
  }

  async function link(target: DatabasePool, accountId: string, providerId: string, createdAt: string) {
    await target.query(
      "insert into identities (id, account_id, provider_id, subject, created_at) values (gen_random_uuid(), $1, $2, $3, $4)",
      [accountId, providerId, randomUUID(), createdAt],
    );
  }

  it("records the managing provider of existing accounts and removes the password sign-in setting", async () => {
    const target = await migratedBefore("0106_managed_accounts");
    await target.query("insert into instance (id) values (1)");
    const active = await provider(target, ["active.example"], "active");
    const paused = await provider(target, ["paused.example"], "deactivated");
    const draft = await provider(target, ["draft.example"], "draft");

    const byDomain = await account(target, "person@Active.example");
    const byPausedDomain = await account(target, "person@paused.example");
    const byDraftDomain = await account(target, "person@draft.example");
    const guest = await account(target, "guest@active.example", "guest");
    const portal = await account(target, "reader@active.example", "portal");
    const local = await account(target, "person@local.example");
    const linked = await account(target, "linked@paused.example");
    await link(target, linked, paused, "2026-01-01T00:00:00Z");
    await link(target, linked, active, "2026-02-01T00:00:00Z");
    const owner = await account(target, "owner@active.example");
    await link(target, owner, active, "2026-01-01T00:00:00Z");
    await target.query("update instance set owner_account_id = $1", [owner]);
    await target.query(
      `insert into setting_values (id, level, scope_id, key, value, locked, created_at, updated_at)
       values (gen_random_uuid(), 'instance', '00000000-0000-0000-0000-000000000000', 'auth.passwordSignIn', 'false', false, now(), now())`,
    );

    await runMigrations(target, { logger });

    const rows = await target.query<{ account_id: string; provider_id: string; source: string }>(
      "select account_id, provider_id, source from managed_accounts",
    );
    const managed = new Map(rows.rows.map((row) => [row.account_id, row]));
    expect(managed.get(byDomain)).toMatchObject({ provider_id: active, source: "domain" });
    expect(managed.get(byPausedDomain)).toMatchObject({ provider_id: paused, source: "domain" });
    expect(managed.get(guest)).toMatchObject({ provider_id: active, source: "domain" });
    expect(managed.get(linked)).toMatchObject({ provider_id: active, source: "identity" });
    for (const unmanaged of [byDraftDomain, portal, local, owner]) expect(managed.has(unmanaged)).toBe(false);
    expect(rows.rows).toHaveLength(4);
    expect(draft).toBeTruthy();

    const setting = await target.query("select 1 from setting_values where key = 'auth.passwordSignIn'");
    expect(setting.rows).toEqual([]);
  });

  it("moves OpenID Connect and SAML providers that asked for a Lunedo second factor to the provider's own", async () => {
    const target = await migratedBefore("0107_provider_second_factor");
    const ids = { oidc: randomUUID(), saml: randomUUID(), ldap: randomUUID(), proof: randomUUID() };
    const config = (mode: string) => JSON.stringify({ secondFactor: { mode, proofValues: ["mfa"] } });
    for (const [id, type, preset, mode] of [
      [ids.oidc, "oidc", "generic", "lunedo"],
      [ids.saml, "saml", "generic", "lunedo"],
      [ids.ldap, "ldap", "activeDirectory", "lunedo"],
      [ids.proof, "oidc", "generic", "providerProof"],
    ] as const) {
      await target.query(
        "insert into identity_providers (id, type, preset, name, config, setup_completed_at) values ($1, $2, $3, $5, $4, now())",
        [id, type, preset, config(mode), `Provider ${mode}`],
      );
    }
    await runMigrations(target, { logger });
    const rows = await target.query<{ id: string; mode: string }>(
      "select id, config -> 'secondFactor' ->> 'mode' as mode from identity_providers",
    );
    const modes = Object.fromEntries(rows.rows.map((row) => [row.id, row.mode]));
    expect(modes).toEqual({
      [ids.oidc]: "provider",
      [ids.saml]: "provider",
      [ids.ldap]: "lunedo",
      [ids.proof]: "providerProof",
    });
  });
});
