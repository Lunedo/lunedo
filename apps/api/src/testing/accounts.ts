import { applyConfiguredSetup, createLogger } from "@pagehall/server";
import { Secret, TOTP } from "otpauth";
import type { AuthTestApp } from "./auth-app.js";
import { TEST_ORIGIN, TestClient } from "./auth-app.js";

export const OWNER = { email: "owner@pagehall.test", password: "owner passphrase 42" };

export const configuredSetupEnv = {
  PAGEHALL_INSTANCE_URL: TEST_ORIGIN,
  PAGEHALL_INSTANCE_NAME: "Test wiki",
  PAGEHALL_OWNER_EMAIL: OWNER.email,
  PAGEHALL_OWNER_NAME: "Olivia Owner",
  PAGEHALL_OWNER_PASSWORD: OWNER.password,
  PAGEHALL_ORGANIZATION_NAME: "Test organization",
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
    organizations: services.organizations,
    logger: createLogger({ service: "test", level: "silent" }),
  });
}

export async function firstOrganizationId(test: AuthTestApp): Promise<string> {
  const result = await test.runtime.pool.query<{ id: string }>(
    "select id from organizations order by created_at limit 1",
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error("The test instance has no organization");
  return id;
}

export async function createAccount(
  test: AuthTestApp,
  email: string,
  password = "a long enough passphrase",
  homeOrganizationId?: string,
) {
  const { database, services } = test.runtime;
  const home = homeOrganizationId ?? (await firstOrganizationId(test));
  const account = await database.transaction((tx) =>
    services.accounts.createStandard(tx, {
      email,
      name: email.split("@")[0] ?? email,
      password,
      homeOrganizationId: home,
    }),
  );
  return { ...account, email, password };
}

export function totpNow(secret: string, offsetSteps = 0): string {
  return TOTP.generate({ secret: Secret.fromBase32(secret), timestamp: Date.now() + offsetSteps * 30_000 });
}

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

export async function addTotp(
  client: TestClient,
): Promise<{ secret: string; recoveryCodes: string[] | null }> {
  const { secret } = (await client.post("/api/v1/account/totp")).json();
  const confirmed = await client.post("/api/v1/account/totp/confirm", { code: totpNow(secret) });
  if (confirmed.statusCode !== 200) throw new Error(`TOTP setup failed: ${confirmed.body}`);
  return { secret, recoveryCodes: confirmed.json().recoveryCodes };
}
