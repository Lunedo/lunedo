import { createHash, randomUUID } from "node:crypto";
import { accountAttemptLimitSetting, clientAttemptLimitSetting } from "@pagehall/server";
import {
  createXmlExport,
  foreignExport,
  RE,
  reimportAfter,
  reimportBefore,
  type SyntheticExport,
  testJobContext,
  tinyLinkCode,
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

interface Change {
  id: string;
  change: string;
  item: { id: string } | null;
  permission: { scope: string; action: string; applicable: boolean } | null;
}

describe.skipIf(!databaseBaseUrl)("re-imports and old Confluence links through the API", () => {
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

  async function member() {
    counter += 1;
    const email = `reimports${counter}@pagehall.test`;
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

  async function uploadExport(model: SyntheticExport) {
    const archive = createXmlExport(model);
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
      await owner.put(
        `/api/v1/organizations/${organizationId}/import-uploads/${upload.id}/parts/${number}?sha256=${sha256(part)}`,
        part,
        { "content-type": "application/octet-stream" },
      );
    }
    await owner.post(`/api/v1/organizations/${organizationId}/import-uploads/${upload.id}/complete`, {
      sha256: sha256(digests.join("")),
    });
    return upload.id;
  }

  async function analyzed(model: SyntheticExport, spaceId?: string) {
    const created = await owner.post(`/api/v1/organizations/${organizationId}/imports`, {
      source: "confluence-xml",
      ...(spaceId ? { spaceId } : {}),
    });
    expect(created.statusCode, created.body).toBe(201);
    const id = (created.json() as { id: string }).id;
    const uploadId = await uploadExport(model);
    await owner.patch(`/api/v1/imports/${id}`, { file: { kind: "upload", uploadId } });
    await work(id);
    return id;
  }

  async function started(id: string) {
    const people = await owner.put(`/api/v1/imports/${id}/people-source`, { kind: "skip", confirmed: true });
    expect(people.statusCode, people.body).toBe(200);
    const start = await owner.post(`/api/v1/imports/${id}/start`);
    expect(start.statusCode, start.body).toBe(200);
    await work(id);
  }

  async function acceptedSpace() {
    const key = `A${randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase()}`;
    const id = await analyzed(reimportBefore());
    await owner.patch(`/api/v1/imports/${id}`, { spaceName: `Import ${key}`, spaceKey: key });
    await started(id);
    const accepted = await owner.post(`/api/v1/imports/${id}/accept`, { visibility: "private", grants: [] });
    expect(accepted.statusCode, accepted.body).toBe(200);
    const view = accepted.json() as { quarantineSpace: { id: string }; reimportSpaceId: string | null };
    expect(view.reimportSpaceId).toBe(view.quarantineSpace.id);
    return { importId: id, spaceId: view.quarantineSpace.id, key };
  }

  async function changes(client: TestClient, id: string, tab: string) {
    const response = await client.get(`/api/v1/imports/${id}/changes?tab=${tab}`);
    expect(response.statusCode, response.body).toBe(200);
    return (response.json() as { items: Change[] }).items;
  }

  it("compares, decides and applies a re-import, changing nothing before applying", async () => {
    const { spaceId } = await acceptedSpace();
    const id = await analyzed(reimportAfter(), spaceId);
    const ready = (await owner.get(`/api/v1/imports/${id}`)).json() as {
      state: string;
      targetSpace: { id: string };
    };
    expect(ready).toMatchObject({ state: "ready", targetSpace: { id: spaceId } });
    const renamed = await owner.patch(`/api/v1/imports/${id}`, { spaceKey: "OTHER" });
    expect(renamed.statusCode).toBe(400);
    expect(renamed.json()).toMatchObject({ code: "reimportSpaceFixed" });
    await started(id);
    const summary = await owner.get(`/api/v1/imports/${id}/changes/summary`);
    expect(summary.statusCode, summary.body).toBe(200);
    expect(summary.json()).toMatchObject({
      counts: { new: 2, updated: 6, conflicts: 0, deleted: 2 },
      open: 2,
      applying: false,
    });
    const items = await test.runtime.pool.query<{ count: number }>(
      "select count(*)::int as count from tree_items where space_id = $1",
      [spaceId],
    );
    const deleted = await changes(owner, id, "deleted");
    const pages = deleted.filter((entry) => entry.change === "deleted");
    expect(pages).toHaveLength(2);

    const invalid = await owner.put(`/api/v1/imports/${id}/changes/decisions`, {
      ids: pages.map((entry) => entry.id),
      decision: "source",
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({ code: "invalidDecision" });
    const unknown = await owner.put(`/api/v1/imports/${id}/changes/decisions`, {
      ids: [randomUUID()],
      decision: "keep",
    });
    expect(unknown.statusCode).toBe(404);
    const decided = await owner.put(`/api/v1/imports/${id}/changes/decisions`, {
      ids: pages.map((entry) => entry.id),
      decision: "keep",
    });
    expect(decided.json()).toEqual({ decided: 2 });
    const unchanged = await test.runtime.pool.query<{ count: number }>(
      "select count(*)::int as count from tree_items where space_id = $1",
      [spaceId],
    );
    expect(unchanged.rows[0]?.count).toBe(items.rows[0]?.count);

    const applied = await owner.post(`/api/v1/imports/${id}/apply`);
    expect(applied.statusCode, applied.body).toBe(200);
    expect(applied.json()).toMatchObject({ state: "running" });
    await work(id);
    const after = (await owner.get(`/api/v1/imports/${id}`)).json() as { state: string };
    expect(after.state).toBe("accepted");
    const created = await test.runtime.pool.query<{ count: number }>(
      "select count(*)::int as count from tree_items where space_id = $1",
      [spaceId],
    );
    expect(created.rows[0]?.count).toBe((items.rows[0]?.count ?? 0) + 2);
    const events = await test.runtime.pool.query<{ name: string }>(
      "select name from audit_events where target_id = $1",
      [id],
    );
    expect(events.rows.map((row) => row.name)).toEqual(
      expect.arrayContaining(["import.reimportStarted", "import.conflictsDecided", "import.reimportApplied"]),
    );
  });

  it("shows a permission difference's effect before applying it", async () => {
    const { spaceId } = await acceptedSpace();
    const id = await analyzed(reimportAfter(), spaceId);
    await started(id);
    const differences = await changes(owner, id, "permissions");
    const page = differences.find((entry) => entry.permission?.scope === "page");
    expect(page).toBeUndefined();
    const space = differences.find((entry) => entry.permission?.scope === "space");
    expect(space?.permission).toMatchObject({ action: "grant", applicable: false });
    const blocked = await owner.post(`/api/v1/imports/${id}/changes/${space?.id}/preview`);
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json()).toMatchObject({ code: "holderNotInPagehall" });
  });

  it("refuses an export of another Confluence space", async () => {
    const { spaceId } = await acceptedSpace();
    const id = await analyzed(foreignExport(), spaceId);
    const view = (await owner.get(`/api/v1/imports/${id}`)).json();
    expect(view).toMatchObject({ state: "draft", errorCode: "foreignSpace" });
  });

  it("keeps the changes from people who cannot see the import", async () => {
    const { spaceId } = await acceptedSpace();
    const id = await analyzed(reimportAfter(), spaceId);
    await started(id);
    const outsider = await member();
    for (const path of [
      `/api/v1/imports/${id}/changes/summary`,
      `/api/v1/imports/${id}/changes?tab=conflicts`,
    ]) {
      expect((await outsider.client.get(path)).statusCode).toBe(404);
    }
    const decided = await outsider.client.put(`/api/v1/imports/${id}/changes/decisions`, {
      ids: [randomUUID()],
      decision: "keep",
    });
    expect(decided.statusCode).toBe(404);
    expect((await outsider.client.post(`/api/v1/imports/${id}/apply`)).statusCode).toBe(404);
  });

  it("resolves old Confluence links and answers alike for unknown and hidden pages", async () => {
    const { importId, key } = await acceptedSpace();
    const steady = await test.runtime.pool.query<{ target_id: string }>(
      "select target_id from import_items where import_id = $1 and kind = 'page' and source_id = $2",
      [importId, RE.steady],
    );
    const url = (link: string) => `/api/v1/confluence-links?url=${encodeURIComponent(link)}`;
    for (const link of [
      `https://example.atlassian.net/wiki/spaces/REI/pages/${RE.steady}/Steady`,
      "https://wiki.example.org/display/REI/Steady",
      `https://wiki.example.org/x/${tinyLinkCode(RE.steady)}`,
    ]) {
      const response = await owner.get(url(link));
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json()).toMatchObject({
        itemId: steady.rows[0]?.target_id,
        spaceKey: key,
        kind: "page",
      });
    }
    const strip = (body: Record<string, unknown>) => {
      const { instance: _instance, requestId: _requestId, traceId: _traceId, ...rest } = body;
      return rest;
    };
    const unknown = await owner.get(url("https://wiki.example.org/pages/viewpage.action?pageId=99999999"));
    const hidden = await owner.get(
      url(`https://wiki.example.org/pages/viewpage.action?pageId=${RE.restricted}`),
    );
    expect(unknown.statusCode).toBe(404);
    expect(hidden.statusCode).toBe(404);
    expect(strip(hidden.json())).toEqual(strip(unknown.json()));
    const outsider = await member();
    const foreign = await outsider.client.get(url(`https://wiki.example.org/x/${tinyLinkCode(RE.steady)}`));
    expect(foreign.statusCode).toBe(404);
    expect(strip(foreign.json())).toEqual(strip(unknown.json()));
    expect((await new TestClient(test.app).get(url("/display/REI/Steady"))).statusCode).toBe(401);
  });
});
