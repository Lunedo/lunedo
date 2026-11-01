import { accountAttemptLimitSetting, clientAttemptLimitSetting } from "@lunedo/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addTotp,
  completeConfiguredSetup,
  configuredSetupEnv,
  createAccount,
  OWNER,
  signedInClient,
} from "../testing/accounts.js";
import { type AuthTestApp, createAuthTestApp, databaseBaseUrl, TestClient } from "../testing/auth-app.js";

interface Caller {
  name: string;
  get(path: string): ReturnType<TestClient["get"]>;
}

describe.skipIf(!databaseBaseUrl)("item lookup by number", () => {
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
    const created = await owner.post("/api/v1/organizations", { name: "Numbered content" });
    expect(created.statusCode, created.body).toBe(201);
    organizationId = created.json().id;
  });

  afterAll(async () => {
    await test?.close();
  });

  async function person(organization: string | undefined = organizationId) {
    counter += 1;
    const email = `numbers${counter}@lunedo.test`;
    const password = "a long enough passphrase";
    const account = await createAccount(test, email, password, organization);
    return { id: account.id, client: await signedInClient(test, email, password) };
  }

  async function space(confidential = false) {
    counter += 1;
    const created = await owner.post(`/api/v1/organizations/${organizationId}/spaces`, {
      name: `Numbers ${counter}`,
      key: `NUM${counter}X`,
      visibility: "private",
      grants: [],
      ...(confidential ? { confidential: true } : {}),
    });
    expect(created.statusCode, created.body).toBe(201);
    return created.json().id as string;
  }

  async function item(
    spaceId: string,
    kind: "page" | "folder",
    title: string,
    parentId: string | null = null,
  ) {
    const created = await owner.post(`/api/v1/spaces/${spaceId}/items`, {
      kind,
      title,
      parentId,
      mode: "live",
    });
    expect(created.statusCode, created.body).toBe(201);
    return created.json() as { id: string; number: number };
  }

  async function grant(spaceId: string, accountId: string, role: "reader" | "editor") {
    const granted = await owner.post(`/api/v1/spaces/${spaceId}/permissions`, {
      action: "grant",
      principalKind: "account",
      principalId: accountId,
      role,
    });
    expect(granted.statusCode, granted.body).toBe(200);
  }

  async function serviceToken(spaceId: string): Promise<string> {
    const account = await owner.post(`/api/v1/organizations/${organizationId}/service-accounts`, {
      name: `Reader ${counter}`,
    });
    expect(account.statusCode, account.body).toBe(201);
    await grant(spaceId, account.json().id, "reader");
    const created = await owner.post(`/api/v1/service-accounts/${account.json().id}/tokens`, {
      name: "Numbers",
      scopes: { organization: { spaces: "view" } },
      contentLevel: "read",
    });
    expect(created.statusCode, created.body).toBe(201);
    return created.json().token as string;
  }

  it("answers exactly like the item lookup for every kind of caller", async () => {
    const team = await space();
    const folder = await item(team, "folder", "Handbook");
    const page = await item(team, "page", "VPN access", folder.id);
    const secret = await item(team, "page", "Salary bands");
    const vault = await space(true);
    const confidential = await item(vault, "page", "Works council minutes");

    const reader = await person();
    const insider = await person();
    const member = await person();
    const guest = await person();
    const stranger = await person(
      (await owner.post("/api/v1/organizations", { name: "Elsewhere" })).json().id,
    );
    await grant(team, reader.id, "reader");
    await grant(team, insider.id, "editor");
    const restricted = await owner.post(`/api/v1/pages/${secret.id}/access`, {
      changes: [
        { action: "share", holderKind: "account", holderId: insider.id, role: "editor" },
        { action: "restrict", kind: "view" },
      ],
    });
    expect(restricted.statusCode, restricted.body).toBe(200);
    const shared = await owner.post(`/api/v1/pages/${page.id}/access`, {
      changes: [{ action: "share", holderKind: "account", holderId: guest.id, role: "reader" }],
    });
    expect(shared.statusCode, shared.body).toBe(200);
    const token = await serviceToken(team);
    const bot = new TestClient(test.app);

    const callers: Caller[] = [
      { name: "owner", get: (path) => owner.get(path) },
      { name: "reader", get: (path) => reader.client.get(path) },
      { name: "insider", get: (path) => insider.client.get(path) },
      { name: "member without role", get: (path) => member.client.get(path) },
      { name: "person with a share", get: (path) => guest.client.get(path) },
      { name: "other organization", get: (path) => stranger.client.get(path) },
      { name: "signed out", get: (path) => new TestClient(test.app).get(path) },
      { name: "API token", get: (path) => bot.get(path, { authorization: `Bearer ${token}` }) },
    ];
    const items = { folder, page, secret, confidential };
    const seen = new Set<string>();
    for (const caller of callers) {
      for (const [name, target] of Object.entries(items)) {
        const byId = await caller.get(`/api/v1/items/${target.id}`);
        const byNumber = await caller.get(`/api/v1/items/by-number/${target.number}`);
        const label = `${caller.name} · ${name}`;
        expect(byNumber.statusCode, label).toBe(byId.statusCode);
        expect(byNumber.json(), label).toEqual(byId.json());
        seen.add(`${byId.statusCode}`);
        const view = await caller.get(`/api/v1/pages/by-number/${target.number}/view`);
        expect(view.statusCode, label).toBe(byId.statusCode);
        if (view.statusCode !== 200) {
          expect(view.json(), label).toEqual(byNumber.json());
          continue;
        }
        const content = await caller.get(`/api/v1/pages/${target.id}/content`);
        const tasks = await caller.get(`/api/v1/pages/${target.id}/tasks`);
        const access = await caller.get(`/api/v1/pages/${target.id}/access/mine`);
        const isPage = target !== folder;
        expect(view.json(), label).toEqual({
          item: byNumber.json(),
          content: isPage ? content.json() : null,
          tasks: isPage ? tasks.json() : null,
          access: access.json(),
        });
        if (!isPage) continue;
        const panels = await caller.get(`/api/v1/pages/${target.id}/panels`);
        const part = async (path: string) => (await caller.get(path)).json();
        expect(panels.statusCode, label).toBe(200);
        expect(panels.json(), label).toEqual({
          labels: await part(`/api/v1/pages/${target.id}/labels`),
          reactions: await part(`/api/v1/pages/${target.id}/reactions`),
          watch: await part(`/api/v1/items/${target.id}/watch`),
          editors: await part(`/api/v1/pages/${target.id}/editors`),
          versions: await part(`/api/v1/pages/${target.id}/versions`),
          backlinks: await part(`/api/v1/pages/${target.id}/backlinks`),
          attachments: await part(`/api/v1/pages/${target.id}/attachments`),
          comments: await part(`/api/v1/pages/${target.id}/comments`),
        });
      }
    }
    expect(seen).toEqual(new Set(["200", "401", "404"]));
    expect((await reader.client.get(`/api/v1/items/by-number/${page.number}`)).json()).toMatchObject({
      id: page.id,
      number: page.number,
      ancestors: [{ id: folder.id, number: folder.number }],
    });
  });

  it("gives everyone the side information and the page of a published page with a draft as each endpoint does", async () => {
    const paragraph = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
    const document = (...texts: string[]) => ({ type: "doc", content: texts.map(paragraph) });
    const team = await space();
    const created = await owner.post(`/api/v1/spaces/${team}/items`, {
      kind: "page",
      title: "Travel policy",
      parentId: null,
      mode: "publish",
    });
    expect(created.statusCode, created.body).toBe(201);
    const page = created.json() as { id: string; number: number };
    const upload = async (name: string) => {
      const response = await owner.post(
        `/api/v1/pages/${page.id}/attachments?name=${encodeURIComponent(name)}`,
        Buffer.from(name),
        { "content-type": "application/octet-stream" },
      );
      expect(response.statusCode, response.body).toBe(201);
    };
    expect(
      (await owner.put(`/api/v1/pages/${page.id}/content`, { document: document("Published rules.") }))
        .statusCode,
    ).toBe(200);
    await upload("published.txt");
    expect((await owner.post(`/api/v1/pages/${page.id}/publish`, {})).statusCode).toBe(200);
    expect((await owner.post(`/api/v1/pages/${page.id}/labels`, { label: "travel" })).statusCode).toBe(200);
    const pageComment = await owner.post(`/api/v1/pages/${page.id}/comments`, {
      body: document("Looks good."),
    });
    expect(pageComment.statusCode, pageComment.body).toBe(201);
    expect(
      (
        await owner.put(`/api/v1/pages/${page.id}/content`, {
          document: document("Published rules.", "Draft secret."),
        })
      ).statusCode,
    ).toBe(200);
    await upload("draft.txt");
    const draftComment = await owner.post(`/api/v1/pages/${page.id}/comments`, {
      body: document("Ready?"),
      anchor: { exact: "Draft secret.", prefix: "", suffix: "" },
    });
    expect(draftComment.statusCode, draftComment.body).toBe(201);

    const reader = await person();
    const editor = await person();
    const member = await person();
    const guest = await person();
    const stranger = await person(
      (await owner.post("/api/v1/organizations", { name: `Elsewhere ${counter}` })).json().id,
    );
    await grant(team, reader.id, "reader");
    await grant(team, editor.id, "editor");
    const shared = await owner.post(`/api/v1/pages/${page.id}/access`, {
      changes: [{ action: "share", holderKind: "account", holderId: guest.id, role: "reader" }],
    });
    expect(shared.statusCode, shared.body).toBe(200);
    const callers: Caller[] = [
      { name: "owner", get: (path) => owner.get(path) },
      { name: "editor", get: (path) => editor.client.get(path) },
      { name: "reader", get: (path) => reader.client.get(path) },
      { name: "person with a share", get: (path) => guest.client.get(path) },
      { name: "member without role", get: (path) => member.client.get(path) },
      { name: "other organization", get: (path) => stranger.client.get(path) },
      { name: "signed out", get: (path) => new TestClient(test.app).get(path) },
    ];
    const parts = {
      labels: `/api/v1/pages/${page.id}/labels`,
      reactions: `/api/v1/pages/${page.id}/reactions`,
      watch: `/api/v1/items/${page.id}/watch`,
      editors: `/api/v1/pages/${page.id}/editors`,
      versions: `/api/v1/pages/${page.id}/versions`,
      backlinks: `/api/v1/pages/${page.id}/backlinks`,
      attachments: `/api/v1/pages/${page.id}/attachments`,
      comments: `/api/v1/pages/${page.id}/comments`,
    };
    const statuses = new Set<number>();
    const attachmentNames = new Map<string, string[]>();
    for (const caller of callers) {
      const panels = await caller.get(`/api/v1/pages/${page.id}/panels`);
      const view = await caller.get(`/api/v1/pages/by-number/${page.number}/view`);
      const item = await caller.get(`/api/v1/items/${page.id}`);
      statuses.add(panels.statusCode);
      expect(panels.statusCode, caller.name).toBe(item.statusCode);
      expect(view.statusCode, caller.name).toBe(item.statusCode);
      if (panels.statusCode !== 200) {
        expect(panels.json(), caller.name).toEqual(item.json());
        continue;
      }
      const separate: Record<string, unknown> = {};
      for (const [part, path] of Object.entries(parts)) {
        const response = await caller.get(path);
        expect(response.statusCode, `${caller.name} · ${part}`).toBe(200);
        separate[part] = response.json();
      }
      expect(panels.json(), caller.name).toEqual(separate);
      expect(view.json().content, caller.name).toEqual(
        (await caller.get(`/api/v1/pages/${page.id}/content`)).json(),
      );
      const listed = (panels.json() as { attachments: { name: string }[] }).attachments;
      attachmentNames.set(caller.name, listed.map((attachment) => attachment.name).sort());
    }
    expect(statuses).toEqual(new Set([200, 401, 404]));
    expect(attachmentNames.get("reader")).toEqual(["published.txt"]);
    expect(attachmentNames.get("person with a share")).toEqual(["published.txt"]);
    expect(attachmentNames.get("editor")).toEqual(["draft.txt", "published.txt"]);
  });

  it("gives an unknown number and a hidden number the same answer", async () => {
    const team = await space();
    const hidden = await item(team, "page", "Hidden");
    const outsider = await person();
    const unknown = await outsider.client.get(`/api/v1/items/by-number/${hidden.number + 1_000_000}`);
    const denied = await outsider.client.get(`/api/v1/items/by-number/${hidden.number}`);
    expect(unknown.statusCode).toBe(404);
    expect(denied.statusCode).toBe(404);
    expect(denied.json()).toEqual(unknown.json());
    for (const number of [hidden.number, hidden.number + 1_000_000]) {
      const requested = await outsider.client.post(`/api/v1/pages/by-number/${number}/access-requests`, {
        message: "Please",
      });
      expect(requested.statusCode, requested.body).toBe(202);
      expect(requested.body).toBe("");
    }
    const requests = await owner.get(`/api/v1/spaces/${team}/access-requests`);
    expect(requests.statusCode, requests.body).toBe(200);
    expect(requests.body).toContain(hidden.id);
    const mine = await outsider.client.get("/api/v1/access-requests/mine");
    expect(mine.statusCode, mine.body).toBe(200);
    expect(mine.body).not.toContain(hidden.id);
    expect(mine.body).not.toContain(team);
    for (const malformed of ["0", "-4", "12a", "1e3", "99999999999999999"]) {
      expect((await outsider.client.get(`/api/v1/items/by-number/${malformed}`)).statusCode, malformed).toBe(
        404,
      );
    }
  });

  it("creates no access request for content of an organization the person does not belong to", async () => {
    const team = await space();
    const hidden = await item(team, "page", "Board minutes");
    const elsewhere = await owner.post("/api/v1/organizations", { name: `Elsewhere ${counter}` });
    const stranger = await person(elsewhere.json().id);
    const requested = await stranger.client.post(`/api/v1/pages/by-number/${hidden.number}/access-requests`, {
      message: "Please",
    });
    const unknown = await stranger.client.post(
      `/api/v1/pages/by-number/${hidden.number + 1_000_000}/access-requests`,
      { message: "Please" },
    );
    expect(requested.statusCode, requested.body).toBe(202);
    expect(requested.body).toBe(unknown.body);
    expect((await stranger.client.get("/api/v1/access-requests/mine")).json()).toEqual([]);
    expect((await owner.get(`/api/v1/spaces/${team}/access-requests`)).body).not.toContain(hidden.id);
  });

  it("numbers new items in creation order from 1000 on", async () => {
    const team = await space();
    const first = await item(team, "page", "First");
    const second = await item(team, "folder", "Second");
    expect(second.number).toBeGreaterThan(first.number);
    expect(first.number).toBeGreaterThanOrEqual(1000);
  });
});
