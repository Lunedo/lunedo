import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  appliedMigrations,
  journalMigrations,
  unknownMigrations,
  unknownMigrationsMessage,
} from "./dev-migrations.ts";

describe("appliedMigrations", () => {
  it("reads the list of the database and treats a fresh database as empty", () => {
    assert.deepEqual(appliedMigrations("1790800975117,1790849771167\n"), [1790800975117, 1790849771167]);
    assert.deepEqual(appliedMigrations("\n"), []);
    assert.deepEqual(appliedMigrations(""), []);
  });
});

describe("unknownMigrations", () => {
  const journal = JSON.stringify({ entries: [{ when: 1 }, { when: 2 }, { when: 3 }] });

  it("finds the migrations of another branch", () => {
    assert.deepEqual(unknownMigrations([1, 2, 3, 9], journalMigrations(journal)), [9]);
  });

  it("accepts a database that is behind or exactly at this branch", () => {
    assert.deepEqual(unknownMigrations([], journalMigrations(journal)), []);
    assert.deepEqual(unknownMigrations([1, 2], journalMigrations(journal)), []);
    assert.deepEqual(unknownMigrations([1, 2, 3], journalMigrations(journal)), []);
  });

  it("finds a migration that took the place of another one with the same position", () => {
    assert.deepEqual(unknownMigrations([1, 2, 7], journalMigrations(journal)), [7]);
  });
});

describe("unknownMigrationsMessage", () => {
  it("says what is wrong and names the command that resets the development database", () => {
    const message = unknownMigrationsMessage(2);
    assert.match(message, /2 migrations that this branch does not have/);
    assert.match(message, /pnpm dev:reset/);
    assert.match(unknownMigrationsMessage(1), /1 migration that/);
  });
});
