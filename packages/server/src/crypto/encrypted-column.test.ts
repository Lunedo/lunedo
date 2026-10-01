import { is } from "drizzle-orm";
import { getTableConfig, PgTable, pgTable, uuid } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import * as schema from "../database/schema.js";
import { type EncryptedColumn, encrypted, encryptedColumns } from "./encrypted-column.js";

/** All `encrypted()` columns of the given tables, with the snake_case names Drizzle uses. */
function encryptedColumnsOf(tables: unknown[]): string[] {
  const columns: string[] = [];
  for (const table of tables) {
    if (!is(table, PgTable)) continue;
    const config = getTableConfig(table);
    for (const column of config.columns) {
      if (column.getSQLType() === "bytea" && column.columnType === "PgCustomColumn") {
        const name = column.keyAsName
          ? column.name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)
          : column.name;
        columns.push(`${config.name}.${name}`);
      }
    }
  }
  return columns.sort();
}

function listed(columns: readonly EncryptedColumn[]): string[] {
  return columns.map((column) => `${column.table}.${column.column}`).sort();
}

describe("encryptedColumns", () => {
  it("lists every encrypted column of the schema", () => {
    expect(listed(encryptedColumns)).toEqual(encryptedColumnsOf(Object.values(schema)));
  });

  it("detects encrypted columns", () => {
    const example = pgTable("smtp_settings", { id: uuid().primaryKey(), clientSecret: encrypted() });
    expect(encryptedColumnsOf([example])).toEqual(["smtp_settings.client_secret"]);
  });
});
