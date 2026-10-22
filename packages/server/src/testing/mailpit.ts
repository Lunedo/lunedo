export function testMailpitUrl(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const url = env.LUNEDO_TEST_MAILPIT_URL?.trim();
  if (!url && env.CI) throw new Error("LUNEDO_TEST_MAILPIT_URL must be set in CI");
  return url || undefined;
}

export function testMailpitSmtpPort(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.LUNEDO_TEST_MAILPIT_SMTP_PORT?.trim();
  if (!raw) {
    if (env.CI) throw new Error("LUNEDO_TEST_MAILPIT_SMTP_PORT must be set in CI");
    return 1025;
  }
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("LUNEDO_TEST_MAILPIT_SMTP_PORT must be a port number");
  }
  return port;
}

export interface CaughtMail {
  subject: string;
  text: string;
  html: string;
  from: string;
}

export class Mailpit {
  constructor(
    readonly url: string,
    readonly smtpPort: number = testMailpitSmtpPort(),
  ) {}

  get smtpHost(): string {
    return new URL(this.url).hostname;
  }

  async waitFor(to: string, options: { timeoutMs?: number; after?: number } = {}): Promise<CaughtMail> {
    const deadline = Date.now() + (options.timeoutMs ?? 20_000);
    for (;;) {
      const search = await fetch(`${this.url}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
      const result = (await search.json()) as { messages: { ID: string; Created: string }[] };
      const message = result.messages.find(
        (entry) => new Date(entry.Created).getTime() >= (options.after ?? 0),
      );
      if (message) {
        const details = (await (await fetch(`${this.url}/api/v1/message/${message.ID}`)).json()) as {
          Subject: string;
          Text: string;
          HTML: string;
          From: { Address: string };
        };
        return {
          subject: details.Subject,
          text: details.Text,
          html: details.HTML,
          from: details.From.Address,
        };
      }
      if (Date.now() > deadline) throw new Error(`No mail to ${to} arrived`);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
}
