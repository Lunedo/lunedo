import { randomBytes } from "node:crypto";
import { createServerRuntime, type ServerRuntime } from "@pagehall/server";
import { Mailpit, testMailpitUrl } from "@pagehall/server/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  completeConfiguredSetup,
  configuredSetupEnv,
  createAccount,
  signedInClient,
} from "../testing/accounts.js";
import { type AuthTestApp, createAuthTestApp, databaseBaseUrl, TestClient } from "../testing/auth-app.js";

const mailpitUrl = testMailpitUrl();

function linkToken(text: string): string {
  const match = /#token=([\w-]{43})/.exec(text);
  if (!match?.[1]) throw new Error("The mail contains no link with a token");
  return match[1];
}

describe.skipIf(!databaseBaseUrl || !mailpitUrl)("mail end to end", () => {
  const mailpit = new Mailpit(mailpitUrl ?? "http://localhost:8025");
  const unique = randomBytes(4).toString("hex");
  let test: AuthTestApp;
  let worker: ServerRuntime;

  beforeAll(async () => {
    test = await createAuthTestApp(
      {
        ...configuredSetupEnv,
        PAGEHALL_SMTP_HOST: mailpit.smtpHost,
        PAGEHALL_SMTP_PORT: String(mailpit.smtpPort),
        PAGEHALL_SMTP_SECURITY: "none",
        PAGEHALL_SMTP_FROM: "wiki@pagehall.test",
      },
      { captureMail: false },
    );
    await completeConfiguredSetup(test);
    worker = await createServerRuntime({ role: "worker", env: test.env });
  });

  afterAll(async () => {
    await worker?.close();
    await test?.close();
  });

  it("resets a password with the link from the mail", async () => {
    const email = `reset-${unique}@example.org`;
    const account = await createAccount(test, email);
    const started = Date.now();
    const anonymous = new TestClient(test.app);
    expect((await anonymous.post("/api/v1/auth/password-reset", { email })).statusCode).toBe(202);

    const mail = await mailpit.waitFor(email, { after: started - 1000 });
    expect(mail.subject).toBe("Reset your password for Test wiki");
    expect(mail.from).toBe("wiki@pagehall.test");
    expect(mail.html).toContain('<a href="https://pagehall.test/reset-password#token=');
    const token = linkToken(mail.text);

    expect(
      (await anonymous.post("/api/v1/auth/password-reset/complete", { token, password: "caught by mailpit" }))
        .statusCode,
    ).toBe(204);
    await signedInClient(test, account.email, "caught by mailpit");
  });

  it("changes the e-mail address with the confirmation mail and notifies the old address", async () => {
    const oldEmail = `old-${unique}@example.org`;
    const newEmail = `new-${unique}@example.org`;
    const account = await createAccount(test, oldEmail);
    const client = await signedInClient(test, account.email, account.password);
    const started = Date.now();
    expect((await client.post("/api/v1/account/email", { email: newEmail })).statusCode).toBe(202);

    const confirmation = await mailpit.waitFor(newEmail, { after: started - 1000 });
    expect(
      (
        await new TestClient(test.app).post("/api/v1/auth/email-change/confirm", {
          token: linkToken(confirmation.text),
        })
      ).statusCode,
    ).toBe(204);

    const notice = await mailpit.waitFor(oldEmail, { after: started - 1000 });
    expect(notice.subject).toBe("Your e-mail address on Test wiki was changed");
    await signedInClient(test, newEmail, account.password);
  });
});
