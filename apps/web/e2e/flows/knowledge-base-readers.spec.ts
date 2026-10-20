import { expect, test } from "../support/fixtures.js";
import { callApi, expectAccessible, linkFrom, signInWithPassword, waitForMail } from "../support/helpers.js";
import { forwardFrom, SIGNED_OUT, unique } from "../support/people.js";
import { createPortal, waitForIndex } from "../support/portal.js";

test("invites a portal account that reads an article and never sees the wiki", async ({
  page,
  browser,
  baseURL,
  organization,
}) => {
  await page.goto("/");
  const portal = await createPortal(page, { audience: "portal", organizationId: organization.id });
  await waitForIndex(page, portal, "VPN");
  const article = portal.articles[0];
  if (!article) throw new Error("no article");
  const suffix = unique();
  const reader = {
    name: `Rita Reader ${suffix}`,
    email: `rita.reader.${suffix.toLowerCase()}@pagehall.test`,
    password: "reader passphrase for testing",
  };

  await page.goto(`/spaces/${portal.spaceKey}/settings/portal-accounts`);
  await expect(page.getByRole("heading", { name: "Portal accounts", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Invite reader" }).click();
  const dialog = page.getByRole("dialog", { name: "Invite a reader" });
  await dialog.getByLabel("E-mail address").fill(reader.email);
  await dialog.getByRole("button", { name: "Send invitation" }).click();
  await expect(page.getByText(`Invitation sent to ${reader.email}`).first()).toBeVisible();
  await expectAccessible(page, "portal accounts");

  const mail = await waitForMail(reader.email, /invited you to read/);
  const context = await forwardFrom(await browser.newContext({ baseURL, storageState: SIGNED_OUT }));
  const invitee = await context.newPage();
  await invitee.goto(linkFrom(mail.text).replace(/^https?:\/\/[^/]+/, ""));
  await expect(invitee.getByRole("heading", { name: `Read ${portal.name}` })).toBeVisible();
  await invitee.getByRole("button", { name: "Accept invitation" }).click();
  await invitee.getByLabel("Name", { exact: true }).fill(reader.name);
  await invitee.getByLabel("Password", { exact: true }).fill(reader.password);
  await invitee.getByLabel("Repeat the password").fill(reader.password);
  await invitee.getByRole("button", { name: "Create account" }).click();
  await invitee.getByRole("link", { name: `Open ${portal.name}` }).click();

  await expect(invitee.getByRole("heading", { name: "Sign in to read the help" })).toBeVisible();
  await invitee.getByRole("link", { name: "Sign in with an e-mail address" }).click();
  await signInWithPassword(invitee, reader.email, reader.password);
  await expect(invitee.getByRole("heading", { name: "How can we help?", level: 1 })).toBeVisible();
  await invitee.goto(`${portal.path}/${article.address}`);
  await expect(invitee.getByRole("heading", { name: article.title, level: 1 })).toBeVisible();

  await invitee.goto("/spaces");
  await expect(invitee.getByRole("heading", { name: "Your help portals", level: 1 })).toBeVisible();
  await expect(invitee.getByRole("link", { name: "Open portal" })).toHaveAttribute(
    "href",
    new RegExp(portal.path),
  );
  const spaces = await invitee.request.get("/api/v1/spaces");
  expect(spaces.status()).toBe(403);
  await context.close();
});

test("enables a second language and lets readers switch the language in the portal", async ({
  page,
  browser,
  baseURL,
  organization,
}) => {
  await page.goto("/");
  const portal = await createPortal(page, { audience: "public", organizationId: organization.id });
  const article = portal.articles[0];
  if (!article) throw new Error("no article");

  await page.goto(`/spaces/${portal.spaceKey}/settings/languages`);
  await expect(
    page.getByText("Only one language is enabled, so readers see nothing about languages."),
  ).toBeVisible();
  await page.getByRole("combobox", { name: "Enabled languages" }).click();
  await page.getByRole("option", { name: "German", exact: true }).click();
  await expect(page.getByText(/0 of 5 articles translated/)).toBeVisible();
  await expectAccessible(page, "languages of a knowledge base");

  const translation = (await callApi(page, "POST", `/api/v1/articles/${article.id}/translations`, {
    language: "de",
  })) as { id: string };
  await callApi(page, "PATCH", `/api/v1/items/${translation.id}`, {
    title: "VPN-Verbindung von zu Hause einrichten",
  });
  await callApi(page, "PUT", `/api/v1/pages/${translation.id}/content`, {
    document: {
      type: "doc",
      content: [
        {
          type: "section",
          attrs: { key: "summary", title: "Worum es geht" },
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Mit dem VPN erreichst du die Laufwerke." }],
            },
          ],
        },
      ],
    },
  });
  await callApi(page, "POST", `/api/v1/pages/${translation.id}/publish`, {});

  const context = await forwardFrom(await browser.newContext({ baseURL, storageState: SIGNED_OUT }));
  const reader = await context.newPage();
  await reader.goto(`${portal.path}/${article.address}`);
  await expect(reader.getByRole("heading", { name: article.title, level: 1 })).toBeVisible();
  await reader.getByLabel("Language: English").click();
  await reader.getByRole("link", { name: "Deutsch" }).click();
  await expect(
    reader.getByRole("heading", { name: "VPN-Verbindung von zu Hause einrichten", level: 1 }),
  ).toBeVisible();
  await expect(reader.locator("html")).toHaveAttribute("lang", "de");
  await expect(reader.getByText("Mit dem VPN erreichst du die Laufwerke.")).toBeVisible();
  await expect(reader).toHaveURL(new RegExp(`${portal.path}/de/`));
  await expectAccessible(reader, "translated portal article");

  const untranslated = portal.articles[1];
  if (!untranslated) throw new Error("no second article");
  await reader.goto(`${portal.path}/de/${untranslated.address}`);
  await expect(reader.getByRole("heading", { name: untranslated.title, level: 1 })).toBeVisible();
  await expect(
    reader.getByRole("note").filter({ hasText: "Diesen Artikel gibt es noch nicht auf Deutsch" }),
  ).toBeVisible();
  await context.close();
});
