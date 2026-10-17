import { randomUUID } from "node:crypto";
import { accountAttemptLimitSetting, clientAttemptLimitSetting } from "@pagehall/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addTotp,
  completeConfiguredSetup,
  configuredSetupEnv,
  createAccount,
  firstOrganizationId,
  OWNER,
  signedInClient,
} from "../testing/accounts.js";
import { type AuthTestApp, createAuthTestApp, databaseBaseUrl, TestClient } from "../testing/auth-app.js";

function bearer(token: string) {
  return { authorization: `Bearer ${token}` };
}

function paragraph(text: string) {
  return { type: "paragraph", content: [{ type: "text", text }] };
}

describe.skipIf(!databaseBaseUrl)("spaces and pages through the API", () => {
  let test: AuthTestApp;
  let owner: TestClient;
  let organizationId: string;
  let counter = 0;

  beforeAll(async () => {
    test = await createAuthTestApp(configuredSetupEnv);
    await completeConfiguredSetup(test);
    await test.runtime.settings.set(clientAttemptLimitSetting, {}, "instance", 10_000);
    await test.runtime.settings.set(accountAttemptLimitSetting, {}, "instance", 1000);
    owner = new TestClient(test.app);
    await owner.post("/api/v1/auth/sign-in", OWNER);
    await addTotp(owner);
    organizationId = await firstOrganizationId(test);
  });

  afterAll(async () => {
    await test?.close();
  });

  async function person(kind: "member" | "none" = "member") {
    counter += 1;
    const email = `person${counter}@pagehall.test`;
    const password = "a long enough passphrase";
    const id =
      kind === "member"
        ? (await createAccount(test, email, password)).id
        : (
            await test.runtime.database.transaction((tx) =>
              test.runtime.services.accounts.createStandard(tx, {
                email,
                name: `person${counter}`,
                password,
                homeOrganizationId: null,
              }),
            )
          ).id;
    return { id, client: await signedInClient(test, email, password) };
  }

  async function createSpace(client: TestClient, grants: unknown[] = [], visibility = "private") {
    counter += 1;
    const response = await client.post(`/api/v1/organizations/${organizationId}/spaces`, {
      name: `Space ${counter}`,
      key: `S${counter}X`,
      visibility,
      grants,
    });
    expect(response.statusCode, response.body).toBe(201);
    return response.json() as { id: string; key: string; overviewItemId: string };
  }

  async function createPage(
    client: TestClient,
    spaceId: string,
    title: string,
    parentId: string | null = null,
  ) {
    const response = await client.post(`/api/v1/spaces/${spaceId}/items`, {
      kind: "page",
      title,
      parentId,
      mode: "live",
    });
    expect(response.statusCode, response.body).toBe(201);
    return response.json() as { id: string; position: string };
  }

  it("creates a space with defaults from the organization and finds it by key", async () => {
    const creator = await person();
    const defaults = await creator.client.get(`/api/v1/organizations/${organizationId}/space-defaults`);
    expect(defaults.json()).toMatchObject({ visibility: "organization" });
    const suggestion = await creator.client.get(
      `/api/v1/organizations/${organizationId}/space-key-suggestion?name=${encodeURIComponent("Customer Support")}`,
    );
    expect(suggestion.json()).toMatchObject({ key: "CS", available: true });
    const space = await createSpace(creator.client);
    const byKey = await creator.client.get(`/api/v1/space-keys/${space.key.toLowerCase()}`);
    expect(byKey.json()).toMatchObject({ redirected: false, space: { id: space.id, role: "admin" } });
    const listed = await creator.client.get(`/api/v1/spaces?organizationId=${organizationId}&q=${space.key}`);
    expect(listed.json().items.map((item: { id: string }) => item.id)).toEqual([space.id]);
    const taken = await creator.client.get(`/api/v1/organizations/${organizationId}/space-keys/${space.key}`);
    expect(taken.json()).toMatchObject({ valid: true, available: false });
  });

  it("hides spaces and pages from people without access and refuses changes to readers", async () => {
    const creator = await person();
    const reader = await person();
    const outsider = await person();
    const space = await createSpace(creator.client, [
      { principalKind: "account", principalId: reader.id, role: "reader" },
    ]);
    const page = await createPage(creator.client, space.id, "Runbook");
    expect((await outsider.client.get(`/api/v1/spaces/${space.id}`)).statusCode).toBe(404);
    expect((await outsider.client.get(`/api/v1/items/${page.id}`)).statusCode).toBe(404);
    expect((await outsider.client.get(`/api/v1/pages/${page.id}/content`)).statusCode).toBe(404);
    expect((await outsider.client.get(`/api/v1/space-keys/${space.key}`)).statusCode).toBe(404);

    expect((await reader.client.get(`/api/v1/pages/${page.id}/content`)).statusCode).toBe(200);
    const writes = [
      reader.client.put(`/api/v1/pages/${page.id}/content`, {
        document: { type: "doc", content: [paragraph("x")] },
      }),
      reader.client.patch(`/api/v1/items/${page.id}`, { title: "Renamed" }),
      reader.client.post(`/api/v1/items/${page.id}/move`, { parentId: null }),
      reader.client.post(`/api/v1/items/${page.id}/convert`, { kind: "folder" }),
      reader.client.post(`/api/v1/pages/${page.id}/labels`, { label: "x" }),
      reader.client.post(`/api/v1/spaces/${space.id}/items`, { kind: "page", title: "New", parentId: null }),
      reader.client.patch(`/api/v1/spaces/${space.id}`, { name: "Renamed" }),
      reader.client.get(`/api/v1/spaces/${space.id}/permissions`),
    ];
    for (const response of await Promise.all(writes)) expect(response.statusCode, response.body).toBe(403);
    const content = await creator.client.get(`/api/v1/pages/${page.id}/content`);
    expect(JSON.stringify(content.json().document)).not.toContain('"x"');
  });

  it("stores valid content, rejects invalid content and returns Markdown and backlinks", async () => {
    const creator = await person();
    const space = await createSpace(creator.client);
    const target = await createPage(creator.client, space.id, "Target");
    const source = await createPage(creator.client, space.id, "Source");
    const stored = await creator.client.put(`/api/v1/pages/${source.id}/content`, {
      document: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "See " },
              { type: "pageLink", attrs: { pageId: target.id, spaceId: null, title: null } },
            ],
          },
        ],
      },
    });
    expect(stored.statusCode, stored.body).toBe(200);
    expect(stored.json().references.pages[target.id]).toMatchObject({ title: "Target", accessible: true });
    const invalid = await creator.client.put(`/api/v1/pages/${source.id}/content`, {
      document: { type: "doc", content: [{ type: "iframe", attrs: { src: "https://evil.example" } }] },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({ code: "invalidDocument", problems: [{ code: "unknownNode" }] });
    const markdown = await creator.client.get(`/api/v1/pages/${source.id}/markdown`);
    expect(markdown.json().markdown).toContain(`[Target](/spaces/${space.key}/pages/${target.id}/target)`);
    const backlinks = await creator.client.get(`/api/v1/pages/${target.id}/backlinks`);
    expect(backlinks.json().map((link: { itemId: string }) => link.itemId)).toEqual([source.id]);
  });

  it("lists child pages and attachments in Markdown with only what the reader may see", async () => {
    const creator = await person();
    const reader = await person();
    const space = await createSpace(creator.client, [
      { principalKind: "account", principalId: reader.id, role: "reader" },
    ]);
    const parent = await createPage(creator.client, space.id, "Parent");
    const network = await createPage(creator.client, space.id, "Network", parent.id);
    const firewall = await createPage(creator.client, space.id, "Firewall", network.id);
    const secret = await createPage(creator.client, space.id, "Secret", parent.id);
    const restricted = await creator.client.post(`/api/v1/pages/${secret.id}/access`, {
      changes: [{ action: "restrict", kind: "view" }],
    });
    expect(restricted.statusCode, restricted.body).toBe(200);
    for (const name of ["handbook.pdf", "budget.xlsx"]) {
      const upload = await creator.client.post(
        `/api/v1/pages/${parent.id}/attachments?name=${name}`,
        Buffer.from(name),
        { "content-type": "application/octet-stream" },
      );
      expect(upload.statusCode, upload.body).toBe(201);
    }
    const stored = await creator.client.put(`/api/v1/pages/${parent.id}/content`, {
      document: {
        type: "doc",
        content: [
          { type: "childPages", attrs: { depth: 1 } },
          { type: "childPages", attrs: { sort: "title", reverse: true } },
          { type: "childPages", attrs: { pageId: firewall.id } },
          { type: "attachmentList", attrs: { fileTypes: ["pdf"] } },
        ],
      },
    });
    expect(stored.statusCode, stored.body).toBe(200);
    const path = (id: string, title: string) => `/spaces/${space.key}/pages/${id}/${title.toLowerCase()}`;
    const ofCreator = (await creator.client.get(`/api/v1/pages/${parent.id}/markdown`)).json().markdown;
    expect(ofCreator).toContain(
      `- [Network](${path(network.id, "Network")})\n- [Secret](${path(secret.id, "Secret")})\n\n`,
    );
    expect(ofCreator).toContain(
      `- [Secret](${path(secret.id, "Secret")})\n- [Network](${path(network.id, "Network")})\n  - [Firewall](${path(firewall.id, "Firewall")})\n\n`,
    );
    const ofReader = (await reader.client.get(`/api/v1/pages/${parent.id}/markdown`)).json().markdown;
    expect(ofReader).not.toContain("Secret");
    expect(ofReader.trimEnd().split("\n\n")).toEqual([
      `- [Network](${path(network.id, "Network")})`,
      `- [Network](${path(network.id, "Network")})\n  - [Firewall](${path(firewall.id, "Firewall")})`,
      "*No child pages*",
      expect.stringMatching(/^- \[handbook\.pdf\]\(\/api\/v1\/attachments\/[0-9a-f-]+\/content\) \(12 B\)$/),
    ]);
  });

  it("serves page properties reports, labeled content, related labels and includes with the reader's permissions", async () => {
    const creator = await person();
    const reader = await person();
    const space = await createSpace(creator.client, [
      { principalKind: "account", principalId: reader.id, role: "reader" },
    ]);
    const properties = (owner: string) => ({
      type: "pageProperties",
      content: [
        {
          type: "pageProperty",
          content: [
            { type: "pagePropertyKey", content: [{ type: "text", text: "Owner" }] },
            { type: "pagePropertyValue", content: [paragraph(owner)] },
          ],
        },
      ],
    });
    const open = await createPage(creator.client, space.id, "Open site");
    const secret = await createPage(creator.client, space.id, "Secret site");
    for (const [page, owner] of [
      [open, "Anna"],
      [secret, "Board"],
    ] as const) {
      const stored = await creator.client.put(`/api/v1/pages/${page.id}/content`, {
        document: {
          type: "doc",
          content: [properties(owner), { type: "excerpt", content: [paragraph(`${owner} in short`)] }],
        },
      });
      expect(stored.statusCode, stored.body).toBe(200);
      for (const label of ["site", owner.toLowerCase()]) {
        expect((await creator.client.post(`/api/v1/pages/${page.id}/labels`, { label })).statusCode).toBe(
          200,
        );
      }
    }
    expect(
      (
        await creator.client.post(`/api/v1/pages/${secret.id}/access`, {
          changes: [{ action: "restrict", kind: "view" }],
        })
      ).statusCode,
    ).toBe(200);
    const report = await reader.client.get(
      `/api/v1/reports/properties?spaceIds=${space.id}&labels=site&columns=Owner&sortBy=Owner`,
    );
    expect(report.statusCode, report.body).toBe(200);
    expect(report.json()).toMatchObject({
      columns: ["Owner"],
      keys: ["Owner"],
      total: 1,
      rows: [{ page: { id: open.id, title: "Open site" }, cells: [[{ type: "paragraph" }]] }],
    });
    expect(report.body).not.toMatch(/Board|Secret/);
    expect((await creator.client.get(`/api/v1/reports/properties?labels=site`)).json().total).toBe(2);
    const labeled = await reader.client.get("/api/v1/reports/content-by-label?labels=site&excerpts=true");
    expect(labeled.json()).toEqual([
      expect.objectContaining({
        id: open.id,
        kind: "page",
        excerpt: "Anna in short",
        labels: ["anna", "site"],
      }),
    ]);
    const related = await reader.client.get(`/api/v1/pages/${open.id}/related-labels?labels=site`);
    expect(related.json()).toEqual([{ label: "anna", href: `/spaces/${space.key}/labels/anna` }]);
    const included = await reader.client.get(
      `/api/v1/pages/${open.id}/inclusion?targetId=${open.id}&excerpt=true`,
    );
    expect(included.statusCode, included.body).toBe(200);
    expect(included.json()).toMatchObject({
      state: "visible",
      page: { id: open.id },
      document: { type: "doc", content: [{ type: "paragraph" }] },
    });
    const hidden = await reader.client.get(`/api/v1/pages/${open.id}/inclusion?targetId=${secret.id}`);
    const unknown = await reader.client.get(`/api/v1/pages/${open.id}/inclusion?targetId=${randomUUID()}`);
    expect(hidden.statusCode).toBe(404);
    expect(unknown.statusCode).toBe(404);
    expect(hidden.json().detail).toBe(unknown.json().detail);
    expect((await reader.client.get(`/api/v1/pages/${secret.id}/related-labels`)).statusCode).toBe(404);
    for (const invalid of [
      "/api/v1/reports/properties?pageSize=101",
      "/api/v1/reports/properties?spaceIds=IT",
      "/api/v1/reports/content-by-label?kinds=attachment",
      `/api/v1/pages/${open.id}/inclusion`,
      `/api/v1/pages/${open.id}/inclusion?targetId=${open.id}&sourceTitle=Runbook&sourceSpace=OPS`,
      `/api/v1/pages/${open.id}/inclusion?sourceTitle=Runbook`,
    ]) {
      expect((await reader.client.get(invalid)).statusCode, invalid).toBe(400);
    }
  });

  it("reports pages, decisions and tasks through the API with only what the reader may see", async () => {
    const creator = await person();
    const reader = await person();
    const space = await createSpace(creator.client, [
      { principalKind: "account", principalId: reader.id, role: "reader" },
    ]);
    const decision = (text: string) => ({
      type: "decision",
      attrs: { id: randomUUID() },
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    });
    const task = (text: string) => ({
      type: "taskList",
      content: [
        {
          type: "taskItem",
          attrs: { id: randomUUID() },
          content: [{ type: "paragraph", content: [{ type: "text", text }] }],
        },
      ],
    });
    const project = await createPage(creator.client, space.id, "Project");
    const open = await createPage(creator.client, space.id, "Kick-off", project.id);
    const secret = await createPage(creator.client, space.id, "Secret meeting", project.id);
    for (const [page, text] of [
      [open, "Ship in May"],
      [secret, "Acquire the rival"],
    ] as const) {
      const stored = await creator.client.put(`/api/v1/pages/${page.id}/content`, {
        document: { type: "doc", content: [decision(text), task(`${text} task`)] },
      });
      expect(stored.statusCode, stored.body).toBe(200);
      const label = await creator.client.post(`/api/v1/pages/${page.id}/labels`, { label: "project-x" });
      expect(label.statusCode, label.body).toBe(200);
    }
    const restricted = await creator.client.post(`/api/v1/pages/${secret.id}/access`, {
      changes: [{ action: "restrict", kind: "view" }],
    });
    expect(restricted.statusCode, restricted.body).toBe(200);
    const paths = [
      `/api/v1/reports/pages?spaceId=${space.id}&labels=project-x&sort=title`,
      `/api/v1/reports/decisions?spaceId=${space.id}&labels=project-x&parentId=${project.id}`,
      `/api/v1/tasks?pageIds=${project.id}&labels=project-x&status=all`,
    ];
    for (const path of paths) {
      const ofReader = await reader.client.get(path);
      expect(ofReader.statusCode, ofReader.body).toBe(200);
      expect(ofReader.body, path).not.toMatch(/Secret|rival/);
      expect(ofReader.body, path).toMatch(/Kick-off/);
      expect((await creator.client.get(path)).body, path).toMatch(/Secret meeting/);
    }
    expect((await reader.client.get(paths[0] as string)).json()).toEqual([
      expect.objectContaining({
        id: open.id,
        title: "Kick-off",
        path: `/spaces/${space.key}/pages/${open.id}/kick-off`,
        spaceId: space.id,
      }),
    ]);
    expect((await reader.client.get(paths[1] as string)).json()).toEqual({
      items: [
        expect.objectContaining({ text: "Ship in May", page: expect.objectContaining({ id: open.id }) }),
      ],
      nextCursor: null,
    });
    for (const invalid of [
      "/api/v1/reports/pages?labels=Two%20Words",
      "/api/v1/reports/pages?limit=101",
      "/api/v1/reports/decisions?order=random",
      "/api/v1/tasks?pageIds=not-a-page",
    ]) {
      expect((await reader.client.get(invalid)).statusCode, invalid).toBe(400);
    }

    const overview = await creator.client.put(`/api/v1/pages/${project.id}/content`, {
      document: {
        type: "doc",
        content: [
          { type: "pageReport", attrs: { spaceId: space.id, labels: ["project-x"], sort: "title" } },
          { type: "decisionReport", attrs: { spaceId: space.id, parentId: project.id } },
          { type: "templateButton", attrs: { templateId: "builtin:meeting-notes", label: "New notes" } },
        ],
      },
    });
    expect(overview.statusCode, overview.body).toBe(200);
    const markdown = (await reader.client.get(`/api/v1/pages/${project.id}/markdown`)).json().markdown;
    expect(markdown).toContain(`| [Kick-off](/spaces/${space.key}/pages/${open.id}/kick-off) |`);
    expect(markdown).toContain("- Ship in May");
    expect(markdown).toContain("*New notes*");
    expect(markdown).not.toMatch(/Secret|rival/);

    const created = await creator.client.post(`/api/v1/spaces/${space.id}/items`, {
      kind: "page",
      title: "",
      parentId: project.id,
      template: {
        id: "builtin:meeting-notes",
        values: { date: "2026-11-02" },
        titlePattern: "{date} Project X notes",
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    expect(created.json().title).toBe("2 Nov 2026 Project X notes");
  });

  it("answers report filters with a page the caller cannot see exactly like with an unknown page", async () => {
    const creator = await person();
    const outsider = await person();
    const space = await createSpace(creator.client);
    const parent = await createPage(creator.client, space.id, "Closed parent");
    const child = await createPage(creator.client, space.id, "Shared child", parent.id);
    const stored = await creator.client.put(`/api/v1/pages/${child.id}/content`, {
      document: {
        type: "doc",
        content: [
          {
            type: "decision",
            attrs: { id: randomUUID() },
            content: [{ type: "paragraph", content: [{ type: "text", text: "Shared decision" }] }],
          },
          {
            type: "taskList",
            content: [
              {
                type: "taskItem",
                attrs: { id: randomUUID() },
                content: [{ type: "paragraph", content: [{ type: "text", text: "Shared task" }] }],
              },
            ],
          },
        ],
      },
    });
    expect(stored.statusCode, stored.body).toBe(200);
    const shared = await creator.client.post(`/api/v1/pages/${child.id}/access`, {
      changes: [
        {
          action: "share",
          holderKind: "account",
          holderId: outsider.id,
          role: "reader",
          includeDescendants: false,
        },
      ],
    });
    expect(shared.statusCode, shared.body).toBe(200);
    expect((await outsider.client.get("/api/v1/reports/decisions")).body).toContain("Shared decision");
    expect((await outsider.client.get("/api/v1/tasks?status=all")).body).toContain("Shared task");
    const unknown = randomUUID();
    const answer = async (path: string) => {
      const response = await outsider.client.get(path);
      return { status: response.statusCode, body: response.body };
    };
    for (const path of [
      (id: string) => `/api/v1/reports/decisions?parentId=${id}`,
      (id: string) => `/api/v1/tasks?pageIds=${id}&status=all`,
      (id: string) => `/api/v1/tasks?pageIds=${id},${child.id}&status=all`,
      (id: string) => `/api/v1/items/${id}`,
    ]) {
      const ofHidden = await answer(path(parent.id));
      expect(ofHidden, path(parent.id)).toEqual(await answer(path(unknown)));
      expect(ofHidden.body).not.toContain("Shared decision");
    }
    expect((await creator.client.get(`/api/v1/reports/decisions?parentId=${parent.id}`)).body).toContain(
      "Shared decision",
    );

    const own = await createSpace(outsider.client);
    const rendered = async (parentId: string) => {
      const page = await createPage(outsider.client, own.id, `Report ${parentId}`);
      const report = await outsider.client.put(`/api/v1/pages/${page.id}/content`, {
        document: { type: "doc", content: [{ type: "decisionReport", attrs: { parentId } }] },
      });
      expect(report.statusCode, report.body).toBe(200);
      const response = await outsider.client.get(`/api/v1/pages/${page.id}/markdown`);
      return { status: response.statusCode, markdown: response.json().markdown };
    };
    expect(await rendered(parent.id)).toEqual(await rendered(unknown));
    expect((await rendered(parent.id)).markdown).toBe("*No decisions match the filters*\n");
  });

  it("arranges the tree and keeps moves inside the rules", async () => {
    const creator = await person();
    const space = await createSpace(creator.client);
    const parent = await createPage(creator.client, space.id, "Parent");
    const child = await createPage(creator.client, space.id, "Child", parent.id);
    const below = await creator.client.post(`/api/v1/items/${parent.id}/move`, { parentId: child.id });
    expect(below.statusCode).toBe(409);
    expect(below.json()).toMatchObject({ code: "moveIntoDescendant" });
    const moved = await creator.client.post(`/api/v1/items/${child.id}/move`, {
      parentId: null,
      beforeId: parent.id,
    });
    expect(moved.json()).toMatchObject({ parentId: null });
    const root = await creator.client.get(`/api/v1/spaces/${space.id}/items`);
    expect(root.json().items.map((item: { title: string }) => item.title)).toEqual([
      expect.any(String),
      "Child",
      "Parent",
    ]);
    const folder = await creator.client.post(`/api/v1/items/${parent.id}/convert`, { kind: "folder" });
    expect(folder.json()).toMatchObject({ kind: "folder" });
    const found = await creator.client.get(`/api/v1/items?q=chil&spaceId=${space.id}`);
    expect(found.json().map((item: { id: string }) => item.id)).toEqual([child.id]);
  });

  it("copies a restricted page only after the wider access is confirmed, and lists the source in the history", async () => {
    const creator = await person();
    const reader = await person();
    const outsider = await person();
    const space = await createSpace(creator.client, [
      { principalKind: "account", principalId: reader.id, role: "reader" },
    ]);
    const target = await createSpace(creator.client, [
      { principalKind: "account", principalId: reader.id, role: "reader" },
      { principalKind: "account", principalId: outsider.id, role: "editor" },
    ]);
    const hr = await createPage(creator.client, space.id, "HR");
    await createPage(creator.client, space.id, "Salaries", hr.id);
    await creator.client.post(`/api/v1/pages/${hr.id}/access`, {
      changes: [{ action: "restrict", kind: "view" }],
    });

    const preview = await creator.client.post(`/api/v1/items/${hr.id}/copy/preview`, {
      spaceId: target.id,
      parentId: null,
      descendants: true,
    });
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.json()).toMatchObject({
      widerAccess: true,
      gaining: 2,
      items: 2,
      hidden: 0,
      background: false,
    });

    const refused = await creator.client.post(`/api/v1/items/${hr.id}/copy`, {
      spaceId: target.id,
      parentId: null,
      descendants: true,
    });
    expect(refused.statusCode, refused.body).toBe(409);
    expect(refused.json()).toMatchObject({ code: "copyChangesAccess", copyImpact: { gaining: 2 } });

    const copied = await creator.client.post(`/api/v1/items/${hr.id}/copy`, {
      spaceId: target.id,
      parentId: null,
      descendants: true,
      confirmation: preview.json().confirmation,
    });
    expect(copied.statusCode, copied.body).toBe(200);
    expect(copied.json()).toMatchObject({
      state: "done",
      copied: 2,
      item: { spaceId: target.id, title: "HR" },
    });
    const copyId = copied.json().id as string;
    const item = copied.json().item.id as string;
    expect((await reader.client.get(`/api/v1/items/${item}`)).statusCode).toBe(200);

    const history = await outsider.client.get(`/api/v1/pages/${item}/versions`);
    expect(history.json()).toMatchObject([{ reason: "copied", copiedFrom: { itemId: null, title: null, path: null } }]);
    const own = await creator.client.get(`/api/v1/pages/${item}/versions`);
    expect(own.json()).toMatchObject([{ copiedFrom: { itemId: hr.id, title: "HR" } }]);

    expect((await creator.client.get(`/api/v1/copies/${copyId}`)).json()).toMatchObject({ state: "done" });
    expect((await outsider.client.get(`/api/v1/copies/${copyId}`)).statusCode).toBe(404);
    const byReader = await reader.client.post(`/api/v1/items/${item}/copy`, { parentId: null });
    expect(byReader.statusCode).toBe(403);
    const hidden = await outsider.client.post(`/api/v1/items/${hr.id}/copy/preview`, {
      spaceId: target.id,
      parentId: null,
    });
    expect(hidden.statusCode).toBe(404);
  });

  it("refuses a drag and drop out of a restricted page until the change in access is confirmed", async () => {
    const creator = await person();
    const reader = await person();
    const space = await createSpace(creator.client, [
      { principalKind: "account", principalId: reader.id, role: "reader" },
    ]);
    const hr = await createPage(creator.client, space.id, "HR");
    const salaries = await createPage(creator.client, space.id, "Salaries", hr.id);
    const restricted = await creator.client.post(`/api/v1/pages/${hr.id}/access`, {
      changes: [{ action: "restrict", kind: "view" }],
    });
    expect(restricted.statusCode, restricted.body).toBe(200);
    expect((await reader.client.get(`/api/v1/items/${salaries.id}`)).statusCode).toBe(404);

    const dropped = await creator.client.post(`/api/v1/items/${salaries.id}/move`, { parentId: null });
    expect(dropped.statusCode, dropped.body).toBe(409);
    expect(dropped.json()).toMatchObject({
      code: "moveChangesAccess",
      impact: { gaining: 1, changes: [{ accountId: reader.id, before: null, after: "reader" }] },
    });
    expect((await reader.client.get(`/api/v1/items/${salaries.id}`)).statusCode).toBe(404);

    const confirmed = await creator.client.post(`/api/v1/items/${salaries.id}/move`, {
      parentId: null,
      confirmation: dropped.json().impact.confirmation,
    });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    expect((await reader.client.get(`/api/v1/items/${salaries.id}`)).statusCode).toBe(200);

    const preview = await creator.client.post(`/api/v1/items/${salaries.id}/move/preview`, {
      parentId: hr.id,
    });
    expect(preview.json()).toMatchObject({ losing: 1, leavesConfidential: false });
    const unchanged = await creator.client.post(`/api/v1/items/${hr.id}/move/preview`, { parentId: null });
    expect(unchanged.json()).toMatchObject({ gaining: 0, losing: 0, confirmation: null });
  });

  it("previews and changes permissions with the space admin rules", async () => {
    const creator = await person();
    const colleague = await person();
    const space = await createSpace(creator.client);
    const change = { action: "grant", principalKind: "account", principalId: colleague.id, role: "editor" };
    const preview = await creator.client.post(`/api/v1/spaces/${space.id}/permissions/preview`, change);
    expect(preview.json()).toMatchObject({
      gaining: 1,
      changes: [{ accountId: colleague.id, after: "editor" }],
    });
    const changed = await creator.client.post(`/api/v1/spaces/${space.id}/permissions`, change);
    expect(changed.statusCode, changed.body).toBe(200);
    const own = changed.json().find((entry: { principalId: string }) => entry.principalId === creator.id);
    const last = await creator.client.delete(`/api/v1/spaces/${space.id}/permissions/${own.id}`);
    expect(last.statusCode).toBe(409);
    expect(last.json()).toMatchObject({ code: "lastSpaceAdmin" });
    const visibility = await creator.client.post(`/api/v1/spaces/${space.id}/visibility/preview`, {
      visibility: "organization",
    });
    expect(visibility.statusCode).toBe(200);
    expect(visibility.json().gaining).toBeGreaterThan(0);
  });

  it("limits API tokens to their scopes", async () => {
    const creator = await person();
    const space = await createSpace(creator.client);
    const page = await createPage(creator.client, space.id, "Scripted");
    const token = async (scopes: object) =>
      (await creator.client.post("/api/v1/account/tokens", { name: "Script", scopes })).json()
        .token as string;
    const readOnly = await token({ organization: { spaces: "view" } });
    const writer = await token({ organization: { spaces: "manage" } });
    const unrelated = await token({ organization: { membersAndGroups: "view" } });
    const script = new TestClient(test.app);
    expect((await script.get(`/api/v1/pages/${page.id}/content`, bearer(readOnly))).statusCode).toBe(200);
    const document = { type: "doc", content: [paragraph("From a script")] };
    expect(
      (await script.put(`/api/v1/pages/${page.id}/content`, { document }, bearer(readOnly))).statusCode,
    ).toBe(403);
    expect(
      (await script.put(`/api/v1/pages/${page.id}/content`, { document }, bearer(writer))).statusCode,
    ).toBe(200);
    expect((await script.get(`/api/v1/pages/${page.id}/content`, bearer(unrelated))).statusCode).toBe(404);
    expect(
      (await script.get(`/api/v1/spaces?organizationId=${organizationId}`, bearer(unrelated))).statusCode,
    ).toBe(403);
    const listed = await script.get(`/api/v1/spaces?organizationId=${organizationId}`, bearer(readOnly));
    expect(listed.json().items.map((item: { id: string }) => item.id)).toContain(space.id);
  });

  it("lets organization administrators see spaces without a space admin and appoint one", async () => {
    const creator = await person();
    const successor = await person();
    const space = await createSpace(creator.client);
    await test.runtime.pool.query("update accounts set state = 'deactivated' where id = $1", [creator.id]);
    const listed = await owner.get(`/api/v1/organizations/${organizationId}/spaces-without-administrator`);
    expect(listed.json().items.map((item: { id: string }) => item.id)).toContain(space.id);
    const appointed = await owner.post(
      `/api/v1/organizations/${organizationId}/spaces/${space.id}/administrator`,
      {
        accountId: successor.id,
      },
    );
    expect(appointed.statusCode, appointed.body).toBe(204);
    expect((await successor.client.get(`/api/v1/spaces/${space.id}`)).json()).toMatchObject({
      role: "admin",
    });
    const ordinary = await person();
    expect(
      (await ordinary.client.get(`/api/v1/organizations/${organizationId}/spaces-without-administrator`))
        .statusCode,
    ).toBe(403);
  });

  it("creates the personal space on first use and lets instance administrators transfer it without reading it", async () => {
    const leaving = await person();
    const personal = await leaving.client.post("/api/v1/account/personal-space", {
      overviewTitle: "Personal space",
    });
    expect(personal.json()).toMatchObject({ personal: true, organizationId: null });
    const again = await leaving.client.post("/api/v1/account/personal-space", { overviewTitle: "Other" });
    expect(again.json().id).toBe(personal.json().id);
    expect((await owner.get(`/api/v1/spaces/${personal.json().id}`)).statusCode).toBe(404);
    await test.runtime.pool.query("update accounts set state = 'deactivated' where id = $1", [leaving.id]);
    const review = await owner.get("/api/v1/instance/personal-spaces");
    expect(review.json().items.map((item: { spaceId: string }) => item.spaceId)).toContain(
      personal.json().id,
    );
    const successor = await person();
    const transfer = await owner.post(`/api/v1/instance/personal-spaces/${personal.json().id}/transfer`, {
      accountId: successor.id,
    });
    expect(transfer.statusCode, transfer.body).toBe(204);
    expect((await successor.client.get(`/api/v1/spaces/${personal.json().id}`)).json()).toMatchObject({
      role: "admin",
    });
    expect((await owner.get(`/api/v1/spaces/${personal.json().id}`)).statusCode).toBe(404);
  });

  it("finds people the caller may see", async () => {
    const searcher = await person();
    const colleague = await person();
    const stranger = await person("none");
    const found = await searcher.client.get("/api/v1/people?q=person");
    const ids = found.json().items.map((item: { id: string }) => item.id);
    expect(ids).toContain(colleague.id);
    expect(ids).not.toContain(stranger.id);
  });
});
