import { sql } from "drizzle-orm";
import type { Database } from "../database/database.js";
import { mailSends } from "./schema.js";

export type SendSlot = { claimed: true } | { claimed: false; waitMs: number };

export class MailSendRate {
  readonly #database: Database;

  constructor(database: Database) {
    this.#database = database;
  }

  async claim(sender: string, perMinute: number): Promise<SendSlot> {
    const key = sender.trim().toLowerCase();
    return this.#database.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`lunedo.mail.send:${key}`}, 0))`);
      await tx.execute(
        sql`delete from mail_sends where sender = ${key} and sent_at <= clock_timestamp() - interval '1 minute'`,
      );
      const window = await tx.execute<{ sent: string | number; wait_ms: string | number | null }>(sql`
        select count(*) as sent,
          ceil(extract(epoch from (min(sent_at) + interval '1 minute' - clock_timestamp())) * 1000) as wait_ms
        from mail_sends where sender = ${key}`);
      const sent = Number(window.rows[0]?.sent ?? 0);
      if (sent < perMinute) {
        await tx.insert(mailSends).values({ sender: key, sentAt: sql`clock_timestamp()` });
        return { claimed: true };
      }
      return { claimed: false, waitMs: Math.max(1, Number(window.rows[0]?.wait_ms ?? 1000)) };
    });
  }
}
