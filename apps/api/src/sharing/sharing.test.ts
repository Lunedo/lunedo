import {
  accountAttemptLimitSetting,
  anyoneLinksSetting,
  clientAttemptLimitSetting,
  SYSTEM,
} from "@lunedo/server";
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
import { grayPng } from "../testing/images.js";

const DAY = 24 * 60 * 60 * 1000;

function paragraph(...content: unknown[]) {
  return { type: "paragraph", content };
}

describe.skipIf(!databaseBaseUrl)("page access through the API", () => {
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
    const email = `access${counter}@lunedo.test`;
    const password = "a long enough passphrase";
    const { id } = await createAccount(test, email, password);
    return { id, client: await signedInClient(test, email, password) };
  }

  async function space(grants: unknown[]) {
    counter += 1;
    const created = await owner.post(`/api/v1/organizations/${organizationId}/spaces`, {
      name: `Access ${counter}`,
      key: `A${counter}X`,
      visibility: "private",
      grants,
    });
    expect(created.statusCode, created.body).toBe(201);
    return created.json() as { id: string; key: string };
  }

  async function page(spaceId: string, title: string, parentId: string | null = null) {
    const created = await owner.post(`/api/v1/spaces/${spaceId}/items`, {
      kind: "page",
      title,
      parentId,
      mode: "live",
    });
    expect(created.statusCode, created.body).toBe(201);
    return (created.json() as { id: string }).id;
  }

  it("hide a restricted page in every API path, including its title", async () => {
    const insider = await person();
    const outsider = await person();
    const created = await space([
      { principalKind: "account", principalId: insider.id, role: "editor" },
      { principalKind: "account", principalId: outsider.id, role: "editor" },
    ]);
    const target = await page(created.id, "Glossary");
    const secret = await page(created.id, "Merger plans");
    const child = await page(created.id, "Merger timeline", secret);
    await owner.put(`/api/v1/pages/${secret}/content`, {
      document: { type: "doc", content: [paragraph({ type: "pageLink", attrs: { pageId: target } })] },
    });
    await owner.post(`/api/v1/pages/${secret}/labels`, { label: "merger" });
    await owner.post(`/api/v1/pages/${secret}/comments`, {
      body: { type: "doc", content: [paragraph({ type: "text", text: "Board only" })] },
    });
    const restricted = await owner.post(`/api/v1/pages/${secret}/access`, {
      changes: [
        { action: "share", holderKind: "account", holderId: insider.id, role: "editor" },
        { action: "restrict", kind: "view" },
      ],
    });
    expect(restricted.statusCode, restricted.body).toBe(200);
    const notFound = [
      `/api/v1/items/${secret}`,
      `/api/v1/items/${child}`,
      `/api/v1/pages/${secret}/content`,
      `/api/v1/pages/${secret}/markdown`,
      `/api/v1/pages/${secret}/labels`,
      `/api/v1/pages/${secret}/comments`,
      `/api/v1/pages/${secret}/tasks`,
      `/api/v1/pages/${secret}/backlinks`,
      `/api/v1/pages/${secret}/reactions`,
      `/api/v1/pages/${secret}/versions`,
      `/api/v1/pages/${secret}/attachments`,
    ];
    for (const path of notFound) {
      const response = await outsider.client.get(path);
      expect(response.statusCode, path).toBe(404);
      expect(response.body, path).not.toContain("Merger");
    }
    for (const path of [
      `/api/v1/spaces/${created.id}/items`,
      `/api/v1/spaces/${created.id}/items?parentId=${secret}`,
      `/api/v1/items?q=Merger`,
      `/api/v1/pages/${target}/backlinks`,
      `/api/v1/spaces/${created.id}/labels`,
      `/api/v1/spaces/${created.id}/labels/merger/pages`,
      `/api/v1/recent`,
      `/api/v1/tasks?assignee=me`,
      `/api/v1/spaces/${created.id}/restricted-pages`,
    ]) {
      const response = await outsider.client.get(path);
      expect(response.body, path).not.toContain("Merger");
    }
    expect((await insider.client.get(`/api/v1/items/${child}`)).statusCode).toBe(200);
    expect((await owner.get(`/api/v1/spaces/${created.id}/restricted-pages`)).body).toContain("Merger plans");
  });

  it("share a page with someone outside the space without revealing the space or its tree", async () => {
    const guest = await person();
    const created = await space([]);
    const root = await page(created.id, "Roadmap");
    const shared = await page(created.id, "Launch plan", root);
    await page(created.id, "Launch checklist", shared);
    const response = await owner.post(`/api/v1/pages/${shared}/access`, {
      changes: [{ action: "share", holderKind: "account", holderId: guest.id, role: "reader" }],
    });
    expect(response.statusCode, response.body).toBe(200);
    const details = await guest.client.get(`/api/v1/items/${shared}`);
    expect(details.statusCode).toBe(200);
    expect(details.json()).toMatchObject({ spaceKey: "", spaceName: "", spaceAccess: false, ancestors: [] });
    expect((await guest.client.get(`/api/v1/spaces/${created.id}/items`)).statusCode).toBe(404);
    expect((await guest.client.get(`/api/v1/items/${root}`)).statusCode).toBe(404);
    expect((await guest.client.get(`/api/v1/spaces/${created.id}`)).statusCode).toBe(404);
    const list = (await guest.client.get("/api/v1/shared-with-me")).json() as {
      itemId: string;
      spaceKey: string;
    }[];
    expect(list).toEqual([expect.objectContaining({ itemId: shared, spaceKey: "", spaceName: "" })]);
  });

  it("open links for anyone without an account, with password, rate limit and revocation", async () => {
    const created = await space([]);
    const shared = await page(created.id, "Status page");
    await test.runtime.settings.set(
      anyoneLinksSetting,
      { organization: organizationId },
      "organization",
      true,
    );
    try {
      const made = await owner.post(`/api/v1/pages/${shared}/share-links`, {
        scope: "anyone",
        expiresAt: new Date(Date.now() + DAY).toISOString(),
        password: "harbour lantern",
      });
      expect(made.statusCode, made.body).toBe(201);
      const { token, link } = made.json() as { token: string; link: { id: string } };
      const visitor = new TestClient(test.app, { remoteAddress: "203.0.113.50" });
      expect((await visitor.get(`/api/v1/share-links/${token}/page`)).statusCode).toBe(401);
      expect(
        (await visitor.post(`/api/v1/share-links/${token}/open`, { password: "wrong" })).statusCode,
      ).toBe(401);
      const opened = await visitor.post(`/api/v1/share-links/${token}/open`, { password: "harbour lantern" });
      expect(opened.statusCode, opened.body).toBe(200);
      expect(opened.json()).toMatchObject({ kind: "anonymous", number: null });
      const unlock = (opened.json() as { unlock: string }).unlock;
      const read = await visitor.get(`/api/v1/share-links/${token}/page`, { "x-lunedo-unlock": unlock });
      expect(read.statusCode, read.body).toBe(200);
      expect(read.json()).toMatchObject({ title: "Status page" });
      const inAddress = await visitor.get(
        `/api/v1/share-links/${token}/attachments/${shared}/content?unlock=${encodeURIComponent(unlock)}`,
      );
      expect(inAddress.statusCode).toBe(400);
      expect((await visitor.get(`/api/v1/items/${shared}`)).statusCode).toBe(401);
      expect((await owner.delete(`/api/v1/pages/${shared}/share-links/${link.id}`)).statusCode).toBe(204);
      expect(
        (await visitor.get(`/api/v1/share-links/${token}/page`, { "x-lunedo-unlock": unlock })).statusCode,
      ).toBe(404);
      const guesser = new TestClient(test.app, { remoteAddress: "203.0.113.51" });
      let limited = false;
      for (let attempt = 0; attempt < 40 && !limited; attempt += 1) {
        const response = await guesser.post(
          `/api/v1/share-links/${"x".repeat(16)}${String(attempt).padStart(32, "y")}/open`,
          {},
        );
        limited = response.statusCode === 429;
      }
      expect(limited).toBe(true);
    } finally {
      await test.runtime.settings.clear(anyoneLinksSetting, { organization: organizationId }, "organization");
    }
  });

  it("serve display versions through links for anyone only for images of the linked page", async () => {
    const created = await space([]);
    const shared = await page(created.id, "Floor plan");
    const other = await page(created.id, "Private plan");
    const image = async (pageId: string) => {
      const response = await owner.post(
        `/api/v1/pages/${pageId}/attachments?name=plan.png`,
        grayPng(2600, 1800),
        { "content-type": "application/octet-stream" },
      );
      expect(response.statusCode, response.body).toBe(201);
      const id = (response.json() as { id: string }).id;
      const content = await test.runtime.services.attachments.content(id, "draft");
      await test.runtime.services.displayVersions.create(content?.fileId ?? "", { lastAttempt: false });
      return id;
    };
    const visible = await image(shared);
    const hidden = await image(other);
    await test.runtime.settings.set(
      anyoneLinksSetting,
      { organization: organizationId },
      "organization",
      true,
    );
    try {
      const made = await owner.post(`/api/v1/pages/${shared}/share-links`, {
        scope: "anyone",
        expiresAt: new Date(Date.now() + DAY).toISOString(),
      });
      expect(made.statusCode, made.body).toBe(201);
      const { token } = made.json() as { token: string };
      const visitor = new TestClient(test.app, { remoteAddress: "203.0.113.60" });
      const base = `/api/v1/share-links/${token}/attachments`;
      const display = await visitor.get(`${base}/${visible}/content?size=display`);
      expect(display.statusCode).toBe(200);
      expect(display.headers["content-type"]).toBe("image/webp");
      expect((await visitor.get(`${base}/${visible}/content`)).headers["content-type"]).toBe("image/png");
      for (const size of ["display", "preview"]) {
        expect((await visitor.get(`${base}/${hidden}/content?size=${size}`)).statusCode).toBe(404);
      }
    } finally {
      await test.runtime.settings.clear(anyoneLinksSetting, { organization: organizationId }, "organization");
    }
  });

  it("list signed-in visitors of a link as via link and decide access requests", async () => {
    const member = await person();
    const created = await space([]);
    const shared = await page(created.id, "Onboarding");
    const made = await owner.post(`/api/v1/pages/${shared}/share-links`, { scope: "organization" });
    const { token } = made.json() as { token: string };
    const opened = await member.client.post(`/api/v1/share-links/${token}/open`, {});
    const sharedNumber = ((await owner.get(`/api/v1/items/${shared}`)).json() as { number: number }).number;
    expect(opened.json()).toEqual({ kind: "account", itemId: shared, number: sharedNumber, unlock: null });
    const access = await owner.get(`/api/v1/pages/${shared}/access`);
    const body = access.json() as { linkVisitors: { accountId: string }[]; canInviteGuests: boolean };
    expect(body.linkVisitors.map((v) => v.accountId)).toEqual([member.id]);
    expect(body.canInviteGuests).toBe(true);
    const links = await owner.get(`/api/v1/pages/${shared}/share-links`);
    expect((links.json() as { links: { token: string }[] }).links.map((l) => l.token)).toEqual([token]);
    const other = await page(created.id, "Budget");
    expect(
      (await member.client.post(`/api/v1/pages/${other}/access-requests`, { message: "Please" })).statusCode,
    ).toBe(202);
    const requests = await owner.get(`/api/v1/spaces/${created.id}/access-requests`);
    const [request] = requests.json() as { id: string; itemTitle: string; number: number | null }[];
    expect(request?.itemTitle).toBe("Budget");
    expect(request?.number).toBe(
      ((await owner.get(`/api/v1/items/${other}`)).json() as { number: number }).number,
    );
    const [mine] = (await member.client.get("/api/v1/access-requests/mine")).json() as {
      itemTitle: string | null;
      number: number | null;
    }[];
    expect(mine).toMatchObject({ itemTitle: null, number: null });
    expect((await owner.get(`/api/v1/access-requests/${request?.id}`)).json()).toMatchObject({
      status: "open",
    });
    expect((await member.client.get(`/api/v1/access-requests/${request?.id}`)).statusCode).toBe(200);
    const stranger = await person();
    expect((await stranger.client.get(`/api/v1/access-requests/${request?.id}`)).statusCode).toBe(404);
    const decided = await owner.post(`/api/v1/access-requests/${request?.id}/decide`, {
      approve: true,
      role: "reader",
    });
    expect(decided.statusCode, decided.body).toBe(200);
    expect((await member.client.get(`/api/v1/items/${other}`)).statusCode).toBe(200);
  });

  describe("a share never reaches further than the sharer's own access", () => {
    async function tree() {
      const alice = await person();
      const bob = await person();
      const created = await space([{ principalKind: "account", principalId: alice.id, role: "editor" }]);
      const parent = await page(created.id, "Handbook");
      const open = await page(created.id, "Onboarding", parent);
      const restricted = await page(created.id, "Salaries", parent);
      const restrict = await owner.post(`/api/v1/pages/${restricted}/access`, {
        changes: [{ action: "restrict", kind: "view" }],
      });
      expect(restrict.statusCode, restrict.body).toBe(200);
      const shared = await owner.post(`/api/v1/pages/${parent}/access`, {
        changes: [{ action: "share", holderKind: "account", holderId: bob.id, role: "editor" }],
      });
      expect(shared.statusCode, shared.body).toBe(200);
      return { alice, bob, space: created, parent, open, restricted };
    }

    async function shareOf(client: TestClient, pageId: string, holderId: string) {
      const access = await client.get(`/api/v1/pages/${pageId}/access`);
      expect(access.statusCode, access.body).toBe(200);
      const shares = (access.json() as { shares: { id: string; holder: { id: string } }[] }).shares;
      return shares.find((entry) => entry.holder.id === holderId)?.id ?? "";
    }

    it("refuses to change one's own share, also to include the pages below", async () => {
      const t = await tree();
      const own = await shareOf(t.bob.client, t.parent, t.bob.id);
      const widened = await t.bob.client.post(`/api/v1/pages/${t.parent}/access`, {
        changes: [{ action: "changeShare", shareId: own, includeDescendants: true }],
      });
      expect(widened.statusCode, widened.body).toBe(403);
      expect(widened.json().code).toBe("ownShare");
      expect((await t.bob.client.get(`/api/v1/items/${t.open}`)).statusCode).toBe(404);
      const lowered = await t.bob.client.post(`/api/v1/pages/${t.parent}/access`, {
        changes: [{ action: "changeShare", shareId: own, role: "reader" }],
      });
      expect(lowered.json().code).toBe("ownShare");
    });

    it("refuses to share the pages below with someone else beyond the sharer's own access", async () => {
      const t = await tree();
      const carol = await person();
      const byShare = await t.bob.client.post(`/api/v1/pages/${t.parent}/access`, {
        changes: [
          {
            action: "share",
            holderKind: "account",
            holderId: carol.id,
            role: "reader",
            includeDescendants: true,
          },
        ],
      });
      expect(byShare.statusCode, byShare.body).toBe(403);
      expect(byShare.json()).toMatchObject({ code: "shareBeyondOwnAccess", uncoveredPages: 2 });
      const bySpaceRole = await t.alice.client.post(`/api/v1/pages/${t.parent}/access`, {
        changes: [
          {
            action: "share",
            holderKind: "account",
            holderId: carol.id,
            role: "reader",
            includeDescendants: true,
          },
        ],
      });
      expect(bySpaceRole.statusCode, bySpaceRole.body).toBe(403);
      expect(bySpaceRole.json()).toMatchObject({ code: "shareBeyondOwnAccess", uncoveredPages: 1 });
      expect((await carol.client.get(`/api/v1/items/${t.open}`)).statusCode).toBe(404);
      const pageOnly = await t.bob.client.post(`/api/v1/pages/${t.parent}/access`, {
        changes: [{ action: "share", holderKind: "account", holderId: carol.id, role: "reader" }],
      });
      expect(pageOnly.statusCode, pageOnly.body).toBe(200);
      const raised = await t.bob.client.post(`/api/v1/pages/${t.parent}/access`, {
        changes: [
          { action: "changeShare", shareId: await shareOf(owner, t.parent, carol.id), role: "editor" },
        ],
      });
      expect(raised.statusCode, raised.body).toBe(403);
      expect(raised.json()).toMatchObject({ code: "shareBeyondOwnAccess", uncoveredPages: 0 });
      const covered = await t.alice.client.post(`/api/v1/pages/${t.open}/access`, {
        changes: [
          {
            action: "share",
            holderKind: "account",
            holderId: carol.id,
            role: "editor",
            includeDescendants: true,
          },
        ],
      });
      expect(covered.statusCode, covered.body).toBe(200);
    });

    it("refuses to widen a share for a group the sharer belongs to", async () => {
      const t = await tree();
      const created = await owner.post(`/api/v1/organizations/${organizationId}/groups`, {
        name: `Handbook readers ${counter}`,
      });
      expect(created.statusCode, created.body).toBe(201);
      const groupId = (created.json() as { id: string }).id;
      const added = await owner.post(`/api/v1/groups/${groupId}/members`, { accountId: t.bob.id });
      expect(added.statusCode, added.body).toBeLessThan(300);
      const toGroup = await t.bob.client.post(`/api/v1/pages/${t.parent}/access`, {
        changes: [
          {
            action: "share",
            holderKind: "group",
            holderId: groupId,
            role: "editor",
            includeDescendants: true,
          },
        ],
      });
      expect(toGroup.statusCode, toGroup.body).toBe(403);
      expect(toGroup.json().code).toBe("shareBeyondOwnAccess");
      const byOwner = await owner.post(`/api/v1/pages/${t.parent}/access`, {
        changes: [{ action: "share", holderKind: "group", holderId: groupId, role: "reader" }],
      });
      expect(byOwner.statusCode, byOwner.body).toBe(200);
      const changed = await t.bob.client.post(`/api/v1/pages/${t.parent}/access`, {
        changes: [
          {
            action: "changeShare",
            shareId: await shareOf(owner, t.parent, groupId),
            includeDescendants: true,
          },
        ],
      });
      expect(changed.statusCode, changed.body).toBe(403);
      expect(changed.json().code).toBe("ownShare");
    });

    it("refuses to approve an access request for the pages below beyond the approver's own access", async () => {
      const t = await tree();
      const carol = await person();
      const requested = await carol.client.post(`/api/v1/pages/${t.parent}/access-requests`, { message: "" });
      expect(requested.statusCode, requested.body).toBe(202);
      const requests = await owner.get(`/api/v1/spaces/${t.space.id}/access-requests`);
      const request = (requests.json() as { id: string; itemId: string | null }[]).find(
        (entry) => entry.itemId === t.parent,
      );
      const decided = await t.bob.client.post(`/api/v1/access-requests/${request?.id}/decide`, {
        approve: true,
        role: "reader",
        includeDescendants: true,
      });
      expect(decided.statusCode, decided.body).toBe(403);
      expect(decided.json()).toMatchObject({ code: "shareBeyondOwnAccess", uncoveredPages: 2 });
      expect((await owner.get(`/api/v1/access-requests/${request?.id}`)).json()).toMatchObject({
        status: "open",
      });
      expect((await carol.client.get(`/api/v1/items/${t.open}`)).statusCode).toBe(404);
    });

    it("refuses to invite a guest to the pages below beyond the sharer's own access", async () => {
      const t = await tree();
      await test.runtime.services.roles.assign(SYSTEM, {
        scope: "organization",
        organizationId,
        role: { builtIn: "administrator" },
        principal: { kind: "account", id: t.alice.id },
      });
      const invited = await t.alice.client.post(`/api/v1/pages/${t.parent}/access/invitations`, {
        email: `guest${counter}@example.net`,
        role: "reader",
        includeDescendants: true,
      });
      expect(invited.statusCode, invited.body).toBe(403);
      expect(invited.json()).toMatchObject({ code: "shareBeyondOwnAccess", uncoveredPages: 1 });
    });
  });

  it("let only space administrators invite guests into a confidential space", async () => {
    const administrator = await person();
    await test.runtime.services.roles.assign(SYSTEM, {
      scope: "organization",
      organizationId,
      role: { builtIn: "administrator" },
      principal: { kind: "account", id: administrator.id },
    });
    counter += 1;
    const created = await owner.post(`/api/v1/organizations/${organizationId}/spaces`, {
      name: `Confidential ${counter}`,
      key: `C${counter}X`,
      visibility: "private",
      confidential: true,
      grants: [{ principalKind: "account", principalId: administrator.id, role: "editor" }],
    });
    expect(created.statusCode, created.body).toBe(201);
    const pageId = await page((created.json() as { id: string }).id, "Board minutes");
    const access = await administrator.client.get(`/api/v1/pages/${pageId}/access`);
    expect(access.json()).toMatchObject({ canInviteGuests: false });
    const refused = await administrator.client.post(`/api/v1/pages/${pageId}/access/invitations`, {
      email: `confidential${counter}@example.net`,
      role: "reader",
      includeDescendants: false,
    });
    expect(refused.statusCode, refused.body).toBe(403);
    expect(refused.json()).toMatchObject({ code: "confidentialGuestsBySpaceAdmins" });
    const invited = await owner.post(`/api/v1/pages/${pageId}/access/invitations`, {
      email: `confidential${counter}@example.net`,
      role: "reader",
      includeDescendants: false,
    });
    expect(invited.statusCode, invited.body).toBe(201);
  });

  it("explain what a person can do and export the overview as CSV", async () => {
    const member = await person();
    const created = await space([{ principalKind: "account", principalId: member.id, role: "reader" }]);
    const access = await owner.get(`/api/v1/organizations/${organizationId}/people/${member.id}/access`);
    expect(access.statusCode, access.body).toBe(200);
    expect((access.json() as { entries: { spaceId: string; kind: string }[] }).entries).toContainEqual(
      expect.objectContaining({ spaceId: created.id, kind: "space" }),
    );
    const csv = await owner.get(
      `/api/v1/organizations/${organizationId}/access-overview?accountId=${member.id}`,
    );
    expect(csv.statusCode).toBe(200);
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(csv.body.split("\r\n")[0]).toBe("person,email,kind,space,page,role,pages,reason");
    expect(
      (await member.client.get(`/api/v1/organizations/${organizationId}/access-overview`)).statusCode,
    ).toBe(403);
  });

  it("keep each person's Give access draft per space until it is discarded", async () => {
    const admin = await person();
    const reader = await person();
    const created = await space([
      { principalKind: "account", principalId: admin.id, role: "admin" },
      { principalKind: "account", principalId: reader.id, role: "reader" },
    ]);
    const url = `/api/v1/spaces/${created.id}/give-access/draft`;
    const draft = {
      step: 2,
      holder: { kind: "account", id: reader.id, name: "Reader" },
      level: "editor",
      where: "space",
      page: null,
    };
    expect((await admin.client.get(url)).json()).toEqual({ draft: null });
    const saved = await admin.client.put(url, draft);
    expect(saved.statusCode, saved.body).toBe(200);
    expect((await admin.client.get(url)).json()).toEqual({ draft });
    expect((await owner.get(url)).json()).toEqual({ draft: null });
    expect((await reader.client.get(url)).statusCode).toBe(403);
    expect((await reader.client.put(url, draft)).statusCode).toBe(403);
    expect((await admin.client.put(url, { ...draft, level: "owner" })).statusCode).toBe(400);
    expect((await admin.client.delete(url)).statusCode).toBe(204);
    expect((await admin.client.get(url)).json()).toEqual({ draft: null });
  });
});
