import { applyConfiguredSetup, createLogger } from "@pagehall/server";
import { Secret, TOTP } from "otpauth";
import type { AuthTestApp } from "./auth-app.js";
import { TEST_ORIGIN, TestClient } from "./auth-app.js";

export const OWNER = { email: "owner@pagehall.test", password: "owner passphrase 42" };

/** Environment for an instance that was set up through configuration. */
export const configuredSetupEnv = {
  PAGEHALL_INSTANCE_URL: TEST_ORIGIN,
  PAGEHALL_INSTANCE_NAME: "Test wiki",
  PAGEHALL_OWNER_EMAIL: OWNER.email,
  PAGEHALL_OWNER_NAME: "Olivia Owner",
  PAGEHALL_OWNER_PASSWORD: OWNER.password,
  PAGEHALL_SMTP_HOST: "smtp.pagehall.test",
  PAGEHALL_SMTP_SECURITY: "none",
  PAGEHALL_SMTP_FROM: "wiki@pagehall.test",
};

export async function completeConfiguredSetup(test: AuthTestApp): Promise<void> {
  const { config, services, settings } = test.runtime;
  if (!config.setup) throw new Error("The test app has no setup configuration");
  await applyConfiguredSetup({
    setup: config.setup,
    service: services.setup,
    accounts: services.accounts,
    settings,
    mail: services.mail,
    logger: createLogger({ service: "test", level: "silent" }),
  });
}

/** Creates an active standard account through the service layer. */
export async function createAccount(test: AuthTestApp, email: string, password = "a long enough passphrase") {
  const { database, services } = test.runtime;
  const account = await database.transaction((tx) =>
    services.accounts.createStandard(tx, { email, name: email.split("@")[0] ?? email, password }),
  );
  return { ...account, email, password };
}

export function totpNow(secret: string, offsetSteps = 0): string {
  return TOTP.generate({ secret: Secret.fromBase32(secret), timestamp: Date.now() + offsetSteps * 30_000 });
}

/** Signs in with a password and expects a session without second factor. */
export async function signedInClient(
  test: AuthTestApp,
  email: string,
  password: string,
): Promise<TestClient> {
  const client = new TestClient(test.app);
  const response = await client.post("/api/v1/auth/sign-in", { email, password });
  if (response.json().status !== "signedIn") throw new Error(`Sign-in failed: ${response.body}`);
  return client;
}

/** Sets up TOTP for the signed-in client and returns the secret and the recovery codes. */
export async function addTotp(
  client: TestClient,
): Promise<{ secret: string; recoveryCodes: string[] | null }> {
  const { secret } = (await client.post("/api/v1/account/totp")).json();
  const confirmed = await client.post("/api/v1/account/totp/confirm", { code: totpNow(secret) });
  if (confirmed.statusCode !== 200) throw new Error(`TOTP setup failed: ${confirmed.body}`);
  return { secret, recoveryCodes: confirmed.json().recoveryCodes };
}
