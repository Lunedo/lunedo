import type { Page } from "@playwright/test";
import { expect, type Organization, test } from "../support/fixtures.js";
import { callApi } from "../support/helpers.js";
import { unique } from "../support/people.js";
import { createPage } from "../support/places.js";

async function space(page: Page, organization: Organization) {
  await page.goto("/spaces");
  const spaceKey = `EM${unique()}`;
  const created = (await callApi(page, "POST", `/api/v1/organizations/${organization.id}/spaces`, {
    name: `Embeds ${spaceKey}`,
    key: spaceKey,
    visibility: "private",
    grants: [],
  })) as { id: string };
  return { spaceId: created.id, spaceKey };
}

function content(page: Page) {
  return page.getByRole("textbox", { name: "Page content" });
}

async function waitSaved(page: Page) {
  await expect(page.getByRole("status").getByText("Saved", { exact: true })).toBeVisible({ timeout: 20_000 });
}

const paragraph = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });

test("inserts an allowed and a disallowed embed and loads the allowed one only when it is scrolled to", async ({
  page,
  organization,
}) => {
  const frames: string[] = [];
  const referrers = new Map<string, string | null>();
  for (const host of ["https://www.youtube-nocookie.com/**", "https://player.vimeo.com/**"]) {
    await page.route(host, async (route) => {
      const url = route.request().url();
      frames.push(url);
      referrers.set(new URL(url).hostname, await route.request().headerValue("referer"));
      return route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<!doctype html><title>Video</title><p>Video player</p>",
      });
    });
  }
  const { spaceId, spaceKey } = await space(page, organization);
  const created = await createPage(page, spaceId, spaceKey, `Training ${unique()}`);
  await page.goto(`${created.path}?edit=true`);
  await expect(content(page)).toHaveAttribute("contenteditable", "true");
  await content(page).click();
  await page.keyboard.type("Intro");
  await page.keyboard.press("Enter");
  for (const [address, title, status] of [
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "WLAN login", "YouTube is on the embed allowlist"],
    ["https://videos.example.net/w/8812", "Other video", "not on the embed allowlist"],
  ] as const) {
    await page.keyboard.type("/einbettung");
    await page.getByRole("option", { name: /^External embed/ }).click();
    const dialog = page.getByRole("dialog", { name: "External embed" });
    await dialog.getByRole("textbox", { name: "Address" }).fill(address);
    await expect(dialog.getByText(status)).toBeVisible();
    await dialog.getByRole("textbox", { name: "Title" }).fill(title);
    await dialog.getByRole("button", { name: "Insert embed" }).click();
    await expect(dialog).toBeHidden();
    await page.keyboard.press("Control+End");
  }
  await waitSaved(page);
  await callApi(page, "PUT", `/api/v1/pages/${created.id}/content`, {
    document: {
      type: "doc",
      content: [
        ...Array.from({ length: 60 }, (_, index) => paragraph(`Line ${index + 1}`)),
        { type: "embed", attrs: { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", title: "WLAN login" } },
        { type: "embed", attrs: { url: "https://videos.example.net/w/8812", title: "Other video" } },
        { type: "embed", attrs: { url: "https://vimeo.com/76979871", title: "Vimeo video" } },
      ],
    },
  });
  frames.length = 0;
  await page.goto(created.path);
  await expect(page.getByText("Line 1", { exact: true })).toBeVisible();
  await expect(page.getByText("Embedded from YouTube")).toBeAttached();
  expect(frames).toEqual([]);
  await page.getByText("Embedded from YouTube").scrollIntoViewIfNeeded();
  const frame = page.frameLocator('iframe[title="WLAN login"]');
  await expect(frame.getByText("Video player")).toBeVisible();
  expect(frames[0]).toContain("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
  await expect(page.locator('iframe[title="WLAN login"]')).toHaveAttribute("referrerpolicy", "strict-origin");
  await page.getByText("Embedded from Vimeo").scrollIntoViewIfNeeded();
  await expect(page.frameLocator('iframe[title="Vimeo video"]').getByText("Video player")).toBeVisible();
  await expect(page.locator('iframe[title="Vimeo video"]')).toHaveAttribute("referrerpolicy", "no-referrer");
  const origin = new URL(page.url()).origin;
  expect(referrers.get("www.youtube-nocookie.com")).toBe(`${origin}/`);
  expect(referrers.get("player.vimeo.com") ?? null).toBeNull();
  await expect(page.getByRole("link", { name: "https://videos.example.net/w/8812" })).toBeVisible();
  await expect(page.getByText(/Not on the embed allowlist/)).toBeVisible();
  await expect(page.locator('iframe[title="Other video"]')).toHaveCount(0);
});

test("switches tabs with the mouse and the keyboard and opens a whiteboard from its block", async ({
  page,
  organization,
}) => {
  const { spaceId, spaceKey } = await space(page, organization);
  const board = (await callApi(page, "POST", `/api/v1/spaces/${spaceId}/items`, {
    kind: "whiteboard",
    title: "Netzwerk-Umbau 2027",
    parentId: null,
  })) as { id: string };
  const created = await createPage(page, spaceId, spaceKey, `Setup ${unique()}`);
  await callApi(page, "PUT", `/api/v1/pages/${created.id}/content`, {
    document: {
      type: "doc",
      content: [
        {
          type: "tabs",
          content: ["Windows", "macOS", "Linux"].map((title) => ({
            type: "tab",
            attrs: { title },
            content: [paragraph(`${title} steps`)],
          })),
        },
        { type: "whiteboard", attrs: { whiteboardId: board.id } },
      ],
    },
  });
  await page.goto(created.path);
  const tabs = page.getByRole("tablist");
  await expect(page.getByText("Windows steps")).toBeVisible();
  await expect(page.getByText("macOS steps")).toBeHidden();
  await tabs.getByRole("tab", { name: "macOS" }).click();
  await expect(page.getByText("macOS steps")).toBeVisible();
  await expect(page.getByText("Windows steps")).toBeHidden();
  await page.keyboard.press("ArrowRight");
  await expect(tabs.getByRole("tab", { name: "Linux" })).toBeFocused();
  await expect(page.getByRole("tabpanel", { name: "Linux" })).toContainText("Linux steps");

  await page.locator(".ph-whiteboard-card").getByText("Netzwerk-Umbau 2027").click();
  await expect(page).toHaveURL(new RegExp(`/whiteboards/${board.id}/`));
});
