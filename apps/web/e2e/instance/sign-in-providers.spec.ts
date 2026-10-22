import { expect, test } from "../support/fixtures.js";
import { callApi } from "../support/helpers.js";
import { secondSession, watcher } from "../support/sessions.js";

test.use({ instanceAdministrator: true });

test("shows mapping rules added and removed in another session without a reload", async ({
  browser,
  organization,
}) => {
  const other = await secondSession(browser, organization.admin);
  await callApi(other, "POST", "/api/v1/auth/reauthenticate", {
    method: "password",
    password: organization.admin.password,
  });
  const created = (await callApi(other, "POST", "/api/v1/instance/identity-providers", {
    type: "oidc",
    name: `Live rules ${Date.now()}`,
    config: {
      preset: "generic",
      issuer: "https://login.live-rules.test",
      clientId: "lunedo",
      domains: [`live-${Date.now()}.test`],
      claims: { groups: "groups" },
      accountCreation: { enabled: false, requiredGroups: [] },
    },
    credential: { kind: "clientSecret", secret: "a client secret for the live test", expiresAt: null },
  })) as { provider: { id: string } };
  const providerId = created.provider.id;
  const page = await watcher(
    browser,
    organization.adminState,
    `/settings/instance/sign-in-providers/${providerId}?tab=mapping`,
  );
  try {
    const rules = page.getByRole("table");
    const rule = (await callApi(
      other,
      "POST",
      `/api/v1/instance/identity-providers/${providerId}/mapping-rules`,
      {
        target: "organization",
        group: { id: "live-editors", name: "Live Editors" },
        organizationId: organization.id,
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
