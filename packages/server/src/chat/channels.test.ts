import { randomUUID } from "node:crypto";
import type { DocumentJson, NodeJson } from "@pagehall/editor-schema";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { accountPrincipal } from "../accounts/principal.js";
import { outboundPolicy } from "../outbound/guarded-request.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { type FakeRequest, type FakeResponse, type RunningFake, serveFake } from "../testing/fakes/http.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { spaceFixtures } from "../testing/spaces.js";
import { type ChatScope, PAGE_CHANGES_COMBINE_MINUTES } from "./channels.js";
import { webhookSignature } from "./formats.js";

const baseUrl = testDatabaseBaseUrl();

function paragraph(text: string): NodeJson {
  return { type: "paragraph", content: [{ type: "text", text }] };
}

function doc(...content: NodeJson[]): DocumentJson {
  return { type: "doc", content };
}

describe.skipIf(!baseUrl)("chat channels", () => {
  let test: TestServices;
  let fake: RunningFake;
  let port = "";
  const requests: FakeRequest[] = [];
  let respond: (request: FakeRequest) => FakeResponse = () => ({ status: 200 });
  const { organization, member, space } = spaceFixtures(() => test);

  beforeAll(async () => {
    fake = await serveFake((request) => {
      requests.push(request);
      return respond(request);
    });
    port = new URL(fake.url).port;
    test = await createTestServices(baseUrl ?? "", {
      configuredInstanceUrl: "https://wiki.example.org",
      chatPolicy: outboundPolicy(["127.0.0.0/8"], async (hostname) => {
        if (hostname === "hooks.test") return [{ address: "127.0.0.1", family: 4 }];
        if (hostname === "private.test") return [{ address: "10.0.0.5", family: 4 }];
        if (hostname === "metadata.test") return [{ address: "169.254.169.254", family: 4 }];
        return [];
      }),
    });
    await test.pool.query("insert into instance (id, setup_completed_at) values (1, now())");
    await test.services.instanceAddress.applyConfigured();
  });

  afterAll(async () => {
    await test?.close();
    await fake?.close();
  });

  beforeEach(() => {
    requests.length = 0;
    respond = () => ({ status: 200 });
  });

  async function setup() {
    const org = await organization();
    const adminId = await member(org.id, "member", "Space admin");
    const editorId = await member(org.id, "member", "Editor");
    const created = await space(org.id, adminId, {
      grants: [{ principalKind: "account", principalId: editorId, role: "editor" }],
    });
    const scope: ChatScope = { kind: "space", spaceId: created.id };
    return {
      org,
      space: created,
      scope,
      adminId,
      editorId,
      admin: accountPrincipal(adminId),
      editor: accountPrincipal(editorId),
    };
  }

  type Context = Awaited<ReturnType<typeof setup>>;

  function hook(path: string = randomUUID()) {
    return `http://hooks.test:${port}/${path}`;
  }

  async function connect(context: Context, events: string[], kind: "slack" | "webhook" | "teams" = "slack") {
    return test.services.chatChannels.create(context.admin, context.scope, {
      kind,
      name: `#channel-${randomUUID().slice(0, 4)}`,
      events,
      target: { url: hook() },
    });
  }

  async function page(
    context: Context,
    parentId: string | null = null,
    title = `Runbook ${randomUUID().slice(0, 6)}`,
  ) {
    const created = await test.services.tree.create(context.editor, context.space.id, {
      kind: "page",
      title,
      mode: "publish",
      placement: { parentId },
    });
    await test.services.documents.replace(context.editor, created.id, doc(paragraph("First")));
    await test.services.versions.publish(context.editor, created.id);
    return created;
  }

  async function edit(context: Context, itemId: string, words: string) {
    await test.services.documents.replace(context.editor, itemId, doc(paragraph(words)));
    await test.services.versions.publish(context.editor, itemId);
  }

  async function deliveries(channelId: string) {
    const result = await test.database.execute<{
      id: string;
      event: string;
      state: string;
      count: number;
      not_before: Date;
      created_at: Date;
    }>(sql`
      select id, event, state, count, not_before, created_at from chat_deliveries
      where channel_id = ${channelId} order by created_at, id`);
    return result.rows.map((row) => ({
      ...row,
      not_before: new Date(row.not_before),
      created_at: new Date(row.created_at),
    }));
  }

  async function due(channelId: string) {
    await test.database.execute(
      sql`update chat_deliveries set not_before = now() where channel_id = ${channelId} and state = 'pending'`,
    );
    return (await deliveries(channelId)).filter((row) => row.state === "pending");
  }

  async function failingNotices(accountId: string) {
    const items = (await test.services.notifications.list(accountId, { limit: 50 })).items;
    return items.filter((item) => item.type === "chatChannel.failing");
  }

  describe("connecting", () => {
    it("checks the address, keeps it encrypted and shows a webhook secret only once", async () => {
      const context = await setup();
      for (const [url, code] of [
        ["http://private.test/hook", "blockedAddress"],
        ["https://metadata.test/hook", "blockedAddress"],
        ["http://10.1.2.3/hook", "blockedAddress"],
        ["http://[::1]/hook", "blockedAddress"],
        ["ftp://hooks.test/hook", "invalidAddress"],
      ] as const) {
        await expect(
          test.services.chatChannels.create(context.admin, context.scope, {
            kind: "slack",
            name: "Alerts",
            events: ["pagePublished"],
            target: { url },
          }),
        ).rejects.toMatchObject({ code });
      }
      await expect(
        test.services.chatChannels.create(context.admin, context.scope, {
          kind: "slack",
          name: "Alerts",
          events: ["announcementPublished"],
          target: { url: hook() },
        }),
      ).rejects.toMatchObject({ code: "invalidChannel" });

      const url = hook("secret-path");
      const saved = await test.services.chatChannels.create(context.admin, context.scope, {
        kind: "webhook",
        name: "Automation",
        events: ["pagePublished", "commentCreated"],
        target: { url },
      });
      expect(saved.signingSecret).toMatch(/^[A-Za-z0-9_-]{43}$/);
      const [listed] = await test.services.chatChannels.list(context.scope);
      expect(listed).toEqual(saved.channel);
      expect(JSON.stringify(listed)).not.toContain("secret-path");
      expect(JSON.stringify(listed)).not.toContain(saved.signingSecret);
      const stored = await test.database.execute<{ target: Buffer; signing_secret: Buffer }>(
        sql`select target, signing_secret from chat_channels where id = ${saved.channel.id}`,
      );
      expect(stored.rows[0]?.target.toString("latin1")).not.toContain("secret-path");
      expect(stored.rows[0]?.signing_secret.toString("latin1")).not.toContain(saved.signingSecret ?? "");

      const renamed = await test.services.chatChannels.update(
        context.admin,
        context.scope,
        saved.channel.id,
        {
          name: "Automation hook",
        },
      );
      expect(renamed.signingSecret).toBeNull();
      const replaced = await test.services.chatChannels.update(
        context.admin,
        context.scope,
        saved.channel.id,
        {
          newSecret: true,
        },
      );
      expect(replaced.signingSecret).not.toBe(saved.signingSecret);
    });

    it("names the field and the reason when it refuses an address", async () => {
      const context = await setup();
      const attempt = (kind: "slack" | "matrix", target: Record<string, string>) =>
        test.services.chatChannels.create(context.admin, context.scope, {
          kind,
          name: "Alerts",
          events: ["pagePublished"],
          target,
        });
      await expect(attempt("slack", { url: "http://hooks example" })).rejects.toMatchObject({
        code: "invalidAddress",
        field: "target.url",
        problem: "notUrl",
      });
      await expect(attempt("slack", { url: "https://unknown.test/hook" })).rejects.toMatchObject({
        code: "invalidAddress",
        field: "target.url",
        problem: "unresolvable",
      });
      await expect(attempt("slack", { url: "http://private.test/hook" })).rejects.toMatchObject({
        code: "blockedAddress",
        field: "target.url",
      });
      await expect(
        attempt("matrix", {
          homeserver: "http://private.test",
          roomId: "!abc:example.org",
          accessToken: "t",
        }),
      ).rejects.toMatchObject({ code: "blockedAddress", field: "target.homeserver" });
      await expect(
        attempt("matrix", { homeserver: hook(""), roomId: "ops", accessToken: "t" }),
      ).rejects.toMatchObject({ code: "invalidAddress", field: "target.roomId", problem: "roomAddress" });
    });

    it("resolves the room address people see in Matrix to the room ID", async () => {
      const context = await setup();
      const homeserver = `http://hooks.test:${port}`;
      respond = (request) => {
        if (request.method !== "GET") return { status: 200, body: { event_id: "$1" } };
        if (request.headers.authorization !== "Bearer bot-token") return { status: 401, body: {} };
        return request.url.pathname.endsWith(encodeURIComponent("#ops:example.org"))
          ? { status: 200, body: { room_id: "!resolved:example.org", servers: ["example.org"] } }
          : { status: 404, body: { errcode: "M_NOT_FOUND" } };
      };
      for (const roomId of ["#ops:example.org", "https://matrix.to/#/%23ops%3Aexample.org?via=example.org"]) {
        requests.length = 0;
        const result = await test.services.chatChannels.test(context.scope, {
          kind: "matrix",
          name: "Ops",
          events: ["pagePublished"],
          target: { homeserver, roomId, accessToken: "bot-token" },
        });
        expect(result).toEqual({ delivered: true });
        const sent = requests.find((request) => request.method === "PUT");
        expect(sent?.url.pathname).toContain(encodeURIComponent("!resolved:example.org"));
      }
      await expect(
        test.services.chatChannels.create(context.admin, context.scope, {
          kind: "matrix",
          name: "Ops",
          events: ["pagePublished"],
          target: { homeserver, roomId: "#unknown:example.org", accessToken: "bot-token" },
        }),
      ).rejects.toMatchObject({ code: "invalidAddress", field: "target.roomId", problem: "roomNotFound" });
      await expect(
        test.services.chatChannels.create(context.admin, context.scope, {
          kind: "matrix",
          name: "Ops",
          events: ["pagePublished"],
          target: { homeserver, roomId: "#ops:example.org", accessToken: "wrong" },
        }),
      ).rejects.toMatchObject({
        code: "invalidAddress",
        field: "target.accessToken",
        problem: "unauthorized",
      });
    });

    it("refuses confidential spaces and channels of other spaces", async () => {
      const context = await setup();
      const council = await test.services.spaces.create(
        context.admin,
        context.org.id,
        {
          name: `Council ${randomUUID().slice(0, 6)}`,
          key: `C${randomUUID().replace(/-/g, "").slice(0, 7).toUpperCase()}`,
          visibility: "private",
          confidential: true,
          grants: [],
        },
        test.services.spacePermissions.holders,
      );
      const confidential: ChatScope = { kind: "space", spaceId: council.id };
      const input = {
        kind: "slack" as const,
        name: "Council",
        events: ["pagePublished"],
        target: { url: hook() },
      };
      await expect(
        test.services.chatChannels.create(context.admin, confidential, input),
      ).rejects.toMatchObject({
        code: "confidentialSpace",
      });
      await expect(test.services.chatChannels.test(confidential, input)).rejects.toMatchObject({
        code: "confidentialSpace",
      });
      expect(requests).toEqual([]);

      const saved = await connect(context, ["pagePublished"]);
      const other = await setup();
      await expect(
        test.services.chatChannels.update(other.admin, other.scope, saved.channel.id, { name: "Taken" }),
      ).rejects.toMatchObject({ code: "channelNotFound" });
      await expect(
        test.services.chatChannels.remove(other.admin, other.scope, saved.channel.id),
      ).rejects.toMatchObject({
        code: "channelNotFound",
      });
    });
  });

  describe("events", () => {
    it("posts only the chosen events and combines page changes per hour", async () => {
      const context = await setup();
      const published = await connect(context, ["pagePublished", "blogPostPublished"]);
      const changes = await connect(context, ["pageChanged", "pageStatusChanged"]);
      const runbook = await page(context);
      await edit(context, runbook.id, "Second");
      await edit(context, runbook.id, "Third");
      const [value] = await test.services.pageStatus.values(context.space.id);
      await test.services.pageStatus.set(context.editor, runbook.id, value?.id ?? "");

      expect((await deliveries(published.channel.id)).map((row) => row.event)).toEqual(["pagePublished"]);
      const changed = await deliveries(changes.channel.id);
      expect(changed.map((row) => [row.event, row.count])).toEqual([
        ["pageChanged", 2],
        ["pageStatusChanged", 1],
      ]);
      const window = changed[0] ? changed[0].not_before.getTime() - changed[0].created_at.getTime() : 0;
      expect(Math.round(window / 60_000)).toBe(PAGE_CHANGES_COMBINE_MINUTES);
    });

    it("never posts restricted pages or comments on them", async () => {
      const context = await setup();
      const channel = await connect(context, ["pagePublished", "pageChanged", "commentCreated"]);
      const parent = await page(context);
      await test.database.execute(
        sql`insert into page_restrictions (item_id, kind) values (${parent.id}, 'view')`,
      );
      await test.database.execute(sql`
        insert into page_restriction_holders (item_id, kind, principal_kind, principal_id)
        values (${parent.id}, 'view', 'account', ${context.editorId})`);
      const child = await page(context, parent.id);
      await edit(context, child.id, "Secret change");
      await test.services.comments.create(context.editor, child.id, { body: doc(paragraph("Secret")) });
      expect((await deliveries(channel.channel.id)).map((row) => row.event)).toEqual(["pagePublished"]);

      const open = await page(context);
      await test.services.comments.create(context.editor, open.id, { body: doc(paragraph("Looks good")) });
      await test.database.execute(
        sql`insert into page_restrictions (item_id, kind) values (${open.id}, 'view')`,
      );
      const pending = await due(channel.channel.id);
      for (const row of pending) {
        expect(await test.services.chatChannels.deliver(row.id, false)).toBe("skipped");
      }
      expect(requests).toEqual([]);

      expect(requests).toEqual([]);
    });

    it("posts decisions once they are published and settled, with their current text", async () => {
      const context = await setup();
      const channel = await connect(context, ["decisionRecorded"]);
      const notes = await page(context);
      const decision = (id: string, text: string): NodeJson => ({
        type: "decision",
        attrs: { id },
        content: [paragraph(text)],
      });
      const removed = randomUUID();
      const kept = randomUUID();
      await test.services.documents.replace(
        context.editor,
        notes.id,
        doc(decision(removed, "We stop backups")),
      );
      await test.services.versions.publish(context.editor, notes.id);
      await test.services.documents.replace(
        context.editor,
        notes.id,
        doc(decision(kept, "We move the backup")),
      );
      await test.services.versions.publish(context.editor, notes.id);
      await test.services.documents.replace(
        context.editor,
        notes.id,
        doc(decision(kept, "We move the backup to Sunday")),
      );
      await test.services.versions.publish(context.editor, notes.id);
      const rows = await deliveries(channel.channel.id);
      expect(rows.map((row) => row.event)).toEqual(["decisionRecorded", "decisionRecorded"]);
      expect(rows.every((row) => row.not_before.getTime() > Date.now())).toBe(true);
      expect(await test.services.chatChannels.deliver(rows[0]?.id ?? "", false)).toBe("retry");
      await due(channel.channel.id);
      expect(await test.services.chatChannels.deliver(rows[0]?.id ?? "", false)).toBe("skipped");
      expect(await test.services.chatChannels.deliver(rows[1]?.id ?? "", false)).toBe("delivered");
      expect(requests).toHaveLength(1);
      const body = JSON.parse(requests[0]?.body ?? "{}") as { blocks: { text?: { text: string } }[] };
      expect(body.blocks[1]?.text?.text).toBe(`${notes.title}
We move the backup to Sunday`);
    });

    it("posts organization announcements when they start, and only the latest version", async () => {
      const context = await setup();
      const scope: ChatScope = { kind: "organization", organizationId: context.org.id };
      const channel = await test.services.chatChannels.create(accountPrincipal(context.org.owner), scope, {
        kind: "webhook",
        name: "All hands",
        events: ["announcementPublished"],
        target: { url: hook("announcements") },
      });
      const startsAt = new Date(Date.now() + 60 * 60_000);
      const input = {
        severity: "information" as const,
        link: null,
        startsAt,
        endsAt: new Date(Date.now() + 2 * 60 * 60_000),
      };
      await test.services.announcements.set(accountPrincipal(context.org.owner), context.org.id, {
        ...input,
        text: "Maintenance tonight",
      });
      await test.services.announcements.set(accountPrincipal(context.org.owner), context.org.id, {
        ...input,
        text: "Maintenance tomorrow",
      });
      const rows = await deliveries(channel.channel.id);
      expect(rows.map((row) => row.state)).toEqual(["skipped", "pending"]);
      expect(rows[1]?.not_before.getTime()).toBe(startsAt.getTime());

      await due(channel.channel.id);
      expect(await test.services.chatChannels.deliver(rows[1]?.id ?? "", false)).toBe("delivered");
      const [request] = requests;
      const body = JSON.parse(request?.body ?? "{}") as { event: string; text: string };
      expect(body).toMatchObject({ event: "announcementPublished" });
      expect(body.text).toContain("Maintenance tomorrow");
      expect(request?.headers["x-pagehall-signature"]).toBe(
        webhookSignature(
          channel.signingSecret ?? "",
          String(request?.headers["x-pagehall-timestamp"]),
          request?.body ?? "",
        ),
      );
    });
  });

  describe("delivery", () => {
    it("sends the format of the channel with a link to the page", async () => {
      const context = await setup();
      const channel = await connect(context, ["pagePublished"]);
      const runbook = await page(context, null, "Restart the VPN gateway");
      const [row] = await due(channel.channel.id);
      expect(await test.services.chatChannels.deliver(row?.id ?? "", false)).toBe("delivered");
      const body = JSON.parse(requests[0]?.body ?? "{}") as {
        text: string;
        blocks: { type: string; text?: { text: string }; elements?: { url?: string }[] }[];
      };
      expect(body.text).toContain(`New page in ${context.space.name}`);
      expect(body.blocks[1]?.text?.text).toBe("Restart the VPN gateway\nPublished by Editor");
      expect(body.blocks[2]?.elements?.[0]?.url).toBe(
        `https://wiki.example.org/spaces/${context.space.key}/pages/${runbook.id}/restart-the-vpn-gateway`,
      );
      const [listed] = await test.services.chatChannels.list(context.scope);
      expect(listed?.lastDeliveredAt).toBeInstanceOf(Date);
      expect(await test.services.chatChannels.deliver(row?.id ?? "", false)).toBe("skipped");
      expect(requests).toHaveLength(1);
    });

    it("keeps a failed test of a working channel until a message is accepted, without pausing it", async () => {
      const context = await setup();
      const channel = await connect(context, ["pagePublished"]);
      respond = () => ({ status: 403, body: "invalid_token" });
      await test.services.chatChannels.testSaved(context.scope, channel.channel.id);
      const [tested] = await test.services.chatChannels.list(context.scope);
      expect(tested).toMatchObject({
        state: "working",
        failure: { reason: "unauthorized", status: 403, code: "invalid_token" },
        lastDeliveredAt: null,
      });
      expect(await failingNotices(context.adminId)).toEqual([]);

      respond = () => ({ status: 200 });
      await page(context);
      const [pending] = await due(channel.channel.id);
      expect(await test.services.chatChannels.deliver(pending?.id ?? "", false)).toBe("delivered");
      const [delivered] = await test.services.chatChannels.list(context.scope);
      expect(delivered?.failure).toBeNull();
      expect(delivered?.lastDeliveredAt).toBeInstanceOf(Date);
    });

    it("retries, then marks the channel failing and tells its space administrators once", async () => {
      const context = await setup();
      const channel = await connect(context, ["pagePublished"]);
      respond = () => ({ status: 503 });
      await page(context);
      const [first] = await due(channel.channel.id);
      expect(await test.services.chatChannels.deliver(first?.id ?? "", false)).toBe("retry");
      expect(await test.services.chatChannels.deliver(first?.id ?? "", true)).toBe("failed");
      const [failing] = await test.services.chatChannels.list(context.scope);
      expect(failing).toMatchObject({ state: "failing", failure: { reason: "unavailable", status: 503 } });
      expect(await failingNotices(context.adminId)).toHaveLength(1);
      expect(await failingNotices(context.editorId)).toEqual([]);

      await page(context);
      expect((await deliveries(channel.channel.id)).filter((row) => row.state === "pending")).toEqual([]);

      respond = () => ({ status: 200 });
      expect(await test.services.chatChannels.testSaved(context.scope, channel.channel.id)).toEqual({
        delivered: true,
      });
      expect((await test.services.chatChannels.list(context.scope))[0]?.state).toBe("working");

      await test.database.execute(
        sql`update notifications set read_at = now() where type = 'chatChannel.failing'`,
      );
      respond = () => ({ status: 404, body: "no_service" });
      await page(context);
      const pending = await due(channel.channel.id);
      expect(await test.services.chatChannels.deliver(pending[0]?.id ?? "", false)).toBe("failed");
      expect((await test.services.chatChannels.list(context.scope))[0]).toMatchObject({
        state: "failing",
        failure: { reason: "addressGone", status: 404 },
      });
      await test.database.execute(
        sql`update notifications set read_at = now() where type = 'chatChannel.failing'`,
      );
      expect(await failingNotices(context.adminId)).toHaveLength(2);
    });

    it("tests an address before saving and names why it failed", async () => {
      const context = await setup();
      respond = () => ({ status: 403, body: "invalid_token" });
      const result = await test.services.chatChannels.test(context.scope, {
        kind: "slack",
        name: "Alerts",
        events: ["pagePublished"],
        target: { url: hook() },
      });
      expect(result).toEqual({
        delivered: false,
        failure: { reason: "unauthorized", status: 403, code: "invalid_token" },
      });
      respond = () => ({ status: 307, headers: { location: "http://private.test/elsewhere" } });
      expect(
        await test.services.chatChannels.test(context.scope, {
          kind: "teams",
          name: "Alerts",
          events: ["pagePublished"],
          target: { url: hook() },
        }),
      ).toEqual({ delivered: false, failure: { reason: "blockedAddress", status: null, code: null } });
    });
  });
});
