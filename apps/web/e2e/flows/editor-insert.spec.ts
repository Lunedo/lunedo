import type { Page } from "@playwright/test";
import { pagePath } from "../support/addresses.js";
import { expect, test } from "../support/fixtures.js";
import { callApi } from "../support/helpers.js";
import { unique } from "../support/people.js";

const LINES = {
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "Intro" }] },
    { type: "paragraph" },
    { type: "paragraph" },
    { type: "paragraph" },
    { type: "paragraph", content: [{ type: "text", text: "asdfasdf" }] },
  ],
};

async function pageWithLines(page: Page, organizationId: string): Promise<string> {
  await page.goto("/spaces");
  const key = `IN${unique()}`;
  const space = (await callApi(page, "POST", `/api/v1/organizations/${organizationId}/spaces`, {
    name: `Insert ${key}`,
    key,
    visibility: "private",
    grants: [],
  })) as { id: string };
  const created = (await callApi(page, "POST", `/api/v1/spaces/${space.id}/items`, {
    kind: "page",
    title: "Lines",
    parentId: null,
    mode: "live",
  })) as { id: string; number: number; title: string };
  await callApi(page, "PUT", `/api/v1/pages/${created.id}/content`, { document: LINES });
  return `${pagePath(key, created)}?edit=true`;
}

async function cursorThreeLinesAbove(page: Page) {
  const content = page.getByRole("textbox", { name: "Page content" });
  await expect(content).toHaveAttribute("contenteditable", "true");
  await content.locator(":scope > p").filter({ hasText: "asdfasdf" }).click();
  await page.keyboard.press("End");
  for (let line = 0; line < 3; line += 1) await page.keyboard.press("ArrowUp");
  return content;
}

for (const insert of [
  { name: "code block from the slash menu", via: "slash", query: "/code", option: /Code block/ },
  { name: "expand from Insert", via: "insert", option: "Expand" },
  { name: "table from the toolbar", via: "button", option: "Insert table" },
] as const) {
  test(`inserts a ${insert.name} at the cursor without taking the text below`, async ({
    page,
    organization,
  }) => {
    await page.goto(await pageWithLines(page, organization.id));
    const content = await cursorThreeLinesAbove(page);
    const toolbar = page.getByRole("toolbar", { name: "Formatting" });
    if (insert.via === "slash") {
      await page.keyboard.type(insert.query);
      await page.getByRole("option", { name: insert.option }).click();
    } else if (insert.via === "insert") {
      await toolbar.getByRole("button", { name: "Insert: Insert" }).click();
      await page.getByRole("menuitem", { name: insert.option }).click();
    } else {
      const button = toolbar.getByRole("button", { name: insert.option });
      if ((await button.count()) > 0) await button.click();
      else {
        await toolbar.getByRole("button", { name: "More tools" }).click();
        await page.getByRole("menuitem", { name: insert.option }).click();
      }
      const picker = page.getByRole("dialog", { name: "Insert table" });
      await picker.getByRole("button", { name: "Insert", exact: true }).click();
    }
    const below = content.locator(":scope > p").filter({ hasText: "asdfasdf" });
    await expect(below).toHaveCount(1);
    await expect(content.locator(":scope > :not(p)").filter({ hasText: "asdfasdf" })).toHaveCount(0);
  });
}
