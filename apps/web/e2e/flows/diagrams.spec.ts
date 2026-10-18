import type { Page } from "@playwright/test";
import { expect, type Organization, test } from "../support/fixtures.js";
import { callApi } from "../support/helpers.js";
import { unique } from "../support/people.js";
import { createPage } from "../support/places.js";

async function teamSpace(page: Page, organization: Organization) {
  await page.goto("/spaces");
  const spaceKey = `DG${unique()}`;
  const space = (await callApi(page, "POST", `/api/v1/organizations/${organization.id}/spaces`, {
    name: `Diagrams ${spaceKey}`,
    key: spaceKey,
    visibility: "organization",
    grants: [{ principalKind: "organizationMembers", principalId: null, role: "editor" }],
  })) as { id: string };
  return { spaceId: space.id, spaceKey };
}

function outsideRequests(page: Page): string[] {
  const outside: string[] = [];
  const own = new URL(page.url() || "http://localhost").host;
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.protocol === "data:" || url.protocol === "blob:") return;
    if (url.host !== own) outside.push(request.url());
  });
  return outside;
}

async function insertBlock(page: Page, command: string, option: RegExp) {
  const content = page.getByRole("textbox", { name: "Page content" });
  await expect(content).toBeEditable();
  await expect(page.getByText("Saved").or(page.getByText("Editing")).first()).toBeVisible();
  await content.click();
  await content.press("Control+End");
  await content.press("Enter");
  await content.pressSequentially(command);
  await expect(page.getByRole("option", { name: option })).toBeVisible();
  await page.keyboard.press("Enter");
}

test("inserts a draw.io diagram, edits it in the overlay without outside requests and shows it in the page", async ({
  page,
  organization,
}) => {
  const { spaceId, spaceKey } = await teamSpace(page, organization);
  const created = await createPage(page, spaceId, spaceKey, "Netzwerkplan Graz");
  await page.goto(`${created.path}?edit=true`);
  const outside = outsideRequests(page);
  await insertBlock(page, "/draw.io", /^draw\.io diagram/);

  const overlay = page.getByRole("dialog", { name: "Edit draw.io diagram" });
  await expect(overlay).toBeVisible();
  await expect(overlay.getByText(/is served by this Pagehall instance/)).toBeVisible();
  const drawio = page.frameLocator('iframe[title="draw.io editor"]');
  const shape = drawio.locator(".geSidebarContainer a.geItem").first();
  await expect(shape).toBeVisible({ timeout: 45_000 });
  await shape.click();
  await overlay.getByRole("button", { name: "Save and close" }).click();
  await expect(overlay).toBeHidden({ timeout: 30_000 });

  const block = page.locator('[data-diagram="drawio"]');
  await expect(block.getByRole("img", { name: "draw.io diagram" })).toBeVisible();
  await expect(block.getByText("Version 1")).toBeVisible();
  await expect(page.getByRole("status").getByText("Saved", { exact: true })).toBeVisible({ timeout: 20_000 });
  const attachments = (await (await page.request.get(`/api/v1/pages/${created.id}/attachments`)).json()) as {
    id: string;
    name: string;
  }[];
  attachments.sort((a, b) => a.name.localeCompare(b.name));
  expect(attachments.map((attachment) => attachment.name)).toEqual([
    expect.stringMatching(/^drawio-[0-9a-f-]+\.drawio$/),
    expect.stringMatching(/^drawio-[0-9a-f-]+\.svg$/),
  ]);
  const stored = await (await page.request.get(`/api/v1/attachments/${attachments[0]?.id}/content`)).text();
  expect(stored).toMatch(/<mxCell [^>]*vertex="1"/);

  await block.getByRole("button", { name: "Edit in draw.io" }).click();
  await expect(shape).toBeVisible({ timeout: 45_000 });
  await page
    .getByRole("dialog", { name: "Edit draw.io diagram" })
    .getByRole("button", { name: "Cancel" })
    .click();
  await expect(page.getByRole("dialog", { name: "Edit draw.io diagram" })).toBeHidden();
  expect(outside).toEqual([]);

  await page.goto(created.path);
  await expect(page.locator('figure.ph-diagram[data-diagram="drawio"] img')).toBeVisible();
});

test("tells a second person who is editing a draw.io diagram", async ({ page, organization }) => {
  const { spaceId, spaceKey } = await teamSpace(page, organization);
  const created = await createPage(page, spaceId, spaceKey, "Serverraum");
  await page.goto(`${created.path}?edit=true`);
  await insertBlock(page, "/draw.io", /^draw\.io diagram/);
  const overlay = page.getByRole("dialog", { name: "Edit draw.io diagram" });
  await expect(overlay).toBeVisible();
  await overlay.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("status").getByText("Saved", { exact: true })).toBeVisible({ timeout: 20_000 });

  const bea = await organization.invite("Bea");
  const second = await organization.signIn(bea);
  await second.page.goto(`${created.path}?edit=true`);
  const block = second.page.locator('[data-diagram="drawio"]');
  await expect(block.getByRole("button", { name: "Edit in draw.io" })).toBeVisible();

  await page.locator('[data-diagram="drawio"]').getByRole("button", { name: "Edit in draw.io" }).click();
  await expect(page.getByRole("dialog", { name: "Edit draw.io diagram" })).toBeVisible();
  await expect(block.getByRole("status")).toHaveText(`${organization.admin.name} is editing this diagram`);
  await expect(block.getByRole("button", { name: "Edit in draw.io" })).toBeHidden();
  await page
    .getByRole("dialog", { name: "Edit draw.io diagram" })
    .getByRole("button", { name: "Cancel" })
    .click();
  await expect(block.getByRole("button", { name: "Edit in draw.io" })).toBeVisible();
});

test("renders a Mermaid block in the sandbox, keeps the last good image on errors and stores it", async ({
  page,
  organization,
}) => {
  const { spaceId, spaceKey } = await teamSpace(page, organization);
  const created = await createPage(page, spaceId, spaceKey, "Ablauf bei Störungen");
  await page.goto(`${created.path}?edit=true`);
  const outside = outsideRequests(page);
  await insertBlock(page, "/mermaid", /^Mermaid diagram/);

  const block = page.locator('[data-diagram="mermaid"]');
  const source = block.getByLabel("Source of the Mermaid diagram");
  await expect(source).toBeVisible();
  await source.fill("flowchart LR\n  A[Incident reported] --> B[Ticket]");
  await expect(block.getByRole("img", { name: "Mermaid diagram" })).toBeVisible({ timeout: 20_000 });
  await source.fill("flowchart LR\n  A[Incident reported] --> B[Ticket\n  B --> ");
  await expect(block.getByText("The diagram cannot be shown yet")).toBeVisible({ timeout: 20_000 });
  await expect(block.getByRole("img", { name: "Mermaid diagram" })).toBeVisible();
  await expect(block.getByText(/^Line 2 of the source has an error/)).toBeVisible();
  await expect(block.getByText(/Expecting/)).toBeHidden();
  await block.getByText("Details", { exact: true }).click();
  await expect(block.getByText(/Expecting/)).toBeVisible();
  await source.fill('flowchart LR\n  A[Incident reported] --> B[Ticket]\n  click A "https://evil.example"');
  await block.getByRole("button", { name: "Save diagram" }).click();
  await expect(source).toBeHidden({ timeout: 20_000 });
  await expect(block.getByRole("img", { name: "Mermaid diagram" })).toBeVisible();
  await expect(page.getByRole("status").getByText("Saved", { exact: true })).toBeVisible({ timeout: 20_000 });

  await block.getByRole("radio", { name: "Source" }).click();
  await expect(block.getByText("A[Incident reported] --> B[Ticket]")).toBeVisible();
  expect(outside).toEqual([]);

  const attachments = (await (await page.request.get(`/api/v1/pages/${created.id}/attachments`)).json()) as {
    id: string;
    name: string;
  }[];
  const image = attachments.find((attachment) => /^mermaid-[0-9a-f-]+\.svg$/.test(attachment.name));
  expect(image).toBeDefined();
  const svg = await (await page.request.get(`/api/v1/attachments/${image?.id}/content`)).text();
  expect(svg).toContain(">Incident<");
  expect(svg).toContain("> reported<");
  expect(svg).not.toContain("evil.example");
  expect(svg).not.toContain("foreignObject");

  await page.goto(created.path);
  await expect(page.locator('figure.ph-diagram[data-diagram="mermaid"] img')).toBeVisible();
});

test("refuses PlantUML includes and renders PlantUML in the browser", async ({ page, organization }) => {
  const { spaceId, spaceKey } = await teamSpace(page, organization);
  const created = await createPage(page, spaceId, spaceKey, "Sequenz");
  await page.goto(`${created.path}?edit=true`);
  const outside = outsideRequests(page);
  await insertBlock(page, "/plantuml", /^PlantUML diagram/);
  const block = page.locator('[data-diagram="plantuml"]');
  const source = block.getByLabel("Source of the PlantUML diagram");
  await expect(source).toBeFocused();
  await block.getByRole("button", { name: "Cancel" }).click();
  await expect(block).toHaveCount(0);
  await insertBlock(page, "/plantuml", /^PlantUML diagram/);
  await source.fill("@startuml\n!include https://evil.example/x.puml\nAlice -> Bob: Hello\n@enduml");
  await expect(block.getByText(/Including files or addresses is turned off/)).toBeVisible({
    timeout: 20_000,
  });
  await source.fill("@startuml\nAlice -> Bob: Hello\n@enduml");
  await expect(block.getByRole("img", { name: "PlantUML diagram" })).toBeVisible({ timeout: 30_000 });
  await source.fill("@startuml\nAlice -> Bob: Hello\nthis is ((( not valid\n@enduml");
  await expect(block.getByText(/^Line 3 of the source has an error/)).toBeVisible({ timeout: 30_000 });
  await expect(block.getByText(/\$version\$|git\.commit/)).toHaveCount(0);
  await source.fill("@startuml\nAlice -> Bob: Hello\n@enduml");
  await expect(block.getByText("The diagram cannot be shown yet")).toBeHidden({ timeout: 30_000 });
  await block.getByRole("button", { name: "Save diagram" }).click();
  await expect(source).toBeHidden({ timeout: 20_000 });
  await expect(block.getByRole("img", { name: "PlantUML diagram" })).toBeVisible();
  expect(outside).toEqual([]);
});

const GLIFFY = JSON.stringify({
  contentType: "application/gliffy+json",
  version: "1.3",
  stage: {
    background: "#FFFFFF",
    width: 300,
    height: 200,
    maxWidth: 5000,
    maxHeight: 5000,
    nodeIndex: 2,
    autoFit: true,
    gridOn: true,
    drawingGuidesOn: true,
    pageBreaksOn: false,
    printGridOn: false,
    printPaper: "LETTER",
    printShrinkToFit: false,
    printPortrait: true,
    shapeStyles: {},
    lineStyles: {},
    textStyles: {},
    themeData: null,
    objects: [
      {
        x: 20,
        y: 20,
        rotation: 0,
        id: 0,
        uid: "com.gliffy.shape.basic.basic_v1.default.rectangle",
        width: 120,
        height: 60,
        lockAspectRatio: false,
        lockShape: false,
        order: 0,
        graphic: {
          type: "Shape",
          Shape: {
            tid: "com.gliffy.stencil.rectangle.basic_v1",
            strokeWidth: 2,
            strokeColor: "#333333",
            fillColor: "#FFFFFF",
            gradient: false,
            dropShadow: false,
            state: 0,
            shadowX: 0,
            shadowY: 0,
            opacity: 1,
          },
        },
        children: [
          {
            x: 2,
            y: 0,
            rotation: 0,
            id: 1,
            uid: null,
            width: 116,
            height: 14,
            lockAspectRatio: false,
            lockShape: false,
            order: "auto",
            graphic: {
              type: "Text",
              Text: {
                tid: null,
                valign: "middle",
                overflow: "none",
                vposition: "none",
                hposition: "none",
                html: '<p style="text-align:center;"><span>Core switch</span></p>',
                paddingLeft: 2,
                paddingRight: 2,
                paddingBottom: 2,
                paddingTop: 2,
              },
            },
            children: null,
          },
        ],
      },
    ],
    layers: [
      { guid: "l1", order: 0, name: "Layer 0", active: true, locked: false, visible: true, nodeIndex: 2 },
    ],
  },
  metadata: { title: "untitled", revision: 0, exportBorder: false, loadPosition: "default", libraries: [] },
  embeddedResources: { index: 0, resources: [] },
});

test("converts a Gliffy diagram to draw.io when it is first edited", async ({ page, organization }) => {
  const { spaceId, spaceKey } = await teamSpace(page, organization);
  const created = await createPage(page, spaceId, spaceKey, "Grundriss");
  const upload = await page.request.post(`/api/v1/pages/${created.id}/attachments?name=Floor%20plan`, {
    data: Buffer.from(GLIFFY),
    headers: {
      "content-type": "application/octet-stream",
      "X-Pagehall-Request": "1",
      origin: new URL(page.url()).origin,
    },
  });
  expect(upload.status(), await upload.text()).toBe(201);
  const gliffy = (await upload.json()) as { id: string; version: number };
  await callApi(page, "PUT", `/api/v1/pages/${created.id}/content`, {
    document: {
      type: "doc",
      content: [
        {
          type: "drawio",
          attrs: {
            id: "01929b1e-0000-7000-8000-0000000000aa",
            sourceFormat: "gliffy",
            sourceId: gliffy.id,
            sourceVersion: gliffy.version,
          },
        },
      ],
    },
  });
  await page.goto(`${created.path}?edit=true`);
  const block = page.locator('[data-diagram="drawio"]');
  await expect(block.getByText(/Imported from Gliffy/)).toBeVisible();
  await block.getByRole("button", { name: "Edit in draw.io" }).click();
  const overlay = page.getByRole("dialog", { name: "Edit draw.io diagram" });
  const drawio = page.frameLocator('iframe[title="draw.io editor"]');
  await expect(drawio.getByText("Core switch")).toBeVisible({ timeout: 45_000 });
  await overlay.getByRole("button", { name: "Save and close" }).click();
  await expect(overlay).toBeHidden({ timeout: 30_000 });
  await expect(block.getByText(/Imported from Gliffy/)).toBeHidden();
  await expect(block.getByRole("img", { name: "draw.io diagram" })).toBeVisible();
  const attachments = (await (await page.request.get(`/api/v1/pages/${created.id}/attachments`)).json()) as {
    id: string;
    name: string;
  }[];
  const converted = attachments.find((attachment) => attachment.name.endsWith(".drawio"));
  expect(converted).toBeDefined();
  const xml = await (await page.request.get(`/api/v1/attachments/${converted?.id}/content`)).text();
  expect(xml).toContain("Core switch");
  expect(attachments.map((attachment) => attachment.name)).toContain("Floor plan");
});
