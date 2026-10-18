import { randomBytes } from "node:crypto";
import { accountAttemptLimitSetting, clientAttemptLimitSetting, SYSTEM } from "@pagehall/server";
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

const octet = { "content-type": "application/octet-stream" };
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function png(): Buffer {
  return Buffer.concat([PNG, randomBytes(64)]);
}

const plainTemplate = {
  name: "Weekly notes",
  description: "Notes of the week",
  category: "meetings",
  title: "Week {week}",
  fields: [{ key: "week", label: "Week", type: "text", required: true }],
  document: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Agenda" }] }] },
};

describe.skipIf(!databaseBaseUrl)("template files through the API", () => {
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

  async function person() {
    counter += 1;
    const account = await createAccount(test, `templates${counter}@pagehall.test`);
    return { id: account.id, client: await signedInClient(test, account.email, account.password) };
  }

  async function guest() {
    counter += 1;
    const email = `template-guest${counter}@pagehall.test`;
    const password = "a long enough passphrase";
    const { database, services } = test.runtime;
    const account = await database.transaction((tx) =>
      services.accounts.createStandard(tx, { email, name: "Guest", password, homeOrganizationId: null }),
    );
    await database.transaction((tx) =>
      services.memberships.add(tx, SYSTEM, { organizationId, accountId: account.id, kind: "guest" }),
    );
    return { id: account.id, client: await signedInClient(test, email, password) };
  }

  async function setup() {
    const admin = await person();
    const editor = await person();
    const reader = await person();
    const visitor = await guest();
    counter += 1;
    const space = await admin.client.post(`/api/v1/organizations/${organizationId}/spaces`, {
      name: `Templates ${counter}`,
      key: `TPL${counter}`,
      visibility: "private",
      grants: [
        { principalKind: "account", principalId: editor.id, role: "editor" },
        { principalKind: "account", principalId: reader.id, role: "reader" },
        { principalKind: "account", principalId: visitor.id, role: "editor" },
      ],
    });
    expect(space.statusCode, space.body).toBe(201);
    const spaceId = space.json().id as string;
    const created = await admin.client.post(`/api/v1/spaces/${spaceId}/templates`, plainTemplate);
    expect(created.statusCode, created.body).toBe(201);
    return { admin, editor, reader, visitor, spaceId, templateId: created.json().id as string };
  }

  it("lets space admins add images, export and import, and nobody else", async () => {
    const { admin, editor, reader, visitor, spaceId, templateId } = await setup();
    const image = png();
    const uploaded = await admin.client.post(
      `/api/v1/spaces/${spaceId}/templates/${templateId}/files?name=team.png`,
      image,
      octet,
    );
    expect(uploaded.statusCode, uploaded.body).toBe(201);
    const fileId = uploaded.json().id as string;
    const saved = await admin.client.put(`/api/v1/spaces/${spaceId}/templates/${templateId}`, {
      ...plainTemplate,
      document: {
        type: "doc",
        content: [
          { type: "image", attrs: { attachmentId: fileId, alt: "Team", width: null, align: "center" } },
        ],
      },
    });
    expect(saved.statusCode, saved.body).toBe(200);
    const content = await editor.client.get(
      `/api/v1/spaces/${spaceId}/templates/${templateId}/files/${fileId}/content`,
    );
    expect(content.statusCode).toBe(200);
    expect(content.rawPayload.equals(image)).toBe(true);

    for (const someone of [editor, reader, visitor]) {
      const upload = await someone.client.post(
        `/api/v1/spaces/${spaceId}/templates/${templateId}/files?name=x.png`,
        png(),
        octet,
      );
      expect(upload.statusCode).toBe(403);
      expect(
        (await someone.client.post(`/api/v1/spaces/${spaceId}/templates/export`, { templateIds: null }))
          .statusCode,
      ).toBe(403);
      expect(
        (
          await someone.client.post(`/api/v1/spaces/${spaceId}/templates/export-summary`, {
            templateIds: null,
          })
        ).statusCode,
      ).toBe(403);
      const imported = await someone.client.post(
        `/api/v1/spaces/${spaceId}/template-imports?name=t.pagehall-template.json`,
        Buffer.from("{}"),
        octet,
      );
      expect(imported.statusCode).toBe(403);
    }

    const exported = await admin.client.post(`/api/v1/spaces/${spaceId}/templates/export`, {
      templateIds: [templateId],
    });
    expect(exported.statusCode, exported.body).toBe(200);
    expect(exported.headers["content-type"]).toBe("application/zip");
    expect(String(exported.headers["content-disposition"])).toContain("weekly-notes.pagehall-template.zip");

    const preview = await admin.client.post(
      `/api/v1/spaces/${spaceId}/template-imports?name=weekly-notes.pagehall-template.zip`,
      exported.rawPayload,
      octet,
    );
    expect(preview.statusCode, preview.body).toBe(201);
    const body = preview.json();
    expect(body.templates[0]).toMatchObject({
      name: "Weekly notes",
      valid: true,
      conflict: { templateId, suggestedName: "Weekly notes (imported)" },
    });
    const previewFile = body.templates[0].files[0].id as string;
    const previewImage = await admin.client.get(
      `/api/v1/spaces/${spaceId}/template-imports/${body.id}/files/${previewFile}/content`,
    );
    expect(previewImage.statusCode).toBe(200);
    expect(previewImage.rawPayload.equals(image)).toBe(true);
    const otherAdmin = await editor.client.get(
      `/api/v1/spaces/${spaceId}/template-imports/${body.id}/files/${previewFile}/content`,
    );
    expect(otherAdmin.statusCode).toBe(403);

    const confirmed = await admin.client.post(
      `/api/v1/spaces/${spaceId}/template-imports/${body.id}/confirm`,
      {
        decisions: [{ index: 0, action: "create", name: "Weekly notes for B" }],
      },
    );
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    expect(confirmed.json().created[0]).toMatchObject({ name: "Weekly notes for B", spaceId });
    const again = await admin.client.post(
      `/api/v1/spaces/${spaceId}/template-imports/${body.id}/confirm`,
      {},
    );
    expect(again.json()).toMatchObject({ code: "templateImportNotFound" });
  });

  it("keeps space admins out of organization and instance templates", async () => {
    const { admin } = await setup();
    const organizationImport = await admin.client.post(
      `/api/v1/organizations/${organizationId}/template-imports?name=t.pagehall-template.json`,
      Buffer.from("{}"),
      octet,
    );
    expect(organizationImport.statusCode).toBe(403);
    expect(
      (
        await admin.client.post(`/api/v1/organizations/${organizationId}/templates/export`, {
          templateIds: null,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (await admin.client.post("/api/v1/instance/templates/export", { templateIds: null })).statusCode,
    ).toBe(403);
    expect(
      (await admin.client.post("/api/v1/instance/templates/built-in/export", { language: "en" })).statusCode,
    ).toBe(403);
  });

  it("lets instance administrators export the built-in templates", async () => {
    const exported = await owner.post("/api/v1/instance/templates/built-in/export", {
      language: "de",
      templateIds: ["builtin:how-to"],
    });
    expect(exported.statusCode, exported.body).toBe(200);
    expect(exported.headers["content-type"]).toBe("application/json");
    const parsed = JSON.parse(exported.body);
    expect(parsed.templates).toHaveLength(1);
    expect(parsed.templates[0].language).toBe("de");
  });

  it("names the limit when the upload is refused", async () => {
    const { admin, spaceId } = await setup();
    const preview = await admin.client.post(
      `/api/v1/spaces/${spaceId}/template-imports?name=t.pagehall-template.json`,
      Buffer.from(JSON.stringify({ format: "pagehall-template", formatVersion: 9 })),
      octet,
    );
    expect(preview.statusCode).toBe(400);
    expect(preview.json()).toMatchObject({
      code: "newerTemplateFormat",
      fileVersion: 9,
      supportedVersion: 1,
    });
  });

  it("warns before saving a restricted page as a template", async () => {
    const { admin, spaceId } = await setup();
    const page = await admin.client.post(`/api/v1/spaces/${spaceId}/items`, {
      kind: "page",
      title: "Salaries",
      parentId: null,
      mode: "live",
    });
    const pageId = page.json().id as string;
    const before = await admin.client.get(
      `/api/v1/spaces/${spaceId}/templates/from-page/files?pageId=${pageId}`,
    );
    expect(before.json()).toEqual({ files: 0, restricted: false });
  });
});
