import type { Page } from "@playwright/test";
import { expect, type Organization, test } from "../support/fixtures.js";
import { callApi } from "../support/helpers.js";
import { unique } from "../support/people.js";
import { createPage } from "../support/places.js";

test.use({ instanceAdministrator: true });

interface Board {
  spaceId: string;
  spaceKey: string;
}

async function teamSpace(page: Page, organization: Organization): Promise<Board> {
  await page.goto("/spaces");
  const spaceKey = `WB${unique()}`;
  const space = (await callApi(page, "POST", `/api/v1/organizations/${organization.id}/spaces`, {
    name: `Whiteboards ${spaceKey}`,
    key: spaceKey,
    visibility: "organization",
    grants: [{ principalKind: "organizationMembers", principalId: null, role: "editor" }],
  })) as { id: string };
  return { spaceId: space.id, spaceKey };
}

function canvas(page: Page) {
  return page.locator("canvas.excalidraw__canvas.interactive");
}

async function drawRectangle(page: Page, at = 0.6) {
  const box = await canvas(page).boundingBox();
  if (!box) throw new Error("The whiteboard canvas is not visible");
  const x = box.x + box.width * at;
  const y = box.y + box.height * at;
  await page.keyboard.press("r");
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 140, y + 90, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.press("Escape");
}

function paintedPixels(page: Page): Promise<number> {
  return page.evaluate(() => {
    const element = document.querySelector<HTMLCanvasElement>("canvas.excalidraw__canvas.static");
    const context = element?.getContext("2d");
    if (!element || !context) return 0;
    const { data } = context.getImageData(0, 0, element.width, element.height);
    let painted = 0;
    for (let index = 0; index < data.length; index += 16) {
      const red = data[index] ?? 255;
      const green = data[index + 1] ?? 255;
      const blue = data[index + 2] ?? 255;
      if (red < 200 || green < 200 || blue < 200) painted += 1;
    }
    return painted;
  });
}

async function storedScene(page: Page, itemId: string) {
  const response = await page.request.get(`/api/v1/whiteboards/${itemId}/scene`);
  expect(response.ok()).toBe(true);
  return (await response.json()) as { scene: { elements: { type: string; text?: string }[] } };
}

test("creates a whiteboard, draws a shape and a sticky note, and a second person sees them live", async ({
  page,
  organization,
}) => {
  const { spaceKey } = await teamSpace(page, organization);
  const colleague = await organization.invite("Julia");
  await page.goto(`/spaces/${spaceKey}`);
  await page.getByRole("button", { name: "Create in this space" }).click();
  await page.getByRole("menuitem", { name: "New whiteboard" }).click();
  const dialog = page.getByRole("dialog", { name: "New whiteboard" });
  await dialog.getByLabel("Title").fill("Netzwerk-Umbau 2027");
  await dialog.getByRole("button", { name: "Create whiteboard" }).click();
  await expect(page).toHaveURL(/\/whiteboards\/[0-9a-f-]+\/netzwerk-umbau-2027$/);
  await expect(canvas(page)).toBeVisible({ timeout: 30_000 });
  const itemId = page.url().split("/whiteboards/")[1]?.split("/")[0] ?? "";

  const second = await organization.signIn(colleague);
  try {
    await second.page.goto(page.url());
    await expect(canvas(second.page)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("list", { name: "2 people on this page" })).toBeVisible({ timeout: 15_000 });
    const before = await paintedPixels(second.page);

    await canvas(page).click({ position: { x: 400, y: 300 } });
    await drawRectangle(page);
    await page.getByRole("button", { name: "Sticky note" }).click();

    await expect.poll(() => paintedPixels(second.page), { timeout: 20_000 }).toBeGreaterThan(before + 50);
    await expect(page.getByRole("status").getByText("Saved", { exact: true })).toBeVisible({
      timeout: 20_000,
    });
    await expect
      .poll(async () =>
        (await storedScene(page, itemId)).scene.elements.map((element) => element.type).sort(),
      )
      .toEqual(["rectangle", "rectangle", "text"]);
    const scene = await storedScene(second.page, itemId);
    expect(scene.scene.elements.some((element) => element.text === "Note")).toBe(true);

    await expect
      .poll(async () => (await page.request.get(`/api/v1/whiteboards/${itemId}/preview`)).status(), {
        timeout: 20_000,
      })
      .toBe(200);
  } finally {
    await second.context.close();
  }
});

test("shows a whiteboard read-only on phones and explains where to edit it", async ({
  page,
  organization,
}) => {
  const { spaceId, spaceKey } = await teamSpace(page, organization);
  const created = (await callApi(page, "POST", `/api/v1/spaces/${spaceId}/items`, {
    kind: "whiteboard",
    title: "Retro",
    parentId: null,
  })) as { id: string };
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto(`/spaces/${spaceKey}/whiteboards/${created.id}/retro`);
  await expect(page.getByText("On phones you can view and zoom the whiteboard.")).toBeVisible();
  await expect(canvas(page)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Sticky note" })).toHaveCount(0);
});

test("inserts a drawing block into a page and shows its image to readers", async ({ page, organization }) => {
  const { spaceId, spaceKey } = await teamSpace(page, organization);
  const created = await createPage(page, spaceId, spaceKey, "Standort Graz");
  await page.goto(`${created.path}?edit=true`);
  const content = page.getByRole("textbox", { name: "Page content" });
  await expect(content).toBeEditable();
  await content.focus();
  await page.keyboard.type("Skizze vom Workshop");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/drawing");
  await expect(page.getByRole("option", { name: /^Drawing/ })).toBeVisible();
  await page.keyboard.press("Enter");
  const editor = page.getByRole("dialog", { name: "Edit drawing" });
  await expect(editor).toBeVisible();
  await expect(canvas(page)).toBeVisible({ timeout: 30_000 });
  await canvas(page).click({ position: { x: 400, y: 300 } });
  await drawRectangle(page);
  await editor.getByRole("button", { name: "Save drawing" }).click();
  await expect(editor).toBeHidden({ timeout: 20_000 });
  await expect(page.locator(".ph-drawing img")).toBeVisible();
  await expect(page.getByRole("status").getByText("Saved", { exact: true })).toBeVisible({ timeout: 20_000 });

  const attachments = (await (await page.request.get(`/api/v1/pages/${created.id}/attachments`)).json()) as {
    name: string;
  }[];
  expect(attachments.map((attachment) => attachment.name).sort()).toEqual([
    expect.stringMatching(/^drawing-[0-9a-f-]+\.excalidraw$/),
    expect.stringMatching(/^drawing-[0-9a-f-]+\.svg$/),
  ]);
  await page.goto(created.path);
  await expect(page.locator("figure.ph-drawing img")).toBeVisible();
});

test("shows the stored scene after a reload and to a person who joins later, and both see live changes", async ({
  page,
  organization,
}) => {
  const { spaceId, spaceKey } = await teamSpace(page, organization);
  const colleague = await organization.invite("Konrad");
  const created = (await callApi(page, "POST", `/api/v1/spaces/${spaceId}/items`, {
    kind: "whiteboard",
    title: "Office move plan",
    parentId: null,
  })) as { id: string };
  const path = `/spaces/${spaceKey}/whiteboards/${created.id}/office-move-plan`;
  await page.goto(path);
  await expect(canvas(page)).toBeVisible({ timeout: 30_000 });
  const empty = await paintedPixels(page);
  await canvas(page).click({ position: { x: 400, y: 300 } });
  await drawRectangle(page);
  await page.getByRole("button", { name: "Sticky note" }).click();
  await expect(page.getByRole("status").getByText("Saved", { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect.poll(async () => (await storedScene(page, created.id)).scene.elements.length).toBe(3);

  await page.reload();
  await expect(canvas(page)).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => paintedPixels(page), { timeout: 20_000 }).toBeGreaterThan(empty + 50);
  const reloaded = await paintedPixels(page);

  const second = await organization.signIn(colleague);
  try {
    await second.page.goto(path);
    await expect(canvas(second.page)).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => paintedPixels(second.page), { timeout: 20_000 }).toBeGreaterThan(empty + 50);
    const joined = await paintedPixels(second.page);

    await canvas(second.page).click({ position: { x: 200, y: 150 } });
    await drawRectangle(second.page, 0.3);
    await expect.poll(() => paintedPixels(second.page), { timeout: 20_000 }).toBeGreaterThan(joined + 50);
    await expect
      .poll(async () => (await storedScene(page, created.id)).scene.elements.length, { timeout: 20_000 })
      .toBe(4);
    await expect.poll(() => paintedPixels(page), { timeout: 20_000 }).toBeGreaterThan(reloaded + 50);
  } finally {
    await second.context.close();
  }
});
