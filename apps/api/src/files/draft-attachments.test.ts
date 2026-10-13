import { accountAttemptLimitSetting, anyoneLinksSetting, clientAttemptLimitSetting } from "@pagehall/server";
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

const DAY = 24 * 60 * 60 * 1000;

interface Listed {
  id: string;
  name: string;
  version: number;
  versions: number;
  draft: string | null;
}

describe.skipIf(!databaseBaseUrl)("attachments of a draft through the API", () => {
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
    await test.runtime.settings.set(
      anyoneLinksSetting,
      { organization: organizationId },
      "organization",
      true,
    );
  });

  afterAll(async () => {
    await test?.runtime.settings.clear(anyoneLinksSetting, { organization: organizationId }, "organization");
    await test?.close();
  });

  async function person() {
    counter += 1;
    const email = `drafts${counter}@pagehall.test`;
    const password = "a long enough passphrase";
    const { id } = await createAccount(test, email, password);
    return { id, client: await signedInClient(test, email, password) };
  }

  async function setup(mode: "publish" | "live") {
    const reader = await person();
    const guest = await person();
    counter += 1;
    const space = await owner.post(`/api/v1/organizations/${organizationId}/spaces`, {
      name: `Drafts ${counter}`,
      key: `D${counter}X`,
      visibility: "private",
      grants: [{ principalKind: "account", principalId: reader.id, role: "reader" }],
    });
    expect(space.statusCode, space.body).toBe(201);
    const created = await owner.post(`/api/v1/spaces/${(space.json() as { id: string }).id}/items`, {
      kind: "page",
      title: "Policy",
      parentId: null,
      mode,
    });
    expect(created.statusCode, created.body).toBe(201);
    const pageId = (created.json() as { id: string }).id;
    const shared = await owner.post(`/api/v1/pages/${pageId}/access`, {
      changes: [{ action: "share", holderKind: "account", holderId: guest.id, role: "reader" }],
    });
    expect(shared.statusCode, shared.body).toBe(200);
    const link = await owner.post(`/api/v1/pages/${pageId}/share-links`, {
      scope: "anyone",
      expiresAt: new Date(Date.now() + DAY).toISOString(),
    });
    expect(link.statusCode, link.body).toBe(201);
    const token = (link.json() as { token: string }).token;
    const visitor = new TestClient(test.app, { remoteAddress: `203.0.113.${(counter % 200) + 1}` });
    return { pageId, reader: reader.client, guest: guest.client, visitor, token };
  }

  type Context = Awaited<ReturnType<typeof setup>>;

  async function upload(pageId: string, name: string, text: string) {
    const response = await owner.post(
      `/api/v1/pages/${pageId}/attachments?name=${encodeURIComponent(name)}`,
      Buffer.from(text),
      { "content-type": "application/octet-stream" },
    );
    expect(response.statusCode, response.body).toBe(201);
    return response.json() as Listed;
  }

  async function publish(pageId: string) {
    const response = await owner.post(`/api/v1/pages/${pageId}/publish`, {});
    expect(response.statusCode, response.body).toBe(200);
  }

  async function names(client: TestClient, pageId: string) {
    const response = await client.get(`/api/v1/pages/${pageId}/attachments`);
    expect(response.statusCode, response.body).toBe(200);
    return (response.json() as Listed[]).map((attachment) => attachment.name);
  }

  async function linkNames(context: Context) {
    const response = await context.visitor.get(`/api/v1/share-links/${context.token}/page`);
    expect(response.statusCode, response.body).toBe(200);
    return (response.json() as { attachments: Listed[] }).attachments.map((attachment) => attachment.name);
  }

  async function download(client: TestClient, attachmentId: string, version?: number) {
    const query = version === undefined ? "" : `?version=${version}`;
    const response = await client.get(`/api/v1/attachments/${attachmentId}/content${query}`);
    return response.statusCode === 200 ? response.body : response.statusCode;
  }

  async function linkDownload(context: Context, attachmentId: string) {
    const response = await context.visitor.get(
      `/api/v1/share-links/${context.token}/attachments/${attachmentId}/content`,
    );
    return response.statusCode === 200 ? response.body : response.statusCode;
  }

  async function seenByAll(context: Context) {
    return {
      reader: await names(context.reader, context.pageId),
      guest: await names(context.guest, context.pageId),
      visitor: await linkNames(context),
    };
  }

  function everyone(list: string[]) {
    return { reader: list, guest: list, visitor: list };
  }

  it("show an attachment added in the draft to readers, share recipients and link visitors only after publication", async () => {
    const context = await setup("publish");
    await upload(context.pageId, "handbook.txt", "published text");
    await publish(context.pageId);
    const added = await upload(context.pageId, "layoffs-draft.txt", "confidential draft");
    expect(added.draft).toBe("added");
    expect(await seenByAll(context)).toEqual(everyone(["handbook.txt"]));
    for (const client of [context.reader, context.guest]) {
      expect(await download(client, added.id)).toBe(404);
      expect((await client.get(`/api/v1/attachments/${added.id}`)).statusCode).toBe(404);
      expect((await client.get(`/api/v1/attachments/${added.id}/versions`)).statusCode).toBe(404);
      expect((await client.get(`/api/v1/attachments/${added.id}/link`)).statusCode).toBe(404);
    }
    expect(await linkDownload(context, added.id)).toBe(404);
    expect(await download(owner, added.id)).toBe("confidential draft");
    const draft = (await owner.get(`/api/v1/pages/${context.pageId}/draft`)).json() as {
      hasChanges: boolean;
    };
    expect(draft.hasChanges).toBe(true);

    await publish(context.pageId);
    expect(await seenByAll(context)).toEqual(everyone(["handbook.txt", "layoffs-draft.txt"]));
    expect(await download(context.reader, added.id)).toBe("confidential draft");
    expect(await download(context.guest, added.id)).toBe("confidential draft");
    expect(await linkDownload(context, added.id)).toBe("confidential draft");
    const listed = (await owner.get(`/api/v1/pages/${context.pageId}/attachments`)).json() as Listed[];
    expect(listed.map((attachment) => attachment.draft)).toEqual([null, null]);
  });

  it("keep the published version of a file replaced in the draft until the next publication", async () => {
    const context = await setup("publish");
    const file = await upload(context.pageId, "rates.txt", "old rates");
    await publish(context.pageId);
    const replaced = await upload(context.pageId, "rates.txt", "new rates");
    expect(replaced).toMatchObject({ id: file.id, version: 2, draft: "changed" });

    for (const client of [context.reader, context.guest]) {
      expect(await download(client, file.id)).toBe("old rates");
      expect(await download(client, file.id, 2)).toBe(404);
      const versions = (await client.get(`/api/v1/attachments/${file.id}/versions`)).json() as {
        number: number;
      }[];
      expect(versions.map((version) => version.number)).toEqual([1]);
      expect((await client.get(`/api/v1/attachments/${file.id}`)).json()).toMatchObject({
        version: 1,
        versions: 1,
        draft: null,
      });
    }
    expect(await linkDownload(context, file.id)).toBe("old rates");
    expect(await download(owner, file.id)).toBe("new rates");

    await publish(context.pageId);
    expect(await download(context.reader, file.id)).toBe("new rates");
    expect(await download(context.guest, file.id)).toBe("new rates");
    expect(await linkDownload(context, file.id)).toBe("new rates");
  });

  it("keep a file deleted in the draft readable for the published version until the next publication", async () => {
    const context = await setup("publish");
    const file = await upload(context.pageId, "contacts.txt", "phone list");
    await publish(context.pageId);
    expect((await owner.delete(`/api/v1/attachments/${file.id}`)).statusCode).toBe(204);
    expect(await names(owner, context.pageId)).toEqual([]);
    expect(await seenByAll(context)).toEqual(everyone(["contacts.txt"]));
    expect(await download(context.reader, file.id)).toBe("phone list");
    expect(await download(context.guest, file.id)).toBe("phone list");
    expect(await linkDownload(context, file.id)).toBe("phone list");

    await publish(context.pageId);
    expect(await seenByAll(context)).toEqual(everyone([]));
    expect(await download(context.reader, file.id)).toBe(404);
    expect(await download(context.guest, file.id)).toBe(404);
    expect(await linkDownload(context, file.id)).toBe(404);
  });

  it("discard attachments added only for a discarded draft and bring back what the draft changed", async () => {
    const context = await setup("publish");
    const kept = await upload(context.pageId, "kept.txt", "v1");
    const removed = await upload(context.pageId, "removed.txt", "still here");
    await publish(context.pageId);
    const added = await upload(context.pageId, "added.txt", "draft only");
    await upload(context.pageId, "kept.txt", "v2");
    expect((await owner.delete(`/api/v1/attachments/${removed.id}`)).statusCode).toBe(204);

    const discarded = await owner.post(`/api/v1/pages/${context.pageId}/draft/discard`, {});
    expect(discarded.statusCode, discarded.body).toBe(200);
    expect(await names(owner, context.pageId)).toEqual(["kept.txt", "removed.txt"]);
    expect(await download(owner, kept.id)).toBe("v1");
    expect(await download(owner, added.id)).toBe(404);
    expect(await seenByAll(context)).toEqual(everyone(["kept.txt", "removed.txt"]));

    await publish(context.pageId);
    expect(await seenByAll(context)).toEqual(everyone(["kept.txt", "removed.txt"]));
    expect(await download(context.reader, kept.id)).toBe("v1");
    expect(await download(context.reader, added.id)).toBe(404);

    const { discardedDraftId } = discarded.json() as { discardedDraftId: string };
    const restored = await owner.post(
      `/api/v1/pages/${context.pageId}/discarded-drafts/${discardedDraftId}/restore`,
      {},
    );
    expect(restored.statusCode, restored.body).toBe(204);
    expect(await names(owner, context.pageId)).toEqual(["added.txt", "kept.txt"]);
    expect(await download(owner, kept.id)).toBe("v2");
    expect(await seenByAll(context)).toEqual(everyone(["kept.txt", "removed.txt"]));
  });

  it("show every change at once on a page in live mode", async () => {
    const context = await setup("live");
    const file = await upload(context.pageId, "notes.txt", "first");
    expect(file.draft).toBeNull();
    expect(await seenByAll(context)).toEqual(everyone(["notes.txt"]));
    await upload(context.pageId, "notes.txt", "second");
    expect(await download(context.reader, file.id)).toBe("second");
    expect(await download(context.guest, file.id, 1)).toBe("first");
    expect(await linkDownload(context, file.id)).toBe("second");
    expect((await owner.delete(`/api/v1/attachments/${file.id}`)).statusCode).toBe(204);
    expect(await seenByAll(context)).toEqual(everyone([]));
    expect(await download(context.reader, file.id)).toBe(404);
  });
});
