import { idIn, pagePath as numberedPagePath } from "../support/addresses.js";
import { collaborationSpace, paragraph, publishedPost, vpnPage } from "../support/collaboration.js";
import { expect, test } from "../support/fixtures.js";
import { callApi, expectAccessible } from "../support/helpers.js";
import { publishScheduledPostNow } from "../support/jobs.js";
import { unique } from "../support/people.js";

test("two people discuss a page with comments, reactions, a mention and a task", async ({
  page,
  organization,
}) => {
  const space = await collaborationSpace(page, organization);
  const { path: pagePath } = await vpnPage(page, space);

  const { page: other } = await organization.signIn(space.colleague);
  await other.getByRole("button", { name: /Notifications, \d unread/ }).click();
  await expect(other.getByText(/mentioned you in VPN access/)).toBeVisible();
  await expect(other.getByText(/assigned a task in VPN access/)).toBeVisible();
  await other.keyboard.press("Escape");

  await other.goto(pagePath);
  const paragraph = other.getByText("Hotel Wi-Fi blocks UDP on port 51820.");
  await paragraph.selectText();
  await other.getByRole("button", { name: "Comment", exact: true }).first().click();
  const popover = other.getByRole("dialog", { name: "Comments" });
  await popover.getByRole("textbox", { name: "Comment on the selected text" }).click();
  await other.keyboard.type("Happened twice this week.");
  await popover.getByRole("button", { name: "Comment", exact: true }).click();
  await expect(popover.getByText("Happened twice this week.")).toBeVisible();
  await expectAccessible(other, "comment popover");
  await other.keyboard.press("Escape");
  await expect(popover).toBeHidden();

  await page.goto(pagePath);
  await page.getByRole("button", { name: "1 open comment in this paragraph" }).click();
  const thread = page.getByRole("dialog", { name: "Comments" });
  await expect(thread.getByText("Happened twice this week.")).toBeVisible();
  await thread.getByRole("textbox", { name: "Reply" }).click();
  await page.keyboard.type("Let us document the fallback.");
  await thread.getByRole("button", { name: "Reply", exact: true }).last().click();
  await expect(thread.getByText("Let us document the fallback.")).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByRole("textbox", { name: "New comment on the page" }).click();
  await page.keyboard.type("Thanks for the overview.");
  await page
    .getByRole("region", { name: /^Comments/ })
    .getByRole("button", { name: "Comment", exact: true })
    .click();
  await other.reload();
  await expect(
    other.getByRole("region", { name: /^Comments/ }).getByText("Thanks for the overview."),
  ).toBeVisible();

  await page.getByRole("button", { name: "Add reaction" }).first().click();
  await page.getByRole("button", { name: "React with 🎉" }).click();
  await expect(other.getByRole("button", { name: /🎉 1/ })).toBeVisible();

  await other.getByRole("checkbox", { name: /Mark as done: Test the TCP fallback/ }).click();
  await expect(other.getByRole("checkbox", { name: /Mark as open: Test the TCP fallback/ })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: /Mark as open: Test the TCP fallback/ })).toBeChecked();

  await other.goto("/tasks?view=done");
  await expect(other.getByText("Test the TCP fallback")).toBeVisible();
  await expectAccessible(other, "my tasks");
});

test("one task status in the editor, the read view, My tasks, the task report and pasted Markdown", async ({
  page,
  organization,
}) => {
  const space = await collaborationSpace(page, organization);
  const checklist = (await callApi(page, "POST", `/api/v1/spaces/${space.id}/items`, {
    kind: "page",
    title: "Rollout checklist",
    parentId: null,
    mode: "publish",
  })) as { id: string; number: number; title: string };
  await callApi(page, "PUT", `/api/v1/pages/${checklist.id}/content`, {
    document: {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Before the rollout:" }] },
        {
          type: "taskList",
          content: [
            {
              type: "taskItem",
              attrs: { assignee: space.colleague.id },
              content: [
                { type: "paragraph", content: [{ type: "text", text: "Update the firewall rules" }] },
              ],
            },
          ],
        },
      ],
    },
  });
  await callApi(page, "POST", `/api/v1/pages/${checklist.id}/publish`, {});
  const report = (await callApi(page, "POST", `/api/v1/spaces/${space.id}/items`, {
    kind: "page",
    title: "Rollout report",
    parentId: null,
    mode: "live",
  })) as { id: string; number: number; title: string };
  await callApi(page, "PUT", `/api/v1/pages/${report.id}/content`, {
    document: { type: "doc", content: [{ type: "taskReport", attrs: { spaceId: space.id, status: "all" } }] },
  });
  const checklistPath = numberedPagePath(space.key, checklist);
  const task = { name: /Update the firewall rules/ };

  const { page: other } = await organization.signIn(space.colleague);
  await other.goto(checklistPath);
  const readView = other.getByRole("checkbox", task);
  await page.goto(`${checklistPath}?edit=true`);
  const editorView = page.getByRole("checkbox", task);
  await expect(editorView).toBeEnabled();

  await editorView.click();
  await expect(editorView).toBeChecked();
  await expect(readView).toBeChecked();
  await readView.click();
  await expect(editorView).not.toBeChecked();

  const myTasks = await other.context().newPage();
  await myTasks.goto("/tasks");
  await myTasks.getByRole("checkbox", task).click();
  await expect(readView).toBeChecked();
  await expect(editorView).toBeChecked();

  const reportView = await page.context().newPage();
  await reportView.goto(numberedPagePath(space.key, report));
  await reportView.getByRole("checkbox", task).click();
  await expect(readView).not.toBeChecked();
  await expect(editorView).not.toBeChecked();
  await myTasks.close();
  await reportView.close();

  await page.getByRole("textbox", { name: "Page content" }).locator("p").last().click();
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.evaluate(() => navigator.clipboard.writeText("- [x] Order the badges\n- [ ] Book the room"));
  await page.keyboard.press("ControlOrMeta+V");
  await expect(page.getByRole("checkbox", { name: "Mark as open: Order the badges" })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Mark as done: Book the room" })).not.toBeChecked();
  await expect(page.getByRole("status").getByText("Saved to draft", { exact: true })).toBeVisible({
    timeout: 20_000,
  });
  await callApi(page, "POST", `/api/v1/pages/${checklist.id}/publish`, {});
  const pasted = (text: string) =>
    other.getByRole("listitem").filter({ hasText: text }).getByRole("checkbox");
  await expect(pasted("Order the badges")).toBeChecked();
  await expect(pasted("Book the room")).not.toBeChecked();
});

test("schedules a blog post that the job publishes, and pins it in the organization overview", async ({
  page,
  organization,
}) => {
  const space = await collaborationSpace(page, organization);
  await page.goto(`/spaces/${space.key}/blog`);
  await page.getByRole("button", { name: "New post" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "Title" }).fill("New VPN client from Monday");
  await dialog.getByRole("textbox", { name: "Excerpt" }).fill("Existing tunnels keep working.");
  await expectAccessible(page, "new blog post dialog");
  await dialog.getByRole("button", { name: "Create post" }).click();
  await expect(page.getByRole("textbox", { name: "Page content" })).toBeEditable();
  await expect(page.getByRole("textbox", { name: "Page content" })).toHaveAttribute(
    "contenteditable",
    "true",
  );
  await expect(page.locator("[data-page-bar]").getByRole("button", { name: "Done" })).toBeVisible();
  const postId = await idIn(page, "blog");
  await page.getByRole("textbox", { name: "Page content" }).click();
  await page.keyboard.type("The company portal ships the new client on Monday.");
  await expect(page.getByRole("status").getByText("Saved to draft", { exact: true })).toBeVisible({
    timeout: 20_000,
  });
  await callApi(page, "PUT", `/api/v1/blog-posts/${postId}/schedule`, {
    at: new Date(Date.now() + 60 * 60_000).toISOString(),
    timeZone: "Europe/Vienna",
  });
  await page.goto(`/spaces/${space.key}/blog`);
  await expect(
    page.getByRole("region", { name: "Scheduled" }).getByRole("link", { name: "New VPN client from Monday" }),
  ).toBeVisible();
  await publishScheduledPostNow(postId);
  await expect
    .poll(
      async () =>
        ((await (await page.request.get(`/api/v1/blog-posts/${postId}`)).json()) as { published: boolean })
          .published,
      { timeout: 30_000, intervals: [500] },
    )
    .toBe(true);

  await page.goto("/blog");
  const post = page.getByRole("listitem").filter({ hasText: "New VPN client from Monday" });
  await post.getByRole("button", { name: "Pin New VPN client from Monday" }).click();
  await expect(post.getByText("Pinned", { exact: true })).toBeVisible();
});

test("shows recent pages, starred items, tasks, mentions and new posts on For you", async ({
  page,
  organization,
}) => {
  const space = await collaborationSpace(page, organization);
  const { path: pagePath } = await vpnPage(page, space);
  await publishedPost(page, space);
  const { page: other } = await organization.signIn(space.colleague);
  await other.goto(pagePath);
  await other.getByRole("button", { name: "More actions" }).click();
  await other.getByRole("menuitem", { name: "Add to starred" }).click();
  await expect(other.getByText("VPN access starred", { exact: true })).toBeVisible();
  await other.goto("/home");
  const main = other.getByRole("main");
  await expect(main.getByRole("link", { name: /VPN access/ }).first()).toBeVisible();
  await expect(main.getByText("New VPN client from Monday")).toBeVisible();
  await expect(
    main.getByRole("region", { name: "Mentions" }).getByRole("link", { name: /VPN access/ }),
  ).toBeVisible();
  await expectAccessible(other, "For you");
});

test("shows where other people edit: a caret with their name and their selection in their color", async ({
  page,
  organization,
}) => {
  await page.goto("/spaces");
  const people = [await organization.invite("Carla"), await organization.invite("Dario")];
  const key = `PR${unique()}`;
  const space = (await callApi(page, "POST", `/api/v1/organizations/${organization.id}/spaces`, {
    name: "Presence",
    key,
    visibility: "private",
    grants: people.map((person) => ({ principalKind: "account", principalId: person.id, role: "editor" })),
  })) as { id: string };
  const created = (await callApi(page, "POST", `/api/v1/spaces/${space.id}/items`, {
    kind: "page",
    title: "Rotation",
    parentId: null,
    mode: "live",
  })) as { id: string; number: number; title: string };
  const lines = ["The rotation changes every Monday.", "Swap shifts in the on-call calendar."];
  await callApi(page, "PUT", `/api/v1/pages/${created.id}/content`, {
    document: { type: "doc", content: lines.map((line) => paragraph(line)) },
  });
  const address = `${numberedPagePath(key, created)}?edit=true`;
  const content = (target: typeof page) => target.getByRole("textbox", { name: "Page content" });

  await page.goto(address);
  await expect(content(page)).toBeEditable({ timeout: 30_000 });
  const viewers: (typeof page)[] = [];
  for (const [index, person] of people.entries()) {
    const { page: other } = await organization.signIn(person);
    viewers.push(other);
    await other.goto(address);
    await expect(content(other)).toBeEditable({ timeout: 30_000 });
    await content(other)
      .getByText(lines[index] ?? "", { exact: true })
      .selectText();
  }

  const coEditors = page.getByRole("list", { name: "2 people are editing" });
  await expect(coEditors).toBeVisible({ timeout: 20_000 });
  const avatars = coEditors.locator(".ld-presence-avatar");
  const [first, second] = await Promise.all([avatars.nth(0).boundingBox(), avatars.nth(1).boundingBox()]);
  expect(first && second && first.x + first.width <= second.x).toBe(true);

  for (const [index, person] of people.entries()) {
    const line = content(page).getByText(lines[index] ?? "", { exact: true });
    const label = page.locator(".ld-remote-caret-label", { hasText: person.name });
    await expect(label).toBeVisible();
    const caret = await page.locator(".ld-remote-caret").filter({ has: label }).boundingBox();
    const box = await line.boundingBox();
    expect(caret && box && caret.height > 0 && Math.abs(caret.y - box.y) < box.height).toBe(true);
    const avatarColor = await coEditors
      .getByRole("listitem")
      .filter({ hasText: `${person.name} is editing` })
      .locator(".ld-presence-avatar")
      .getAttribute("data-color");
    await expect(
      content(page).locator(".ld-remote-selection", { hasText: lines[index] ?? "" }),
    ).toHaveAttribute("data-color", avatarColor ?? "");
    await expect(page.locator(".ld-remote-caret").filter({ has: label })).toHaveAttribute(
      "data-color",
      avatarColor ?? "",
    );
  }
  const colors = await avatars.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("data-color")),
  );
  expect(new Set(colors).size).toBe(people.length);
  const colorOf = (viewer: typeof page, name: string) =>
    viewer
      .getByRole("list", { name: /people? (is|are) editing/ })
      .getByRole("listitem")
      .filter({ hasText: `${name} is editing` })
      .locator(".ld-presence-avatar")
      .getAttribute("data-color");
  const [carlaView, dario] = [viewers[0], people[1]];
  if (!carlaView || !dario) throw new Error("The test needs two co-editors");
  await expect(carlaView.getByRole("list", { name: "2 people are editing" })).toBeVisible();
  expect(await colorOf(carlaView, dario.name)).toBe(await colorOf(page, dario.name));

  await page.goto(numberedPagePath(key, created));
  const editing = page.getByRole("list", { name: "2 people are editing" });
  await expect(editing).toBeVisible({ timeout: 20_000 });
  const [left, right] = await Promise.all([
    editing.getByRole("listitem").nth(0).boundingBox(),
    editing.getByRole("listitem").nth(1).boundingBox(),
  ]);
  expect(left && right && left.x + left.width <= right.x).toBe(true);
});
