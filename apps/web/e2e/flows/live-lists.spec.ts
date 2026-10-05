import { type Browser, expect, type Page, test } from "@playwright/test";
import { OWNER, OWNER_STORAGE, readState } from "../support/environment.js";
import { callApi, freshTotp, liveUpdatesConnected, signInWithPassword } from "../support/helpers.js";

test.describe.configure({ mode: "serial" });

async function watcher(browser: Browser, path: string): Promise<Page> {
  const context = await browser.newContext({ storageState: OWNER_STORAGE });
  const page = await context.newPage();
  const connected = liveUpdatesConnected(page);
  await page.goto(path);
  await connected;
  return page;
}

async function secondSession(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  await page.goto("/sign-in");
  await signInWithPassword(page, OWNER.email, OWNER.password);
  await page
    .getByLabel("Code from your authenticator app")
    .fill(await freshTotp(readState().ownerSecret ?? ""));
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByRole("heading", { name: "Preferences" })).toBeVisible();
  return page;
}

test("shows an account created in another session without a reload", async ({ browser }) => {
  const page = await watcher(browser, "/settings/instance/accounts");
  await expect(page.getByRole("heading", { name: "Accounts", level: 1 })).toBeVisible();
  const other = await secondSession(browser);
  try {
    const name = `Live Placeholder ${Date.now()}`;
    await callApi(other, "POST", "/api/v1/instance/accounts/placeholders", {
      name,
      email: `live-${Date.now()}@import.test`,
    });
    await expect(page.getByRole("table").getByText(name)).toBeVisible();
  } finally {
    await other.context().close();
    await page.context().close();
  }
});

test("shows mapping rules added and removed in another session without a reload", async ({ browser }) => {
  const other = await secondSession(browser);
  const organizations = await other.request.get("/api/v1/instance/organizations?limit=1");
  const organizationId = ((await organizations.json()) as { items: { id: string }[] }).items[0]?.id ?? "";
  await callApi(other, "POST", "/api/v1/auth/reauthenticate", {
    method: "password",
    password: OWNER.password,
  });
  const created = (await callApi(other, "POST", "/api/v1/instance/identity-providers", {
    type: "oidc",
    name: `Live rules ${Date.now()}`,
    config: {
      preset: "generic",
      issuer: "https://login.live-rules.test",
      clientId: "pagehall",
      domains: [`live-${Date.now()}.test`],
      accountCreation: { enabled: false, requiredGroups: [] },
    },
    credential: { kind: "clientSecret", secret: "a client secret for the live test", expiresAt: null },
  })) as { provider: { id: string } };
  const providerId = created.provider.id;
  const page = await watcher(browser, `/settings/instance/sign-in-providers/${providerId}?tab=mapping`);
  try {
    const rules = page.getByRole("table");
    const rule = (await callApi(
      other,
      "POST",
      `/api/v1/instance/identity-providers/${providerId}/mapping-rules`,
      {
        target: "organization",
        group: { id: "live-editors", name: "Live Editors" },
        organizationId,
        role: null,
        synchronizedGroup: false,
        homeOrganization: false,
      },
    )) as { id: string };
    await expect(rules.getByText("Live Editors")).toBeVisible();
    await callApi(
      other,
      "DELETE",
      `/api/v1/instance/identity-providers/${providerId}/mapping-rules/${rule.id}`,
    );
    await expect(page.getByText("Live Editors")).toHaveCount(0);
  } finally {
    await other.context().close();
    await page.context().close();
  }
});
