import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Database } from "../database/database.js";
import type { JobContext } from "../jobs/job-queue.js";
import { createLogger, type Logger } from "../logging/logger.js";
import { mailOutbox } from "../mail/schema.js";
import type { MailMessage, MailTransport } from "../mail/transport.js";
import type { AccountServices } from "../services.js";

export function testJobContext<TPayload>(
  name: string,
  payload: TPayload,
  retryCount = 0,
  logger: Logger = createLogger({ service: "test", level: "silent" }),
): JobContext<TPayload> {
  return {
    id: randomUUID(),
    name,
    payload,
    retryCount,
    signal: new AbortController().signal,
    logger,
    reportProgress: async () => {},
  };
}

export class CapturingTransport implements MailTransport {
  readonly sent: MailMessage[] = [];

  async send(message: MailMessage): Promise<void> {
    this.sent.push(message);
  }
}

export async function deliverPendingMail(services: AccountServices, database: Database): Promise<void> {
  const pending = await database
    .select({ id: mailOutbox.id })
    .from(mailOutbox)
    .where(eq(mailOutbox.status, "pending"));
  for (const { id } of pending) {
    await services.mail.deliver(testJobContext("mail.deliver", { mailId: id }));
  }
}
