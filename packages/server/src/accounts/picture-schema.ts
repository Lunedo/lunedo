import { pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { timestamps } from "../database/columns.js";
import { storedFiles } from "../files/schema.js";
import { accounts } from "./schema.js";

export const accountPictures = pgTable(
  "account_pictures",
  {
    accountId: uuid()
      .primaryKey()
      .references(() => accounts.id, { onDelete: "cascade" }),
    fileId: uuid()
      .notNull()
      .references(() => storedFiles.id),
    contentType: text().notNull(),
    ...timestamps(),
  },
  (table) => [uniqueIndex("account_pictures_file_unique").on(table.fileId)],
);
