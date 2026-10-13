import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { accountAttemptLimitSetting, clientAttemptLimitSetting, maxUploadSetting } from "@pagehall/server";
import {
  ALICE,
  BOB,
  CAROL,
  createXmlExport,
  PEOPLE_PAGE,
  peopleExport,
  syntheticExport,
  testJobContext,
} from "@pagehall/server/testing";
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

  async function folderNames(id: string): Promise<string[]> {
    const listing = await owner.get(`/api/v1/organizations/${id}/import-folder`);
    expect(listing.statusCode, listing.body).toBe(200);
    return (listing.json() as { files: { name: string }[] }).files.map((file) => file.name);
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
    const own = path.join(importDir, organizationId);
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
    return { id: account.id, email, client: await signedInClient(test, email, account.password) };
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
    const people = await owner.put(`/api/v1/imports/${id}/people-source`, { kind: "skip", confirmed: true });
    expect(people.statusCode, people.body).toBe(200);
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
      path: path.join(importDir, organizationId),
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

  it("keeps the import folders of organizations apart by their IDs", async () => {
    const created = await owner.post("/api/v1/organizations", { name: `Imports elsewhere ${counter}` });
    expect(created.statusCode, created.body).toBe(201);
    const otherId = (created.json() as { id: string }).id;
    mkdirSync(path.join(importDir, otherId));
    writeFileSync(path.join(importDir, otherId, "other-export.zip"), createXmlExport(syntheticExport()));
    mkdirSync(path.join(importDir, await slugOf(otherId)));
    writeFileSync(path.join(importDir, await slugOf(otherId), "slug-export.zip"), "x");
    expect(await folderNames(otherId)).toEqual(["other-export.zip"]);
    expect(await folderNames(organizationId)).toEqual(["space-export.zip"]);
    const draft = (
      await owner.post(`/api/v1/organizations/${organizationId}/imports`, { source: "confluence-xml" })
    ).json() as { id: string };
    for (const name of ["other-export.zip", `../${otherId}/other-export.zip`, "slug-export.zip"]) {
      const refused = await owner.patch(`/api/v1/imports/${draft.id}`, { file: { kind: "folder", name } });
      expect(refused.json(), name).toMatchObject({ code: "importFileUnavailable" });
    }
  });

  it("lists nothing of another organization after taking over its slug", async () => {
    const organization = async (name: string) => {
      const created = await owner.post("/api/v1/organizations", { name });
      expect(created.statusCode, created.body).toBe(201);
      return (created.json() as { id: string }).id;
    };
    const previousId = await organization(`Previous owner ${randomUUID()}`);
    const nextId = await organization(`Next owner ${randomUUID()}`);
    const slug = await slugOf(previousId);
    for (const folder of [previousId, slug]) {
      mkdirSync(path.join(importDir, folder));
      writeFileSync(path.join(importDir, folder, "previous-export.zip"), createXmlExport(syntheticExport()));
    }
    expect(await folderNames(previousId)).toEqual(["previous-export.zip"]);
    const released = await owner.patch(`/api/v1/organizations/${previousId}`, { slug: `${slug}-old` });
    expect(released.statusCode, released.body).toBe(200);
    const taken = await owner.patch(`/api/v1/organizations/${nextId}`, { slug });
    expect(taken.statusCode, taken.body).toBe(200);
    const listing = (await owner.get(`/api/v1/organizations/${nextId}/import-folder`)).json();
    expect(listing).toMatchObject({ path: path.join(importDir, nextId), files: [] });
    expect(await folderNames(previousId)).toEqual(["previous-export.zip"]);
    const draft = (
      await owner.post(`/api/v1/organizations/${nextId}/imports`, { source: "confluence-xml" })
    ).json() as { id: string };
    const refused = await owner.patch(`/api/v1/imports/${draft.id}`, {
      file: { kind: "folder", name: "previous-export.zip" },
    });
    expect(refused.json()).toMatchObject({ code: "importFileUnavailable" });
  });

  async function folderImport(name: string) {
    const own = path.join(importDir, organizationId);
    writeFileSync(path.join(own, name), createXmlExport(syntheticExport()));
    const id = (
      (
        await owner.post(`/api/v1/organizations/${organizationId}/imports`, { source: "confluence-xml" })
      ).json() as { id: string }
    ).id;
    await owner.patch(`/api/v1/imports/${id}`, { file: { kind: "folder", name } });
    await work(id);
    const named = await owner.patch(`/api/v1/imports/${id}`, { spaceName: `Folder ${name}` });
    expect(named.json()).toMatchObject({ state: "ready" });
    const people = await owner.put(`/api/v1/imports/${id}/people-source`, { kind: "skip", confirmed: true });
    expect(people.statusCode, people.body).toBe(200);
    return { id, file: path.join(own, name) };
  }

  it("fails with fileChanged when the chosen file changes before the import reads it", async () => {
    const { id, file } = await folderImport(`changed-${randomUUID()}.zip`);
    appendFileSync(file, "changed");
    expect((await owner.post(`/api/v1/imports/${id}/start`)).statusCode).toBe(200);
    await work(id);
    expect((await owner.get(`/api/v1/imports/${id}`)).json()).toMatchObject({
      state: "failed",
      errorCode: "fileChanged",
    });
  });

  it("opens a chosen file only from the folder stored with the import", async () => {
    const { id } = await folderImport(`stored-${randomUUID()}.zip`);
    await test.runtime.pool.query("update imports set folder_key = null where id = $1", [id]);
    expect((await owner.post(`/api/v1/imports/${id}/start`)).statusCode).toBe(200);
    await work(id);
    expect((await owner.get(`/api/v1/imports/${id}`)).json()).toMatchObject({
      state: "failed",
      errorCode: "fileChanged",
    });
  });

  it("lets the importer resolve people, groups and permissions, and never returns the token", async () => {
    const reviewer = await member();
    const outsider = await member();
    const alice = await member();
    const bob = await member();
    const created = await owner.post(`/api/v1/organizations/${organizationId}/imports`, {
      source: "confluence-xml",
    });
    const id = (created.json() as { id: string }).id;
    const uploadId = await uploadExport(createXmlExport(peopleExport()));
    await owner.patch(`/api/v1/imports/${id}`, { file: { kind: "upload", uploadId } });
    await work(id);
    await owner.patch(`/api/v1/imports/${id}`, { spaceName: "People", spaceKey: "APIP", history: true });
    await owner.put(`/api/v1/imports/${id}/reviewers`, { accountIds: [reviewer.id] });
    const secretToken = "never-echo-this-token";
    const refused = await owner.put(`/api/v1/imports/${id}/people-source`, {
      kind: "token",
      site: "http://example.atlassian.net",
      email: "alex@example.com",
      token: secretToken,
    });
    expect(refused.statusCode, refused.body).toBe(400);
    expect(refused.json()).toMatchObject({ code: "invalidAtlassianSite" });
    expect(refused.body).not.toContain(secretToken);
    const skipped = await owner.put(`/api/v1/imports/${id}/people-source`, {
      kind: "skip",
      confirmed: false,
    });
    expect(skipped.json()).toMatchObject({ code: "skipNotConfirmed" });
    expect(
      (await reviewer.client.put(`/api/v1/imports/${id}/people-source`, { kind: "skip", confirmed: true }))
        .statusCode,
    ).toBe(403);
    const list = [
      "User id,User name,email",
      `${ALICE.accountId},Alice,${alice.email}`,
      `${BOB.accountId},Bob,bob@elsewhere.example`,
      `${CAROL.accountId},Carol,`,
    ].join("\n");
    const asJson = await owner.put(`/api/v1/imports/${id}/people-source/user-list`, { userList: list });
    expect(asJson.statusCode).toBe(415);
    const listed = await owner.put(`/api/v1/imports/${id}/people-source/user-list`, list, {
      "content-type": "text/csv",
    });
    expect(listed.statusCode, listed.body).toBe(200);
    expect(listed.json()).toMatchObject({
      peopleSource: { kind: "list", people: 3, withEmail: 2 },
      history: true,
    });
    expect((await owner.post(`/api/v1/imports/${id}/start`)).statusCode).toBe(200);
    await work(id);

    const people = await reviewer.client.get(`/api/v1/imports/${id}/people`);
    expect(people.statusCode, people.body).toBe(200);
    const placeholders = (people.json() as { items: { id: string; name: string }[]; total: number }).items;
    const bobPlaceholder = placeholders.find((entry) => entry.name === "Bob")?.id ?? "";
    expect(bobPlaceholder).not.toBe("");
    for (const path of [
      `/api/v1/imports/${id}/people`,
      `/api/v1/imports/${id}/groups`,
      `/api/v1/imports/${id}/permissions`,
      `/api/v1/imports/${id}/proposed-access`,
    ]) {
      expect((await outsider.client.get(path)).statusCode, path).toBe(404);
      expect((await reviewer.client.get(path)).statusCode, path).toBe(200);
    }
    const mapping = { mappings: [{ placeholderId: bobPlaceholder, accountId: bob.id }] };
    expect((await reviewer.client.post(`/api/v1/imports/${id}/people/mappings`, mapping)).statusCode).toBe(
      403,
    );
    const mapped = await owner.post(`/api/v1/imports/${id}/people/mappings`, mapping);
    expect(mapped.statusCode, mapped.body).toBe(200);
    const again = await owner.post(`/api/v1/imports/${id}/people/mappings`, mapping);
    expect(again.json()).toMatchObject({ code: "notPlaceholder" });

    const groups = (await owner.get(`/api/v1/imports/${id}/groups`)).json() as {
      key: string;
      group: unknown;
    }[];
    expect(groups.map((group) => group.key)).toEqual(expect.arrayContaining(["hr-team", "contractors"]));
    expect(
      (await reviewer.client.put(`/api/v1/imports/${id}/groups/contractors`, { create: true })).statusCode,
    ).toBe(403);
    const createdGroup = await owner.put(`/api/v1/imports/${id}/groups/contractors`, { create: true });
    expect(createdGroup.statusCode, createdGroup.body).toBe(200);
    expect(createdGroup.json()).toMatchObject({ key: "contractors", group: { name: "contractors" } });

    const permissions = (await owner.get(`/api/v1/imports/${id}/permissions?limit=100`)).json() as {
      items: { scope: string; item: { id: string; title: string | null } | null }[];
    };
    const secret = await test.runtime.pool.query<{ target_id: string }>(
      "select target_id from import_items where import_id = $1 and kind = 'page' and source_id = $2",
      [id, PEOPLE_PAGE.secret],
    );
    const restricted = permissions.items.find((entry) => entry.item?.id === secret.rows[0]?.target_id);
    expect(restricted?.item?.title).toBeNull();
    await test.runtime.pool.query(
      "insert into import_problems (id, import_id, category, code, key, item_id) values ($1, $2, 'links', 'brokenLink', 'secret', $3)",
      [randomUUID(), id, secret.rows[0]?.target_id],
    );
    const entries = (await owner.get(`/api/v1/imports/${id}/report/entries?limit=100`)).json() as {
      items: { item: { id: string; title: string } | null; restricted: boolean }[];
    };
    expect(entries.items.some((entry) => entry.restricted && entry.item === null)).toBe(true);
    expect(entries.items.some((entry) => entry.item?.id === secret.rows[0]?.target_id)).toBe(false);
    expect(entries.items.some((entry) => !entry.restricted && entry.item !== null)).toBe(true);
    expect((await owner.get(`/api/v1/items/${secret.rows[0]?.target_id}`)).statusCode).toBe(404);

    const proposal = (await owner.get(`/api/v1/imports/${id}/proposed-access`)).json() as {
      visibility: string;
      grants: { principalKind: string; principalId: string | null; role: string; name: string | null }[];
    };
    expect(proposal.grants).toContainEqual(
      expect.objectContaining({ principalKind: "account", principalId: alice.id, role: "admin" }),
    );
    const accepted = await owner.post(`/api/v1/imports/${id}/accept`, {
      visibility: proposal.visibility,
      grants: proposal.grants.map(({ name: _name, ...grant }) => grant),
    });
    expect(accepted.statusCode, accepted.body).toBe(200);
    const afterwards = await owner.post(
      `/api/v1/imports/${id}/people/user-list`,
      ["User id,User name,email", `${CAROL.accountId},Carol,${reviewer.id}@nowhere.example`].join("\n"),
      { "content-type": "text/csv" },
    );
    expect(afterwards.statusCode, afterwards.body).toBe(200);
    expect(afterwards.json()).toMatchObject({ matched: 0 });
    const view = await owner.get(`/api/v1/imports/${id}`);
    expect(view.body).not.toContain(secretToken);

    const second = await member();
    const carolAccount = await member();
    const assigned = await owner.post(`/api/v1/organizations/${organizationId}/role-assignments/batch`, {
      role: { builtIn: "administrator" },
      principals: [{ kind: "account", id: second.id }],
    });
    expect(assigned.statusCode, assigned.body).toBe(201);
    const remaining = (await second.client.get(`/api/v1/imports/${id}/people`)).json() as {
      items: { id: string; name: string; mappedTo: unknown }[];
    };
    const carolPlaceholder = remaining.items.find((entry) => entry.name === "Carol")?.id ?? "";
    expect(carolPlaceholder).not.toBe("");
    const carolMapping = { mappings: [{ placeholderId: carolPlaceholder, accountId: carolAccount.id }] };
    for (const client of [outsider.client, reviewer.client]) {
      expect([403, 404]).toContain(
        (await client.post(`/api/v1/imports/${id}/people/mappings`, carolMapping)).statusCode,
      );
      expect([403, 404]).toContain(
        (
          await client.post(`/api/v1/imports/${id}/people/user-list`, "User id,User name,email", {
            "content-type": "text/csv",
          })
        ).statusCode,
      );
      expect([403, 404]).toContain(
        (await client.put(`/api/v1/imports/${id}/groups/hr-team`, { create: true })).statusCode,
      );
    }
    const byOther = await second.client.post(`/api/v1/imports/${id}/people/mappings`, carolMapping);
    expect(byOther.statusCode, byOther.body).toBe(200);
    expect((await second.client.get(`/api/v1/imports/${id}`)).json()).toMatchObject({
      canResolve: true,
      canManage: false,
    });
  });
});
