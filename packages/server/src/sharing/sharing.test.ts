import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ANONYMOUS, accountPrincipal, type Principal, SYSTEM } from "../accounts/principal.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { spaceFixtures } from "../testing/spaces.js";
import { readText } from "../testing/streams.js";
import { anyoneLinkMaxDaysSetting, anyoneLinksSetting, shareLinksSetting } from "./settings.js";

const baseUrl = testDatabaseBaseUrl();
const DAY = 24 * 60 * 60 * 1000;

describe.skipIf(!baseUrl)("sharing", () => {
  let test: TestServices;
  const { organization, member, space, account, group } = spaceFixtures(() => test);

  beforeAll(async () => {
    test = await createTestServices(baseUrl ?? "");
    await test.pool.query("insert into instance (id, setup_completed_at) values (1, now())");
  });

  afterAll(async () => {
    await test?.close();
  });

  async function setup() {
    const org = await organization();
    const editorId = await member(org.id, "member", "Editor");
    const outsiderId = await member(org.id, "member", "Anna Outsider");
    const created = await space(org.id, editorId);
    const editor = accountPrincipal(editorId);
    const make = (title: string, parentId: string | null) =>
      test.services.tree.create(editor, created.id, {
        kind: "page",
        title,
        mode: "live",
        placement: { parentId },
      });
    const root = await make("Roadmap", null);
    const shared = await make("Launch plan", root.id);
    const child = await make("Launch checklist", shared.id);
    const sibling = await make("Hiring", root.id);
    return {
      org,
      space: created,
      editorId,
      outsiderId,
      editor,
      outsider: accountPrincipal(outsiderId),
      root,
      shared,
      child,
      sibling,
    };
  }

  type Context = Awaited<ReturnType<typeof setup>>;

  async function can(viewer: Principal, action: string, resource: { type: string; id: string }) {
    return (await test.services.authorization.explain(viewer, action, resource, { fresh: true })).allowed;
  }

  async function share(
    context: Context,
    options: { includeDescendants?: boolean; role?: "reader" | "editor" } = {},
  ) {
    await test.services.pageAccess.change(context.editor, context.shared.id, [
      {
        action: "share",
        holderKind: "account",
        holderId: context.outsiderId,
        role: options.role ?? "reader",
        includeDescendants: options.includeDescendants ?? false,
      },
    ]);
  }

  describe("pages with people outside the space", () => {
    it("shows only the shared page; the tree, parents and other pages stay hidden with their titles", async () => {
      const context = await setup();
      await share(context);
      expect(await can(context.outsider, "item.view", { type: "item", id: context.shared.id })).toBe(true);
      expect(await can(context.outsider, "space.view", { type: "space", id: context.space.id })).toBe(false);
      for (const hidden of [context.root, context.child, context.sibling]) {
        expect(await can(context.outsider, "item.view", { type: "item", id: hidden.id })).toBe(false);
      }
      const details = await test.services.tree.details(context.outsider, context.shared.id);
      expect(details).toMatchObject({ spaceKey: "", spaceName: "", spaceAccess: false, ancestors: [] });
      expect(
        (await test.services.tree.search(context.outsider, { query: "Roadmap" })).map((item) => item.title),
      ).toEqual([]);
      expect(await test.services.documents.backlinks(context.outsider, context.root.id)).toEqual([]);
    });

    it("names only the parents a person can read in label lists", async () => {
      const context = await setup();
      await share(context);
      const label = `path-${randomUUID().slice(0, 6)}`;
      await test.services.documents.addLabel(context.editor, context.shared.id, label);
      const request = {
        labels: [label],
        matchAll: false,
        spaceIds: [],
        kinds: ["page" as const],
        sort: "modified" as const,
        reverse: false,
        limit: 10,
        excerpts: false,
      };
      expect(
        (await test.services.reports.labeledContent(context.editor, request)).map((entry) => entry.parents),
      ).toEqual([["Roadmap"]]);
      const forOutsider = await test.services.reports.labeledContent(context.outsider, request);
      expect(forOutsider.map((entry) => [entry.id, entry.parents])).toEqual([[context.shared.id, []]]);
      expect(forOutsider[0]?.contentUpdatedAt).toBeInstanceOf(Date);
      expect(
        (await test.services.documents.pagesWithLabel(context.editor, context.space.id, label)).map(
          (page) => page.parents,
        ),
      ).toEqual([["Roadmap"]]);
    });

    it("lists the pages shared with someone, without the space they cannot see", async () => {
      const context = await setup();
      await share(context);
      expect(await test.services.pageAccess.sharedWith(context.outsider)).toEqual([
        expect.objectContaining({
          itemId: context.shared.id,
          number: context.shared.number,
          title: "Launch plan",
          role: "reader",
          sharedBy: { id: context.editorId, name: "Editor" },
          spaceKey: "",
          spaceName: "",
        }),
      ]);
      await test.services.pageAccess.change(context.editor, context.shared.id, [
        { action: "restrict", kind: "view" },
      ]);
      expect(
        (await test.services.pageAccess.sharedWith(context.outsider)).map((entry) => entry.itemId),
      ).toEqual([context.shared.id]);
      await test.services.pageAccess.change(context.editor, context.root.id, [
        { action: "restrict", kind: "view" },
      ]);
      expect(await test.services.pageAccess.sharedWith(context.outsider)).toEqual([]);
      expect(await test.services.pageAccess.sharedWith(context.editor)).toEqual([]);
    });

    it("includes the descendants only when the sharer chooses so", async () => {
      const context = await setup();
      await share(context, { includeDescendants: true });
      expect(await can(context.outsider, "item.view", { type: "item", id: context.child.id })).toBe(true);
      expect(await can(context.outsider, "item.view", { type: "item", id: context.sibling.id })).toBe(false);
      const details = await test.services.tree.details(context.outsider, context.child.id);
      expect(details?.ancestors.map((ancestor) => ancestor.title)).toEqual(["Launch plan"]);
    });

    it("grants the chosen role and never more", async () => {
      const context = await setup();
      await share(context, { role: "reader" });
      expect(await can(context.outsider, "item.edit", { type: "item", id: context.shared.id })).toBe(false);
      expect(await can(context.outsider, "item.comment", { type: "item", id: context.shared.id })).toBe(
        false,
      );
      expect(await can(context.outsider, "item.share", { type: "item", id: context.shared.id })).toBe(false);
      const access = await test.services.pageAccess.get(context.editor, context.shared.id);
      await test.services.pageAccess.change(context.editor, context.shared.id, [
        { action: "changeShare", shareId: access.shares[0]?.id ?? "", role: "editor" },
      ]);
      expect(await can(context.outsider, "item.edit", { type: "item", id: context.shared.id })).toBe(true);
      expect(await can(context.outsider, "item.delete", { type: "item", id: context.shared.id })).toBe(true);
      expect(await can(context.outsider, "space.edit", { type: "space", id: context.space.id })).toBe(false);
    });

    it("hides unpublished pages from readers who got them shared", async () => {
      const context = await setup();
      const draft = await test.services.tree.create(context.editor, context.space.id, {
        kind: "page",
        title: "Draft memo",
        mode: "publish",
        placement: { parentId: null },
      });
      await test.services.pageAccess.change(context.editor, draft.id, [
        { action: "share", holderKind: "account", holderId: context.outsiderId, role: "reader" },
      ]);
      expect(await can(context.outsider, "item.view", { type: "item", id: draft.id })).toBe(false);
    });

    it("refuses readers as sharers, portal accounts as recipients and groups of other organizations", async () => {
      const context = await setup();
      await share(context);
      await expect(
        test.services.pageAccess.change(context.outsider, context.shared.id, [
          { action: "share", holderKind: "account", holderId: context.editorId, role: "reader" },
        ]),
      ).rejects.toMatchObject({ name: "ForbiddenError" });
      const portal = await account();
      await test.pool.query("update accounts set type = 'portal' where id = $1", [portal]);
      await expect(
        test.services.pageAccess.change(context.editor, context.shared.id, [
          { action: "share", holderKind: "account", holderId: portal, role: "reader" },
        ]),
      ).rejects.toMatchObject({ code: "invalidHolder" });
      const other = await organization();
      const foreign = await group(other.id, []);
      await expect(
        test.services.pageAccess.change(context.editor, context.shared.id, [
          { action: "share", holderKind: "group", holderId: foreign, role: "reader" },
        ]),
      ).rejects.toMatchObject({ code: "invalidHolder" });
    });

    it("notifies the person the page was shared with and audits the share", async () => {
      const context = await setup();
      await share(context);
      const notifications = await test.services.notifications.list(context.outsiderId, { limit: 10 });
      expect(notifications.items.map((item) => item.type)).toEqual(["page.shared"]);
      const audit = await test.pool.query<{ name: string }>(
        "select name from audit_events where target_id = $1 order by occurred_at",
        [context.shared.id],
      );
      expect(audit.rows.map((row) => row.name)).toContain("page.shared");
    });

    it("previews who gains or loses access before the change", async () => {
      const context = await setup();
      const impact = await test.services.pageAccess.preview(context.editor, context.shared.id, [
        { action: "share", holderKind: "account", holderId: context.outsiderId, role: "editor" },
      ]);
      expect(impact.read.gaining).toBe(1);
      expect(impact.edit.gaining).toBe(1);
      expect(impact.read.changes.map((change) => change.name)).toEqual(["Anna Outsider"]);
      expect(await can(context.outsider, "item.view", { type: "item", id: context.shared.id })).toBe(false);
      const restricting = await test.services.pageAccess.preview(context.editor, context.root.id, [
        { action: "restrict", kind: "view" },
      ]);
      expect(restricting.read.losing).toBe(0);
    });
  });

  describe("share links", () => {
    async function link(
      context: Context,
      input: Parameters<TestServices["services"]["shareLinks"]["create"]>[2],
    ) {
      return test.services.shareLinks.create(context.editor, context.shared.id, input);
    }

    it("lets signed-in members of the organization open a page and lists them as visitors", async () => {
      const context = await setup();
      const { token } = await link(context, { scope: "organization" });
      const listed = await test.services.shareLinks.list(context.editor, context.shared.id);
      expect(listed.map((entry) => entry.token)).toEqual([token]);
      const stored = await test.database.execute<{ secret: Buffer }>(
        sql`select secret from share_links where item_id = ${context.shared.id}`,
      );
      expect(stored.rows[0]?.secret.includes(Buffer.from(token.slice(16)))).toBe(false);
      expect(await can(context.outsider, "item.view", { type: "item", id: context.shared.id })).toBe(false);
      const opened = await test.services.shareLinks.open(token, context.outsider, { clientIp: "192.0.2.1" });
      expect(opened).toEqual({ kind: "account", itemId: context.shared.id, number: context.shared.number });
      expect(await can(context.outsider, "item.view", { type: "item", id: context.shared.id })).toBe(true);
      expect(await can(context.outsider, "item.comment", { type: "item", id: context.shared.id })).toBe(
        false,
      );
      expect(await can(context.outsider, "item.edit", { type: "item", id: context.shared.id })).toBe(false);
      expect(await can(context.outsider, "item.view", { type: "item", id: context.child.id })).toBe(false);
      const access = await test.services.pageAccess.get(context.editor, context.shared.id);
      expect(access.linkVisitors.map((visitor) => visitor.accountId)).toEqual([context.outsiderId]);
      const stranger = await account();
      await expect(
        test.services.shareLinks.open(token, accountPrincipal(stranger), { clientIp: "192.0.2.1" }),
      ).rejects.toMatchObject({ code: "linkNotForYou" });
      await expect(
        test.services.shareLinks.open(token, ANONYMOUS, { clientIp: "192.0.2.1" }),
      ).rejects.toMatchObject({
        code: "signInRequired",
      });
    });

    it("opens for named people only and for every internal user of the instance", async () => {
      const context = await setup();
      const named = await link(context, {
        scope: "people",
        people: [{ kind: "account", id: context.outsiderId }],
      });
      const someoneElse = await member(context.org.id);
      await expect(
        test.services.shareLinks.open(named.token, accountPrincipal(someoneElse), { clientIp: "192.0.2.2" }),
      ).rejects.toMatchObject({ code: "linkNotForYou" });
      await test.services.shareLinks.open(named.token, context.outsider, { clientIp: "192.0.2.2" });
      const instance = await link(context, { scope: "instance" });
      const stranger = await account();
      await test.services.shareLinks.open(instance.token, accountPrincipal(stranger), {
        clientIp: "192.0.2.2",
      });
      expect(
        await can(accountPrincipal(stranger), "item.view", { type: "item", id: context.shared.id }),
      ).toBe(true);
    });

    it("allows links for anyone only when the organization enables them, with an expiry within its maximum", async () => {
      const context = await setup();
      await expect(
        link(context, { scope: "anyone", expiresAt: new Date(Date.now() + DAY) }),
      ).rejects.toMatchObject({ code: "anyoneLinksDisabled" });
      await test.settings.set(anyoneLinksSetting, { organization: context.org.id }, "organization", true);
      await test.settings.set(anyoneLinkMaxDaysSetting, { organization: context.org.id }, "organization", 7);
      await expect(link(context, { scope: "anyone" })).rejects.toMatchObject({ code: "expiryRequired" });
      await expect(
        link(context, { scope: "anyone", expiresAt: new Date(Date.now() + 8 * DAY) }),
      ).rejects.toMatchObject({ code: "expiryTooLate" });
      const { token } = await link(context, { scope: "anyone", expiresAt: new Date(Date.now() + 6 * DAY) });
      const opened = await test.services.shareLinks.open(token, ANONYMOUS, { clientIp: "192.0.2.3" });
      expect(opened).toEqual({ kind: "anonymous", itemId: context.shared.id, unlock: null });
      expect(await test.services.shareLinks.resolveAnonymous(token, undefined, "192.0.2.3")).toBe(
        context.shared.id,
      );
      await test.settings.set(anyoneLinksSetting, { organization: context.org.id }, "organization", false);
      await expect(
        test.services.shareLinks.resolveAnonymous(token, undefined, "192.0.2.3"),
      ).rejects.toMatchObject({
        code: "signInRequired",
      });
    });

    it("stops working after the expiry", async () => {
      const context = await setup();
      const { token, link: created } = await link(context, {
        scope: "organization",
        expiresAt: new Date(Date.now() + DAY),
      });
      await test.services.shareLinks.open(token, context.outsider, { clientIp: "192.0.2.4" });
      await test.pool.query("update share_links set expires_at = now() - interval '1 second' where id = $1", [
        created.id,
      ]);
      expect(await can(context.outsider, "item.view", { type: "item", id: context.shared.id })).toBe(false);
      await expect(
        test.services.shareLinks.open(token, context.outsider, { clientIp: "192.0.2.4" }),
      ).rejects.toMatchObject({ code: "linkNotFound" });
    });

    it("asks for the password, stores only its hash and limits the attempts", async () => {
      const context = await setup();
      await test.settings.set(anyoneLinksSetting, { organization: context.org.id }, "organization", true);
      const { token, link: created } = await link(context, {
        scope: "anyone",
        expiresAt: new Date(Date.now() + DAY),
        password: "blue harbour lantern",
      });
      const stored = await test.pool.query<{ password_hash: string }>(
        "select password_hash from share_links where id = $1",
        [created.id],
      );
      expect(stored.rows[0]?.password_hash).not.toContain("blue harbour");
      await expect(
        test.services.shareLinks.open(token, ANONYMOUS, { clientIp: "192.0.2.5" }),
      ).rejects.toMatchObject({
        code: "passwordRequired",
      });
      await expect(
        test.services.shareLinks.open(token, ANONYMOUS, { clientIp: "192.0.2.5", password: "wrong" }),
      ).rejects.toMatchObject({ code: "wrongPassword" });
      const opened = await test.services.shareLinks.open(token, ANONYMOUS, {
        clientIp: "192.0.2.5",
        password: "blue harbour lantern",
      });
      const unlock = opened.kind === "anonymous" ? (opened.unlock ?? "") : "";
      expect(await test.services.shareLinks.resolveAnonymous(token, unlock, "192.0.2.5")).toBe(
        context.shared.id,
      );
      await expect(
        test.services.shareLinks.resolveAnonymous(token, undefined, "192.0.2.5"),
      ).rejects.toMatchObject({
        code: "passwordRequired",
      });
      for (let attempt = 0; attempt < 8; attempt += 1) {
        await test.services.shareLinks
          .open(token, ANONYMOUS, { clientIp: `198.51.100.${attempt}`, password: "guess" })
          .catch(() => undefined);
      }
      await expect(
        test.services.shareLinks.open(token, ANONYMOUS, {
          clientIp: "198.51.100.99",
          password: "blue harbour lantern",
        }),
      ).rejects.toMatchObject({ name: "ShareLinkRateLimitedError" });
    });

    it("limits failed attempts per client, also for unknown tokens", async () => {
      const ip = "203.0.113.77";
      for (let attempt = 0; attempt < 30; attempt += 1) {
        await test.services.shareLinks
          .open(`${randomUUID().replace(/-/g, "").slice(0, 16)}${"a".repeat(32)}`, ANONYMOUS, {
            clientIp: ip,
          })
          .catch(() => undefined);
      }
      await expect(test.services.shareLinks.open("x", ANONYMOUS, { clientIp: ip })).rejects.toMatchObject({
        name: "ShareLinkRateLimitedError",
      });
    });

    it("removes the access granted only through a link when it is revoked", async () => {
      const context = await setup();
      const { token, link: created } = await link(context, { scope: "organization" });
      await test.services.shareLinks.open(token, context.outsider, { clientIp: "192.0.2.6" });
      const other = await link(context, { scope: "organization" });
      await test.services.shareLinks.open(other.token, context.outsider, { clientIp: "192.0.2.6" });
      await test.services.shareLinks.revoke(context.editor, created.id);
      expect(await can(context.outsider, "item.view", { type: "item", id: context.shared.id })).toBe(true);
      await test.services.shareLinks.revoke(context.editor, other.link.id);
      expect(await can(context.outsider, "item.view", { type: "item", id: context.shared.id })).toBe(false);
      await expect(
        test.services.shareLinks.open(token, context.outsider, { clientIp: "192.0.2.6" }),
      ).rejects.toMatchObject({ code: "linkNotFound" });
      const audit = await test.pool.query<{ name: string }>(
        "select name from audit_events where target_id = $1 order by occurred_at",
        [created.id],
      );
      expect(audit.rows.map((row) => row.name)).toEqual([
        "shareLink.created",
        "shareLink.opened",
        "shareLink.revoked",
      ]);
    });

    it("stops working when the organization turns share links off", async () => {
      const context = await setup();
      const { token } = await link(context, { scope: "organization" });
      await test.services.shareLinks.open(token, context.outsider, { clientIp: "192.0.2.7" });
      await test.settings.set(shareLinksSetting, { organization: context.org.id }, "organization", false);
      expect(await can(context.outsider, "item.view", { type: "item", id: context.shared.id })).toBe(false);
      await expect(link(context, { scope: "organization" })).rejects.toMatchObject({
        code: "shareLinksDisabled",
      });
    });

    it("never opens a restricted page for people who are not on its list", async () => {
      const context = await setup();
      const { token } = await link(context, { scope: "organization" });
      await test.services.pageAccess.change(context.editor, context.shared.id, [
        { action: "restrict", kind: "view" },
      ]);
      await test.services.shareLinks.open(token, context.outsider, { clientIp: "192.0.2.8" });
      expect(await can(context.outsider, "item.view", { type: "item", id: context.shared.id })).toBe(false);
      await test.settings.set(anyoneLinksSetting, { organization: context.org.id }, "organization", true);
      await expect(
        link(context, { scope: "anyone", expiresAt: new Date(Date.now() + DAY) }),
      ).rejects.toMatchObject({ code: "restrictedPage" });
    });
  });

  describe("access requests", () => {
    it("asks for a page, is approved with a role and closes", async () => {
      const context = await setup();
      await test.services.accessRequests.requestPage(
        context.outsider,
        context.shared.id,
        "Need it for the launch",
      );
      const open = await test.services.accessRequests.forSpace(context.editor, context.space.id);
      expect(open.map((request) => [request.requester.id, request.itemTitle, request.number])).toEqual([
        [context.outsiderId, "Launch plan", context.shared.number],
      ]);
      expect(
        (await test.services.accessRequests.mine(context.outsider)).map((request) => [
          request.itemId,
          request.itemTitle,
          request.number,
        ]),
      ).toEqual([[context.shared.id, null, null]]);
      const editorNotices = await test.services.notifications.list(context.editorId, { limit: 10 });
      expect(editorNotices.items.map((item) => item.type)).toContain("access.requested");
      const decided = await test.services.accessRequests.decide(context.editor, open[0]?.id ?? "", {
        approve: true,
        role: "commenter",
      });
      expect(decided).toMatchObject({ status: "approved", role: "commenter" });
      expect(await test.services.accessRequests.mine(context.outsider)).toEqual([
        expect.objectContaining({ itemTitle: "Launch plan", number: context.shared.number }),
      ]);
      expect(await can(context.outsider, "item.comment", { type: "item", id: context.shared.id })).toBe(true);
      const notices = await test.services.notifications.list(context.outsiderId, { limit: 10 });
      expect(notices.items.map((item) => item.type)).toContain("access.requestDecided");
      await expect(
        test.services.accessRequests.decide(context.editor, decided.id, { approve: false }),
      ).rejects.toMatchObject({ code: "requestClosed" });
    });

    it("answers the same whether or not the page exists", async () => {
      const context = await setup();
      await expect(
        test.services.accessRequests.requestPage(context.outsider, randomUUID(), ""),
      ).resolves.toBeUndefined();
      await expect(
        test.services.accessRequests.requestPage(context.outsider, context.shared.id, ""),
      ).resolves.toBeUndefined();
    });

    it("closes by itself when the person gets access another way, without expiry", async () => {
      const context = await setup();
      await test.services.accessRequests.requestPage(context.outsider, context.shared.id, "");
      await share(context);
      const mine = await test.services.accessRequests.mine(context.outsider);
      expect(mine.map((request) => request.status)).toEqual(["satisfied"]);
    });

    it("is offered to the people who set a restriction, not decided by space admins who cannot read it", async () => {
      const context = await setup();
      const owner = await member(context.org.id, "member", "Restricting owner");
      await test.services.spacePermissions.apply(SYSTEM, context.space.id, {
        action: "grant",
        principalKind: "account",
        principalId: owner,
        role: "editor",
      });
      await test.services.pageAccess.change(accountPrincipal(owner), context.shared.id, [
        { action: "restrict", kind: "view" },
      ]);
      await test.services.accessRequests.requestPage(context.outsider, context.shared.id, "");
      const deciders = await test.services.accessRequests.deciders(
        test.database,
        context.space.id,
        context.shared.id,
      );
      expect(deciders).toContain(owner);
      expect(deciders).toContain(context.editorId);
      const forOwner = await test.services.accessRequests.forSpace(accountPrincipal(owner), context.space.id);
      expect(forOwner).toHaveLength(1);
      await expect(
        test.services.accessRequests.decide(context.editor, forOwner[0]?.id ?? "", {
          approve: true,
          role: "reader",
        }),
      ).rejects.toMatchObject({ name: "ForbiddenError" });
      await test.services.accessRequests.decide(accountPrincipal(owner), forOwner[0]?.id ?? "", {
        approve: true,
        role: "reader",
      });
      expect(await can(context.outsider, "item.view", { type: "item", id: context.shared.id })).toBe(true);
    });

    it("requests a discoverable space and is approved with a space role", async () => {
      const context = await setup();
      await expect(
        test.services.accessRequests.requestSpace(context.outsider, context.space.id, ""),
      ).rejects.toMatchObject({ code: "spaceNotFound" });
      await test.pool.query("update spaces set discoverable = true where id = $1", [context.space.id]);
      const request = await test.services.accessRequests.requestSpace(
        context.outsider,
        context.space.id,
        "Hi",
      );
      const decided = await test.services.accessRequests.decide(context.editor, request.id, {
        approve: true,
        role: "reader",
      });
      expect(decided.status).toBe("approved");
      expect(await can(context.outsider, "space.view", { type: "space", id: context.space.id })).toBe(true);
    });

    it("can be withdrawn by the requester only", async () => {
      const context = await setup();
      await test.services.accessRequests.requestPage(context.outsider, context.shared.id, "");
      const [request] = await test.services.accessRequests.mine(context.outsider);
      await expect(
        test.services.accessRequests.withdraw(context.editor, request?.id ?? ""),
      ).rejects.toMatchObject({ code: "requestNotFound" });
      await test.services.accessRequests.withdraw(context.outsider, request?.id ?? "");
      expect((await test.services.accessRequests.mine(context.outsider))[0]?.status).toBe("withdrawn");
    });
  });

  describe("explanations", () => {
    it("explain why someone has access and what a person can do, without titles of pages the viewer cannot read", async () => {
      const context = await setup();
      await share(context, { includeDescendants: true });
      const why = await test.services.accessExplanations.explainAccess(
        context.editor,
        { type: "item", id: context.child.id },
        context.outsiderId,
      );
      expect(why.role).toBe("reader");
      expect(why.reasons).toEqual([
        expect.objectContaining({ type: "share", role: "reader", inherited: true, itemTitle: "Launch plan" }),
      ]);
      await test.services.pageAccess.change(context.editor, context.shared.id, [
        { action: "restrict", kind: "view" },
      ]);
      const admin = accountPrincipal(context.org.owner);
      const overview = await test.services.accessExplanations.personAccess(admin, context.outsiderId, {
        organizationId: context.org.id,
      });
      expect(
        overview.entries.map((entry) => [
          entry.kind,
          entry.itemId,
          entry.number,
          entry.itemTitle,
          entry.count,
        ]),
      ).toEqual([["restrictedPages", null, null, null, 1]]);
      const own = await test.services.accessExplanations.personAccess(context.editor, context.outsiderId, {
        organizationId: context.org.id,
      });
      expect(own.entries.map((entry) => [entry.kind, entry.itemTitle, entry.number])).toEqual([
        ["share", "Launch plan", context.shared.number],
      ]);
      const csv = await readText(
        await test.services.accessExplanations.overviewCsv(admin, context.org.id, context.outsiderId),
      );
      expect(csv.split("\r\n")[0]).toBe("person,email,kind,space,page,role,pages,reason");
      expect(csv).not.toContain("Launch plan");
    });

    it("refuse to explain the access of people the caller cannot see", async () => {
      const context = await setup();
      const stranger = await account();
      await expect(
        test.services.accessExplanations.explainAccess(
          context.editor,
          { type: "item", id: context.shared.id },
          stranger,
        ),
      ).rejects.toMatchObject({ code: "personNotFound" });
      await expect(
        test.services.accessExplanations.personAccess(context.editor, stranger, {
          organizationId: context.org.id,
        }),
      ).rejects.toMatchObject({ code: "personNotFound" });
    });

    it("previews giving access with the number of pages and the restricted pages left out", async () => {
      const context = await setup();
      await test.services.pageAccess.change(context.editor, context.sibling.id, [
        { action: "restrict", kind: "view" },
      ]);
      const effect = await test.services.accessExplanations.giveAccessEffect(
        { kind: "account", id: context.outsiderId },
        { spaceId: context.space.id, itemId: null, scope: "space" },
        "editor",
      );
      expect(effect).toMatchObject({ pages: 5, restricted: 1, readable: 4, editable: 4 });
    });
  });

  describe("concurrent changes", () => {
    it("never leaves a page visible after a move into a restricted page that runs at the same time", async () => {
      const context = await setup();
      const restrictedRoot = await test.services.tree.create(context.editor, context.space.id, {
        kind: "page",
        title: "Board",
        mode: "live",
        placement: { parentId: null },
      });
      const reader = await member(context.org.id);
      await test.services.spacePermissions.apply(SYSTEM, context.space.id, {
        action: "grant",
        principalKind: "account",
        principalId: reader,
        role: "reader",
      });
      const results = await Promise.allSettled([
        test.services.pageAccess.change(context.editor, restrictedRoot.id, [
          { action: "restrict", kind: "view" },
        ]),
        test.services.tree.move(context.editor, context.shared.id, { parentId: restrictedRoot.id }),
        test.services.tree.move(context.editor, restrictedRoot.id, { parentId: context.root.id }),
      ]);
      expect(results[0]?.status).toBe("fulfilled");
      for (const result of results) {
        if (result.status === "rejected") expect(result.reason).toMatchObject({ code: "moveChangesAccess" });
      }
      const paths = await test.pool.query<{ id: string; parent_id: string | null; path: string[] }>(
        "select id, parent_id, path from tree_items where space_id = $1",
        [context.space.id],
      );
      const byId = new Map(paths.rows.map((row) => [row.id, row]));
      for (const row of paths.rows) {
        const parent = row.parent_id ? byId.get(row.parent_id) : undefined;
        expect(row.path).toEqual([...(parent?.path ?? []), row.id]);
      }
      for (const id of [restrictedRoot.id, context.shared.id, context.child.id]) {
        if (!byId.get(id)?.path.includes(restrictedRoot.id)) continue;
        expect(await can(accountPrincipal(reader), "item.view", { type: "item", id })).toBe(false);
      }
      expect(byId.get(context.child.id)?.path).toContain(context.shared.id);
    });
  });
});
