import { ImportFormatError } from "./errors.js";
import { readCsvRecords } from "./formats/csv.js";

export const MAX_USER_LIST_BYTES = 10 * 1024 * 1024;
const MAX_USERS = 200_000;

const ID_COLUMNS = ["user id", "account id", "atlassian account id", "aaid", "id"];
const NAME_COLUMNS = ["user name", "display name", "name", "full name"];
const EMAIL_COLUMNS = ["email", "e-mail", "email address", "e-mail address"];

export interface UserListEntry {
  readonly externalId: string;
  readonly name: string | null;
  readonly email: string | null;
}

function column(header: readonly string[], candidates: readonly string[]): string | null {
  for (const candidate of candidates) {
    const found = header.find((name) => name.trim().toLowerCase() === candidate);
    if (found !== undefined) return found;
  }
  return null;
}

async function* single(text: string): AsyncGenerator<string> {
  yield text;
}

export async function parseUserList(text: string): Promise<UserListEntry[]> {
  if (Buffer.byteLength(text, "utf8") > MAX_USER_LIST_BYTES) {
    throw new ImportFormatError("userListTooLarge", "The user list is larger than 10 MB.");
  }
  const content = text.startsWith("﻿") ? text.slice(1) : text;
  const entries = new Map<string, UserListEntry>();
  let columns: { id: string; name: string | null; email: string | null } | null = null;
  for await (const record of readCsvRecords(single(content))) {
    if (columns === null) {
      const header = Object.keys(record);
      const id = column(header, ID_COLUMNS);
      if (!id) {
        throw new ImportFormatError(
          "userListInvalid",
          "The file is not a user list from the Atlassian administration: it has no column with the user ID.",
        );
      }
      columns = { id, name: column(header, NAME_COLUMNS), email: column(header, EMAIL_COLUMNS) };
    }
    const externalId = (record[columns.id] ?? "").trim();
    if (externalId.length === 0 || externalId.length > 255) continue;
    const name = columns.name ? (record[columns.name] ?? "").trim() : "";
    const email = columns.email ? (record[columns.email] ?? "").trim() : "";
    const previous = entries.get(externalId);
    entries.set(externalId, {
      externalId,
      name: name.length > 0 ? name.slice(0, 200) : (previous?.name ?? null),
      email: email.includes("@") && email.length <= 320 ? email : (previous?.email ?? null),
    });
    if (entries.size > MAX_USERS) {
      throw new ImportFormatError("userListTooLarge", "The user list has more people than the limit.");
    }
  }
  if (columns === null) {
    throw new ImportFormatError("userListInvalid", "The user list is empty.");
  }
  return [...entries.values()];
}
