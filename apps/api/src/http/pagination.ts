import type { PageRequest, Page as ServerPage } from "@lunedo/server";
import { idSchema } from "@lunedo/shared";
import { z } from "zod";
import { ProblemException } from "./problems.js";

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

export const pageQuery = {
  cursor: z
    .string()
    .max(2000)
    .optional()
    .describe("Opaque cursor from `nextCursor` of the previous page. Leave it out for the first page."),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_PAGE_SIZE)
    .default(DEFAULT_PAGE_SIZE)
    .describe(
      `Maximum number of items in the page, from 1 to ${MAX_PAGE_SIZE}. Default ${DEFAULT_PAGE_SIZE}.`,
    ),
};

export const pageQuerySchema = z.object(pageQuery).strict();

export const searchQuerySchema = z
  .object({
    ...pageQuery,
    q: z
      .string()
      .trim()
      .max(200)
      .optional()
      .describe(
        "Only items that contain this text, ignoring case: in the name and e-mail address of accounts and members, the name and short name of organizations, and the name and description of groups.",
      ),
  })
  .strict();

export function pageSchema<T extends z.ZodType>(item: T, description: string) {
  return z
    .object({
      items: z.array(item).describe(description),
      nextCursor: z
        .string()
        .nullable()
        .describe("Cursor for the next page, or null on the last page. Pass it as `cursor`."),
    })
    .describe("One page of results.");
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export function encodeCursor(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export function decodeCursor<T extends z.ZodType>(
  cursor: string | undefined,
  schema: T,
): z.output<T> | undefined {
  if (cursor === undefined) return undefined;
  try {
    return schema.parse(JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")));
  } catch {
    throw new ProblemException("invalidInput", "The cursor is not valid", { fields: ["cursor"] });
  }
}

export const nameCursor = z.tuple([z.string().max(1000), idSchema]);
export const idCursor = z.tuple([idSchema]);

export function pageRequest(
  query: { cursor?: string | undefined; limit: number; q?: string | undefined },
  cursor: typeof nameCursor | typeof idCursor,
): PageRequest {
  const after = decodeCursor(query.cursor, cursor);
  return {
    limit: query.limit,
    ...(after ? { after: [...after] } : {}),
    ...(query.q ? { search: query.q } : {}),
  };
}

export function toApiPage<T>(page: ServerPage<T>): Page<T> {
  return { items: page.items, nextCursor: page.next ? encodeCursor(page.next) : null };
}

const keyCursor = z
  .array(z.union([z.string(), z.number()]))
  .min(1)
  .max(4);

export function paginate<T>(
  items: readonly T[],
  key: (item: T) => (string | number)[],
  query: { cursor?: string | undefined; limit: number },
): Page<T> {
  const after = decodeCursor(query.cursor, keyCursor);
  const compare = (left: (string | number)[], right: (string | number)[]) => {
    for (let index = 0; index < left.length; index += 1) {
      const a = left[index] ?? "";
      const b = right[index] ?? "";
      if (a < b) return -1;
      if (a > b) return 1;
    }
    return 0;
  };
  const sorted = [...items].sort((left, right) => compare(key(left), key(right)));
  const start = after ? sorted.findIndex((item) => compare(key(item), after) > 0) : 0;
  const remaining = start === -1 ? [] : sorted.slice(start);
  const page = remaining.slice(0, query.limit);
  const last = page.at(-1);
  return {
    items: page,
    nextCursor: remaining.length > query.limit && last ? encodeCursor(key(last)) : null,
  };
}
