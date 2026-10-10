import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { accountAttemptLimitSetting, clientAttemptLimitSetting, maxUploadSetting } from "@pagehall/server";
import { createXmlExport, syntheticExport, testJobContext } from "@pagehall/server/testing";
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

function sha256(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

describe.skipIf(!databaseBaseUrl)("imports through the API", () => {
  let test: AuthTestApp;
  let owner: TestClient;
  let organizationId: string;
  let counter = 0;
  const importDir = mkdtempSync(path.join(tmpdir(), "pagehall-import-folder-"));

  async function slugOf(id: string): Promise<string> {
    const result = await test.runtime.pool.query<{ slug: string }>(
      "select slug from organizations where id = $1",
      [id],
    );
    return result.rows[0]?.slug ?? "";
  }

  beforeAll(async () => {
    writeFileSync(path.join(importDir, "top-level.zip"), createXmlExport(syntheticExport()));
    test = await createAuthTestApp({ ...configuredSetupEnv, PAGEHALL_IMPORT_DIR: importDir });
    await completeConfiguredSetup(test);
    await test.runtime.settings.set(clientAttemptLimitSetting, {}, "instance", 10_000);
    await test.runtime.settings.set(accountAttemptLimitSetting, {}, "instance", 1000);
    owner = new TestClient(test.app);
    await owner.post("/api/v1/auth/sign-in", OWNER);
    await addTotp(owner);
    organizationId = await firstOrganizationId(test);
    const own = path.join(importDir, await slugOf(organizationId));
    mkdirSync(path.join(own, "nested"), { recursive: true });
    writeFileSync(path.join(own, "space-export.zip"), createXmlExport(syntheticExport()));
    writeFileSync(path.join(own, "nested", "hidden.zip"), "x");
  });

  afterAll(async () => {
    await test?.close();
  });

  async function member() {
    counter += 1;
    const email = `imports${counter}@pagehall.test`;
    const account = await createAccount(test, email);
    return { id: account.id, client: await signedInClient(test, email, account.password) };
  }

  async function work(importId: string) {
    for (let run = 0; run < 50; run++) {
      const state = await test.runtime.pool.query<{ state: string }>(
        "select state from imports where id = $1",
        [importId],
      );
      if (!["analyzing", "running", "stopping", "discarding"].includes(state.rows[0]?.state ?? "")) return;
      await test.runtime.services.importWorker.work(testJobContext("imports.work", { importId }));
    }
  }

  async function uploadExport(archive: Buffer) {
    const created = await owner.post(`/api/v1/organizations/${organizationId}/import-uploads`, {
      name: "export.zip",
      size: archive.length,
    });
    expect(created.statusCode, created.body).toBe(201);
    const upload = created.json() as { id: string; partSize: number; partCount: number };
    const digests: string[] = [];
    for (let number = 1; number <= upload.partCount; number += 1) {
      const part = archive.subarray((number - 1) * upload.partSize, number * upload.partSize);
      digests.push(sha256(part));
      const stored = await owner.put(
        `/api/v1/organizations/${organizationId}/import-uploads/${upload.id}/parts/${number}?sha256=${sha256(part)}`,
        part,
        { "content-type": "application/octet-stream" },
      );
      expect(stored.statusCode, stored.body).toBe(200);
    }
    const completed = await owner.post(
      `/api/v1/organizations/${organizationId}/import-uploads/${upload.id}/complete`,
      { sha256: sha256(digests.join("")) },
    );
    expect(completed.statusCode, completed.body).toBe(200);
    return upload.id;
  }

  async function finishedImport(
    key: string,
    reviewers: string[],
    archive = createXmlExport(syntheticExport()),
  ) {
    const created = await owner.post(`/api/v1/organizations/${organizationId}/imports`, {
      source: "confluence-xml",
    });
    expect(created.statusCode, created.body).toBe(201);
    const id = (created.json() as { id: string }).id;
    const uploadId = await uploadExport(archive);
    const chosen = await owner.patch(`/api/v1/imports/${id}`, { file: { kind: "upload", uploadId } });
    expect(chosen.json()).toMatchObject({ state: "analyzing" });
    await work(id);
    const named = await owner.patch(`/api/v1/imports/${id}`, { spaceName: `Import ${key}`, spaceKey: key });
    expect(named.json()).toMatchObject({ state: "ready", found: { pages: 8 } });
    const reviewed = await owner.put(`/api/v1/imports/${id}/reviewers`, { accountIds: reviewers });
    expect(reviewed.statusCode, reviewed.body).toBe(200);
    const started = await owner.post(`/api/v1/imports/${id}/start`);
    expect(started.statusCode, started.body).toBe(200);
    await work(id);
    const result = (await owner.get(`/api/v1/imports/${id}`)).json() as {
      state: string;
      quarantineSpace: { id: string; key: string };
    };
    expect(result.state).toBe("review");
    return { id, spaceId: result.quarantineSpace.id };
  }

  async function pageIn(spaceId: string, title: string): Promise<string> {
    const result = await test.runtime.pool.query<{ id: string }>(
      "select id from tree_items where space_id = $1 and title = $2",
      [spaceId, title],
    );
    return result.rows[0]?.id ?? "";
  }

  it("imports an uploaded export into a quarantine space that only the importer and reviewers see", async () => {
    const reviewer = await member();
    const outsider = await member();
    const { id, spaceId } = await finishedImport("APIQ", [reviewer.id]);
    const alpha = await pageIn(spaceId, "Alpha");
    const attachment = await test.runtime.pool.query<{ id: string }>(
      "select id from attachments where item_id = $1 order by name limit 1",
      [alpha],
    );
    const attachmentId = attachment.rows[0]?.id ?? "";

    for (const path of [
      `/api/v1/imports/${id}`,
      `/api/v1/imports/${id}/report`,
      `/api/v1/imports/${id}/report/macros`,
      `/api/v1/spaces/${spaceId}`,
      `/api/v1/spaces/${spaceId}/items`,
      `/api/v1/spaces/${spaceId}/labels`,
      `/api/v1/items/${alpha}`,
      `/api/v1/pages/${alpha}/content`,
      `/api/v1/pages/${alpha}/markdown`,
      `/api/v1/pages/${alpha}/backlinks`,
      `/api/v1/pages/${alpha}/labels`,
      `/api/v1/pages/${alpha}/attachments`,
      `/api/v1/attachments/${attachmentId}`,
      `/api/v1/attachments/${attachmentId}/content`,
    ]) {
      expect((await outsider.client.get(path)).statusCode, path).toBe(404);
    }
    const list = (await outsider.client.get(`/api/v1/organizations/${organizationId}/imports`)).json() as {
      id: string;
    }[];
    expect(list.map((entry) => entry.id)).not.toContain(id);
    const spaces = (await outsider.client.get(`/api/v1/spaces?organizationId=${organizationId}`)).json() as {
      items: { id: string }[];
    };
    expect(spaces.items.map((space) => space.id)).not.toContain(spaceId);
    const search = (await outsider.client.get("/api/v1/items?q=Alpha")).json() as { spaceId: string }[];
    expect(search.some((item) => item.spaceId === spaceId)).toBe(false);

    expect((await reviewer.client.get(`/api/v1/imports/${id}`)).statusCode).toBe(200);
    expect((await reviewer.client.get(`/api/v1/imports/${id}/report`)).statusCode).toBe(200);
    expect((await reviewer.client.get(`/api/v1/items/${alpha}`)).statusCode).toBe(200);
    expect((await reviewer.client.get(`/api/v1/pages/${alpha}/content`)).statusCode).toBe(200);
    expect((await reviewer.client.get(`/api/v1/attachments/${attachmentId}/content`)).statusCode).toBe(200);
    for (const [path, body] of [
      [`/api/v1/imports/${id}/accept`, { visibility: "private", grants: [] }],
      [`/api/v1/imports/${id}/discard`, { confirmation: "APIQ" }],
      [`/api/v1/imports/${id}/stop`, { confirmation: "APIQ" }],
    ] as const) {
      expect((await reviewer.client.post(path, body)).statusCode, path).toBe(403);
    }
    expect(
      (await reviewer.client.put(`/api/v1/imports/${id}/reviewers`, { accountIds: [] })).statusCode,
    ).toBe(403);
    const edit = await reviewer.client.post(`/api/v1/spaces/${spaceId}/items`, {
      kind: "page",
      title: "Sneaked in",
      parentId: null,
    });
    expect([403, 404]).toContain(edit.statusCode);

    const accepted = await owner.post(`/api/v1/imports/${id}/accept`, {
      visibility: "organization",
      grants: [{ principalKind: "organizationMembers", principalId: null, role: "reader" }],
    });
    expect(accepted.statusCode, accepted.body).toBe(200);
    expect(accepted.json()).toMatchObject({ state: "accepted" });
    expect((await outsider.client.get(`/api/v1/items/${alpha}`)).statusCode).toBe(200);
    const space = (await outsider.client.get(`/api/v1/spaces/${spaceId}`)).json() as { quarantined: boolean };
    expect(space.quarantined).toBe(false);
  });

  it("discards and stops only after the key was typed", async () => {
    const { id, spaceId } = await finishedImport("APID", []);
    const wrong = await owner.post(`/api/v1/imports/${id}/discard`, { confirmation: "NOPE" });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json()).toMatchObject({ code: "confirmationMismatch" });
    const stopRunning = await owner.post(`/api/v1/imports/${id}/stop`, { confirmation: "APID" });
    expect(stopRunning.json()).toMatchObject({ code: "importNotRunning" });
    const discarded = await owner.post(`/api/v1/imports/${id}/discard`, { confirmation: "APID" });
    expect(discarded.json()).toMatchObject({ state: "discarding" });
    await work(id);
    expect((await owner.get(`/api/v1/imports/${id}`)).json()).toMatchObject({ state: "discarded" });
    expect((await owner.get(`/api/v1/spaces/${spaceId}`)).statusCode).toBe(404);
  });

  it("refuses uploads above the instance limit and points to the import folder", async () => {
    await test.runtime.settings.set(maxUploadSetting, {}, "instance", 1);
    try {
      const response = await owner.post(`/api/v1/organizations/${organizationId}/import-uploads`, {
        name: "big.zip",
        size: 5 * 1024 * 1024,
      });
      expect(response.statusCode).toBe(413);
      expect(response.json()).toMatchObject({ code: "uploadTooLarge", maxBytes: 1024 * 1024 });
    } finally {
      await test.runtime.settings.clear(maxUploadSetting, {}, "instance");
    }
  });

  it("refuses a damaged part and keeps the parts that arrived", async () => {
    const archive = Buffer.alloc(1000, 1);
    const created = (
      await owner.post(`/api/v1/organizations/${organizationId}/import-uploads`, {
        name: "x.zip",
        size: 1000,
      })
    ).json() as { id: string };
    const damaged = await owner.put(
      `/api/v1/organizations/${organizationId}/import-uploads/${created.id}/parts/1?sha256=${sha256("other")}`,
      archive,
      { "content-type": "application/octet-stream" },
    );
    expect(damaged.statusCode).toBe(400);
    expect(damaged.json()).toMatchObject({ code: "uploadChecksumMismatch" });
    const state = (
      await owner.get(`/api/v1/organizations/${organizationId}/import-uploads/${created.id}`)
    ).json() as { parts: unknown[]; complete: boolean };
    expect(state).toMatchObject({ parts: [], complete: false });
  });

  it("escapes formula prefixes in the report export", async () => {
    const model = syntheticExport();
    const archive = createXmlExport({
      ...model,
      pages: model.pages.map((page) => (page.title === "Alpha" ? { ...page, title: "=HYPERLINK(1)" } : page)),
    });
    const { id } = await finishedImport("APIF", [], archive);
    const response = await owner.get(`/api/v1/imports/${id}/report/export`);
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("text/csv; charset=utf-8");
    expect(response.body).toContain(`"'=HYPERLINK(1)"`);
    expect(response.body).not.toMatch(/(^|,)"=HYPERLINK/m);
  });

  it("imports a file from the import folder by its name only", async () => {
    const listing = await owner.get(`/api/v1/organizations/${organizationId}/import-folder`);
    expect(listing.statusCode, listing.body).toBe(200);
    expect(listing.json()).toMatchObject({
      path: path.join(importDir, await slugOf(organizationId)),
      files: [{ name: "space-export.zip" }],
    });
    expect((listing.json() as { files: unknown[] }).files).toHaveLength(1);
    const created = (
      await owner.post(`/api/v1/organizations/${organizationId}/imports`, { source: "confluence-xml" })
    ).json() as { id: string };
    for (const name of ["../top-level.zip", "top-level.zip", "nested/hidden.zip", "nested"]) {
      const refused = await owner.patch(`/api/v1/imports/${created.id}`, { file: { kind: "folder", name } });
      expect(refused.json(), name).toMatchObject({ code: "importFileUnavailable" });
    }
    await owner.patch(`/api/v1/imports/${created.id}`, {
      file: { kind: "folder", name: "space-export.zip" },
    });
    await work(created.id);
    expect((await owner.get(`/api/v1/imports/${created.id}`)).json()).toMatchObject({
      state: "ready",
      file: { kind: "folder", name: "space-export.zip" },
      found: { pages: 8 },
    });
  });

  it("keeps the import folders of organizations apart and follows a changed slug", async () => {
    const created = await owner.post("/api/v1/organizations", { name: `Imports elsewhere ${counter}` });
    expect(created.statusCode, created.body).toBe(201);
    const otherId = (created.json() as { id: string }).id;
    const otherSlug = await slugOf(otherId);
    mkdirSync(path.join(importDir, otherSlug));
    writeFileSync(path.join(importDir, otherSlug, "other-export.zip"), createXmlExport(syntheticExport()));
    const names = async (id: string) =>
      (
        (await owner.get(`/api/v1/organizations/${id}/import-folder`)).json() as { files: { name: string }[] }
      ).files.map((file) => file.name);
    expect(await names(otherId)).toEqual(["other-export.zip"]);
    expect(await names(organizationId)).toEqual(["space-export.zip"]);
    const draft = (
      await owner.post(`/api/v1/organizations/${organizationId}/imports`, { source: "confluence-xml" })
    ).json() as { id: string };
    for (const name of ["other-export.zip", `../${otherSlug}/other-export.zip`]) {
      const refused = await owner.patch(`/api/v1/imports/${draft.id}`, { file: { kind: "folder", name } });
      expect(refused.json(), name).toMatchObject({ code: "importFileUnavailable" });
    }
    const renamed = await owner.patch(`/api/v1/organizations/${otherId}`, { slug: `${otherSlug}-renamed` });
    expect(renamed.statusCode, renamed.body).toBe(200);
    const listing = (await owner.get(`/api/v1/organizations/${otherId}/import-folder`)).json();
    expect(listing).toMatchObject({ path: path.join(importDir, `${otherSlug}-renamed`), files: [] });
  });
});
