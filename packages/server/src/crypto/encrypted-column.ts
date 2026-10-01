import { customType } from "drizzle-orm/pg-core";

/**
 * Column for a value encrypted with `Encryption.encrypt` (stored as bytea). Every column of
 * this type must also be listed in `encryptedColumns`, so that key rotation finds it.
 */
export const encrypted = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

/** Table and column of an encrypted value, as SQL names. */
export interface EncryptedColumn {
  table: string;
  idColumn: string;
  column: string;
}

/**
 * All encrypted columns. Modules add their columns here together with the schema change;
 * a test compares this list with the `encrypted()` columns of the schema.
 */
export const encryptedColumns: readonly EncryptedColumn[] = [];
