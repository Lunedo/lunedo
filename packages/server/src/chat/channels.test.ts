import { randomUUID } from "node:crypto";
import type { DocumentJson, NodeJson } from "@pagehall/editor-schema";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { accountPrincipal } from "../accounts/principal.js";
import type { NotificationListener } from "../database/notifications.js";
import type { JobHandler, JobQueue } from "../jobs/job-queue.js";
import { createLogger } from "../logging/logger.js";
import { outboundPolicy } from "../outbound/guarded-request.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { type FakeRequest, type FakeResponse, type RunningFake, serveFake } from "../testing/fakes/http.js";
import { testJobContext } from "../testing/jobs.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { spaceFixtures } from "../testing/spaces.js";
import { type ChatScope, PAGE_CHANGES_COMBINE_MINUTES } from "./channels.js";
import { webhookSignature } from "./formats.js";
import { chatDeliveryJob, startChatDelivery } from "./jobs.js";

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

    it("still posts an announcement whose start, severity or link changed, at its current start", async () => {
      const context = await setup();
      const owner = accountPrincipal(context.org.owner);
      const scope: ChatScope = { kind: "organization", organizationId: context.org.id };
      const channel = await test.services.chatChannels.create(owner, scope, {
        kind: "webhook",
        name: "All hands",
        events: ["announcementPublished"],
        target: { url: hook("announcements") },
      });
      const input = {
        severity: "information" as const,
        text: "Maintenance tonight",
        link: null,
        startsAt: new Date(Date.now() + 60 * 60_000),
        endsAt: new Date(Date.now() + 3 * 60 * 60_000),
      };
      await test.services.announcements.set(owner, context.org.id, input);
      const later = new Date(Date.now() + 2 * 60 * 60_000);
      await test.services.announcements.set(owner, context.org.id, {
        ...input,
        severity: "warning",
        link: { url: "https://status.example.org", label: "Status" },
        startsAt: later,
      });
      const rows = await deliveries(channel.channel.id);
      expect(rows.map((row) => row.state)).toEqual(["skipped", "pending"]);
      expect(rows[1]?.not_before.getTime()).toBe(later.getTime());

      await due(channel.channel.id);
      expect(await test.services.chatChannels.deliver(rows[1]?.id ?? "", false)).toBe("delivered");
      expect(requests).toHaveLength(1);

      await test.services.announcements.set(owner, context.org.id, { ...input, startsAt: later });
      expect((await deliveries(channel.channel.id)).map((row) => row.state)).toEqual([
        "skipped",
        "delivered",
      ]);
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

    it("posts a change that arrives while a post is being sent with the next post", async () => {
      const context = await setup();
      const channel = await connect(context, ["pageChanged"]);
      const runbook = await page(context);
      await edit(context, runbook.id, "Second");
      const [sending] = await due(channel.channel.id);
      respond = () => ({ status: 503 });
      expect(await test.services.chatChannels.deliver(sending?.id ?? "", false)).toBe("retry");

      await edit(context, runbook.id, "Third");
      const rows = await deliveries(channel.channel.id);
      expect(rows.map((row) => [row.state, row.count])).toEqual([
        ["pending", 1],
        ["pending", 1],
      ]);

      respond = () => ({ status: 200 });
      expect(await test.services.chatChannels.deliver(sending?.id ?? "", false)).toBe("delivered");
      const [next] = await due(channel.channel.id);
      expect(await test.services.chatChannels.deliver(next?.id ?? "", false)).toBe("delivered");
      expect(requests.filter((request) => request.method === "POST")).toHaveLength(3);
    });

    it("marks a post failed when its job ends for good, and abandoned posts as well", async () => {
      const context = await setup();
      const channel = await connect(context, ["pagePublished"]);
      const handlers = new Map<string, JobHandler<unknown>>();
      const jobs = {
        work: async (definition: { name: string }, handler: JobHandler<unknown>) => {
          handlers.set(definition.name, handler);
        },
        enqueue: async () => randomUUID(),
        schedule: async () => undefined,
      } as unknown as JobQueue;
      const listener = { listen: async () => undefined, onReconnect: () => undefined };
      await startChatDelivery({
        jobs,
        listener: listener as unknown as NotificationListener,
        channels: test.services.chatChannels,
        logger: createLogger({ service: "test", level: "silent" }),
      });
      const deliver = handlers.get(chatDeliveryJob.name);
      await page(context);
      const [row] = await due(channel.channel.id);
      await test.database.execute(
        sql`update chat_channels set target = '\\x00' where id = ${channel.channel.id}`,
      );
      const payload = { deliveryId: row?.id ?? "" };
      await expect(deliver?.(testJobContext(chatDeliveryJob.name, payload, 0))).rejects.toThrow();
      expect((await deliveries(channel.channel.id))[0]?.state).toBe("pending");
      await deliver?.(testJobContext(chatDeliveryJob.name, payload, chatDeliveryJob.retryLimit));
      expect((await deliveries(channel.channel.id))[0]?.state).toBe("failed");

      await page(context);
      await test.database.execute(sql`
        update chat_deliveries set queued_at = now() - interval '2 hours', not_before = now() - interval '2 hours'
        where channel_id = ${channel.channel.id} and state = 'pending'`);
      expect(await test.services.chatChannels.failAbandoned()).toBe(1);
      expect((await deliveries(channel.channel.id)).map((entry) => entry.state)).toEqual([
        "failed",
        "failed",
      ]);
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
