import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Principal } from "../accounts/principal.js";
import type { Database } from "../database/database.js";
import { giveAccessDrafts } from "./schema.js";

export const giveAccessDraftSchema = z
  .object({
    step: z.number().int().min(0).max(3).describe("The step the assistant was left on, from 0 to 3."),
    holder: z
      .object({
        kind: z.enum(["account", "group"]).describe("Whether a person or a group gets access."),
        id: z.uuid().describe("ID of the account or group."),
        name: z.string().min(1).max(300).describe("Name shown in the assistant."),
      })
      .nullable()
      .describe("The person or group chosen in the first step, or null."),
    level: z.enum(["reader", "commenter", "editor", "admin"]).describe("What they may do."),
    where: z.enum(["space", "page", "pageAndChildren"]).describe("Where they get access."),
    page: z
      .object({
        id: z.uuid().describe("ID of the page."),
        title: z.string().max(500).describe("Title shown in the assistant."),
      })
      .nullable()
      .describe("The page chosen for page access, or null."),
  })
  .strict()
  .describe("An unfinished Give access assistant.");

export type GiveAccessDraft = z.output<typeof giveAccessDraftSchema>;

function ownerOf(actor: Principal): string {
  if (actor.type !== "account") throw new Error("Only accounts keep assistant drafts");
  return actor.id;
}

export class GiveAccessDraftService {
  readonly #database: Database;

  constructor(options: { database: Database }) {
    this.#database = options.database;
  }

  async get(actor: Principal, spaceId: string): Promise<GiveAccessDraft | null> {
    const [row] = await this.#database
      .select({ draft: giveAccessDrafts.draft })
      .from(giveAccessDrafts)
      .where(and(eq(giveAccessDrafts.accountId, ownerOf(actor)), eq(giveAccessDrafts.spaceId, spaceId)));
    if (!row) return null;
    const parsed = giveAccessDraftSchema.safeParse(row.draft);
    return parsed.success ? parsed.data : null;
  }

  async save(actor: Principal, spaceId: string, draft: GiveAccessDraft): Promise<GiveAccessDraft> {
    const value = giveAccessDraftSchema.parse(draft);
    await this.#database
      .insert(giveAccessDrafts)
      .values({ accountId: ownerOf(actor), spaceId, draft: value })
      .onConflictDoUpdate({
        target: [giveAccessDrafts.accountId, giveAccessDrafts.spaceId],
        set: { draft: value, updatedAt: sql`now()` },
      });
    return value;
  }

  async discard(actor: Principal, spaceId: string): Promise<void> {
    await this.#database
      .delete(giveAccessDrafts)
      .where(and(eq(giveAccessDrafts.accountId, ownerOf(actor)), eq(giveAccessDrafts.spaceId, spaceId)));
  }
}
