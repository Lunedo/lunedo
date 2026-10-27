import { createHash } from "node:crypto";
import pg from "pg";
import { readState } from "./environment.js";

const ACCOUNT_ATTEMPTS_PER_MINUTE = 10;

export async function waitForSignInBudget(email: string, attempts: number): Promise<void> {
  const subject = createHash("sha256").update(email.trim().toLowerCase(), "utf8").digest("hex");
  const client = new pg.Client({ connectionString: readState().databaseUrl });
  await client.connect();
  let waitMs = 0;
  try {
    const { rows } = await client.query<{ count: number; remaining: number }>(
      `select count, extract(epoch from (window_start + interval '60 seconds' - now()))::float8 as remaining
       from rate_limits where key = $1`,
      [`signIn:account:${subject}`],
    );
    const row = rows[0];
    if (row && row.remaining > 0 && row.count + attempts > ACCOUNT_ATTEMPTS_PER_MINUTE) {
      waitMs = Math.ceil(row.remaining * 1000) + 500;
    }
  } finally {
    await client.end();
  }
  if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
}
