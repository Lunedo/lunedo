import { createDecipheriv, createECDH, createHmac, randomBytes, randomUUID } from "node:crypto";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { DocumentJson, NodeJson } from "@lunedo/editor-schema";
import { uuidv7 } from "@lunedo/shared";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accountPrincipal } from "../accounts/principal.js";
import { sessionIdleTimeoutSetting } from "../auth/settings.js";
import type { NotificationListener } from "../database/notifications.js";
import type { JobHandler, JobQueue } from "../jobs/job-queue.js";
import { createLogger } from "../logging/logger.js";
import { browserPushSetting, notificationEventSettings } from "../notifications/types.js";
import { outboundPolicy } from "../outbound/guarded-request.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { testJobContext } from "../testing/jobs.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { spaceFixtures } from "../testing/spaces.js";
import { PushSubscriptionError, pushDeliveryJob, startPushDelivery } from "./push-service.js";

const baseUrl = testDatabaseBaseUrl();

function hmac(key: Buffer, data: Buffer): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

function decrypt(body: Buffer, receiverPrivateKey: Buffer, auth: Buffer): unknown {
  const salt = body.subarray(0, 16);
  const keyLength = body.readUInt8(20);
  const senderPublicKey = body.subarray(21, 21 + keyLength);
  const ciphertext = body.subarray(21 + keyLength);
  const receiver = createECDH("prime256v1");
  receiver.setPrivateKey(receiverPrivateKey);
  const keyPrk = hmac(auth, receiver.computeSecret(senderPublicKey));
  const inputKey = hmac(
    keyPrk,
    Buffer.concat([
      Buffer.from("WebPush: info\0", "latin1"),
      receiver.getPublicKey(),
      senderPublicKey,
      Buffer.from([1]),
    ]),
  );
  const prk = hmac(salt, inputKey);
  const key = hmac(prk, Buffer.from("Content-Encoding: aes128gcm\0\x01", "latin1")).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from("Content-Encoding: nonce\0\x01", "latin1")).subarray(0, 12);
  const decipher = createDecipheriv("aes-128-gcm", key, nonce);
  decipher.setAuthTag(ciphertext.subarray(-16));
  const plain = Buffer.concat([decipher.update(ciphertext.subarray(0, -16)), decipher.final()]);
  return JSON.parse(plain.subarray(0, -1).toString("utf8"));
}

function doc(...content: NodeJson[]): DocumentJson {
  return { type: "doc", content };
}

function mentioning(accountId: string): DocumentJson {
  return doc({
    type: "paragraph",
    content: [
      { type: "text", text: "Please check " },
      { type: "mention", attrs: { id: accountId } },
    ],
  });
}

describe.skipIf(!baseUrl)("browser push", () => {
  let test: TestServices;
  let server: Server;
  let serviceUrl = "";
  const received: { path: string; headers: IncomingHttpHeaders; body: Buffer }[] = [];
  let answer = 201;
  const { organization, member, space } = spaceFixtures(() => test);

  beforeAll(async () => {
    server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        received.push({ path: request.url ?? "", headers: request.headers, body: Buffer.concat(chunks) });
        response.writeHead(answer);
        response.end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    serviceUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    test = await createTestServices(baseUrl ?? "", {
      configuredInstanceUrl: "https://wiki.example.org",
      pushPolicy: outboundPolicy(["127.0.0.0/8"]),
    });
    await test.pool.query("insert into instance (id, setup_completed_at) values (1, now())");
  });

  afterAll(async () => {
    await test?.close();
    await new Promise((resolve) => server?.close(resolve));
  });

  async function setup() {
    const org = await organization();
    const editorId = await member(org.id, "member", "Editor");
    const readerId = await member(org.id, "member", "Reader");
    const created = await space(org.id, editorId, {
      grants: [{ principalKind: "account", principalId: readerId, role: "reader" }],
    });
    return { org, space: created, editorId, readerId, editor: accountPrincipal(editorId) };
  }

  async function session(accountId: string): Promise<string> {
    const created = await test.database.transaction((tx) =>
      test.services.sessions.create(tx, { accountId, kind: "full", methods: ["password"], client: {} }),
    );
    return created.session.id;
  }

  function browserKeys() {
    const receiver = createECDH("prime256v1");
    receiver.generateKeys();
    const auth = randomBytes(16);
    return {
      privateKey: receiver.getPrivateKey(),
      auth,
      keys: { p256dh: receiver.getPublicKey().toString("base64url"), auth: auth.toString("base64url") },
    };
  }

  async function device(accountId: string) {
    const sessionId = await session(accountId);
    const browser = browserKeys();
    const id = uuidv7();
    const endpoint = `${serviceUrl}/push/${randomUUID()}`;
    await test.database.execute(sql`
      insert into push_subscriptions (id, account_id, session_id, endpoint_hash, subscription)
      values (${id}, ${accountId}, ${sessionId}, ${randomBytes(32)}, ${test.encryption.encrypt(
        JSON.stringify({ endpoint, ...browser.keys }),
        `push_subscriptions.subscription:${id}`,
      )})`);
    return { id, sessionId, endpoint, ...browser };
  }

  async function enable(on = true) {
    await test.settings.set(browserPushSetting, {}, "instance", on);
  }

  async function mentionedIn(context: Awaited<ReturnType<typeof setup>>) {
    const page = await test.services.tree.create(context.editor, context.space.id, {
      kind: "page",
      title: `Runbook ${randomUUID().slice(0, 6)}`,
      mode: "publish",
      placement: { parentId: null },
    });
    await test.services.documents.replace(context.editor, page.id, mentioning(context.readerId));
    await test.services.versions.publish(context.editor, page.id);
    return page;
  }

  async function queued(accountId: string): Promise<string[]> {
    const result = await test.database.execute<{ id: string }>(
      sql`select id from push_outbox where recipient_id = ${accountId} order by created_at`,
    );
    return result.rows.map((row) => row.id);
  }

  async function deliverAll(lastAttempt = true) {
    const ids: string[] = [];
    await test.services.push.queuePending(async (id) => {
      ids.push(id);
    });
    for (const id of ids) await test.services.push.deliver(id, lastAttempt);
    return ids;
  }

  it("is off until an instance administrator turns it on, and then queues nothing", async () => {
    await enable(false);
    const context = await setup();
    await device(context.readerId);
    expect(await test.services.push.status()).toEqual({ enabled: false, publicKey: null });
    const sessionId = await session(context.readerId);
    await expect(
      test.services.push.subscribe(context.readerId, sessionId, {
        endpoint: "https://push.example.com/abc",
        keys: browserKeys().keys,
      }),
    ).rejects.toMatchObject({ code: "pushDisabled" });
    await mentionedIn(context);
    expect(await queued(context.readerId)).toEqual([]);
  });

  it("creates one key pair per instance and stores it encrypted", async () => {
    await enable();
    const [first, second] = await Promise.all([test.services.push.status(), test.services.push.status()]);
    expect(first.publicKey).toMatch(/^[A-Za-z0-9_-]{87}$/);
    expect(second.publicKey).toBe(first.publicKey);
    const stored = await test.database.execute<{ value: Buffer }>(
      sql`select value from instance_secrets where name = 'push.vapidKeys'`,
    );
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0]?.value.toString("latin1")).not.toContain(first.publicKey ?? "");
  });

  it("adds devices per session, lists and removes them, and forgets them when the session ends", async () => {
    await enable();
    const context = await setup();
    const phone = await session(context.readerId);
    const laptop = await session(context.readerId);
    const keys = browserKeys().keys;
    const endpoint = `https://push.example.com/${randomUUID()}`;
    await test.services.push.subscribe(context.readerId, phone, { endpoint, keys });
    await test.services.push.subscribe(context.readerId, laptop, { endpoint, keys });
    const devices = await test.services.push.devices(context.readerId, laptop);
    expect(devices).toHaveLength(1);
    expect(devices[0]?.current).toBe(true);

    for (const invalid of [
      { endpoint: "http://push.example.com/abc", keys },
      { endpoint: "https://push.example.com/abc", keys: { ...keys, p256dh: "short" } },
      { endpoint: "not a url", keys },
    ]) {
      const error = await test.services.push.subscribe(context.readerId, phone, invalid).catch((e) => e);
      expect(error).toBeInstanceOf(PushSubscriptionError);
      expect(error.code).toBe("invalidSubscription");
    }

    const other = await test.services.push.subscribe(context.readerId, phone, {
      endpoint: `https://push.example.com/${randomUUID()}`,
      keys,
    });
    expect(await test.services.push.remove(context.editorId, other.id)).toBe(false);
    expect(await test.services.push.remove(context.readerId, other.id)).toBe(true);

    await test.database.transaction((tx) =>
      test.services.sessions.endAll(tx, context.readerId, { keep: phone }),
    );
    expect(await test.services.push.devices(context.readerId, null)).toEqual([]);
  });

  it("sends nothing to devices whose session ended under the organization's limits or was revoked", async () => {
    await enable();
    const context = await setup();
    await test.settings.set(sessionIdleTimeoutSetting, { organization: context.org.id }, "organization", 30);
    const idle = await device(context.readerId);
    const revoked = await device(context.readerId);
    const active = await device(context.readerId);
    await test.database.execute(
      sql`update sessions set last_used_at = now() - interval '31 minutes' where id = ${idle.sessionId}`,
    );
    expect(await test.services.sessions.end(context.readerId, revoked.sessionId, "endedByAccount")).toBe(
      true,
    );
    expect((await test.services.push.devices(context.readerId, null)).map((entry) => entry.id)).toEqual([
      idle.id,
      active.id,
    ]);
    received.length = 0;
    answer = 201;
    await mentionedIn(context);
    await deliverAll();
    expect(received.map((entry) => entry.path)).toEqual([new URL(active.endpoint).pathname]);
    expect((await test.services.push.devices(context.readerId, null)).map((entry) => entry.id)).toEqual([
      active.id,
    ]);
    const left = await test.database.execute(sql`select 1 from sessions where id = ${idle.sessionId}`);
    expect(left.rows).toEqual([]);
  });

  it("drops a message when its job ends for good, and abandoned messages as well", async () => {
    await enable();
    const context = await setup();
    const phone = await device(context.readerId);
    const handlers = new Map<string, JobHandler<unknown>>();
    const jobs = {
      work: async (definition: { name: string }, handler: JobHandler<unknown>) => {
        handlers.set(definition.name, handler);
      },
      enqueue: async () => randomUUID(),
      schedule: async () => undefined,
    } as unknown as JobQueue;
    const listener = { listen: async () => undefined, onReconnect: () => undefined };
    await startPushDelivery({
      jobs,
      listener: listener as unknown as NotificationListener,
      push: test.services.push,
      logger: createLogger({ service: "test", level: "silent" }),
    });
    const deliver = handlers.get(pushDeliveryJob.name);
    await test.database.execute(
      sql`update push_subscriptions set subscription = '\\x00' where id = ${phone.id}`,
    );
    await mentionedIn(context);
    const [entryId] = await queued(context.readerId);
    const payload = { entryId: entryId ?? "" };
    await expect(deliver?.(testJobContext(pushDeliveryJob.name, payload, 0))).rejects.toThrow();
    expect(await queued(context.readerId)).toEqual([entryId]);
    await deliver?.(testJobContext(pushDeliveryJob.name, payload, pushDeliveryJob.retryLimit));
    expect(await queued(context.readerId)).toEqual([]);

    await mentionedIn(context);
    await test.database.execute(
      sql`update push_outbox set queued_at = now() - interval '2 hours' where recipient_id = ${context.readerId}`,
    );
    expect(await test.services.push.dropAbandoned()).toBe(1);
    expect(await queued(context.readerId)).toEqual([]);
  });

  it("sends the event text, title and link encrypted to every device and follows the preference", async () => {
    await enable();
    const context = await setup();
    const phone = await device(context.readerId);
    const laptop = await device(context.readerId);
    received.length = 0;
    answer = 201;
    const page = await mentionedIn(context);
    expect(await deliverAll()).toHaveLength(1);
    expect(received.map((entry) => entry.path).sort()).toEqual(
      [new URL(phone.endpoint).pathname, new URL(laptop.endpoint).pathname].sort(),
    );
    const message = received.find((entry) => entry.path === new URL(phone.endpoint).pathname);
    expect(message?.headers).toMatchObject({ "content-encoding": "aes128gcm", ttl: "86400" });
    expect(message?.headers.authorization).toMatch(/^vapid t=[^,]+, k=/);
    expect(decrypt(message?.body ?? Buffer.alloc(0), phone.privateKey, phone.auth)).toEqual({
      title: "Editor mentioned you",
      body: page.title,
      url: `/spaces/${context.space.key}/pages/${page.id}/${page.title.toLowerCase().replace(/\s+/g, "-")}`,
      tag: `content.mentioned:${page.id}`,
    });
    expect(message?.body.toString("latin1")).not.toContain(page.title);
    expect(await queued(context.readerId)).toEqual([]);

    const mentions = notificationEventSettings.get("mentions");
    if (!mentions) throw new Error("No mention settings");
    await test.settings.set(mentions.push, { user: context.readerId }, "user", false);
    await mentionedIn(context);
    expect(await queued(context.readerId)).toEqual([]);
  });

  it("leaves out content the person can no longer read when it is sent", async () => {
    await enable();
    const context = await setup();
    await device(context.readerId);
    received.length = 0;
    const page = await mentionedIn(context);
    expect(await queued(context.readerId)).toHaveLength(1);
    await test.services.trash.deleteItem(context.editor, page.id);
    await deliverAll();
    expect(received).toEqual([]);
    expect(await queued(context.readerId)).toEqual([]);
  });

  it("removes devices the push service reports as gone and retries while it is unavailable", async () => {
    await enable();
    const context = await setup();
    await device(context.readerId);
    answer = 503;
    await mentionedIn(context);
    const ids: string[] = [];
    await test.services.push.queuePending(async (id) => {
      ids.push(id);
    });
    const [id] = ids;
    await expect(test.services.push.deliver(id ?? "", false)).rejects.toThrow();
    expect(await queued(context.readerId)).toEqual([id]);
    await test.services.push.deliver(id ?? "", true);
    expect(await queued(context.readerId)).toEqual([]);
    expect(await test.services.push.devices(context.readerId, null)).toHaveLength(1);

    answer = 410;
    await mentionedIn(context);
    await deliverAll();
    expect(await test.services.push.devices(context.readerId, null)).toEqual([]);
    answer = 201;
  });

  it("pushes once for notifications that are combined in the app", async () => {
    await enable();
    const context = await setup();
    await device(context.readerId);
    const changes = notificationEventSettings.get("changes");
    if (!changes) throw new Error("No change settings");
    await test.settings.set(changes.push, { user: context.readerId }, "user", true);
    const page = await mentionedIn(context);
    await deliverAll();
    await test.services.watches.set(context.readerId, { type: "item", id: page.id }, { state: "watching" });
    for (const words of ["First", "Second"]) {
      await test.services.documents.replace(
        context.editor,
        page.id,
        doc({ type: "paragraph", content: [{ type: "text", text: words }] }),
      );
      await test.services.versions.publish(context.editor, page.id);
    }
    const rows = await test.database.execute<{ type: string }>(
      sql`select type from push_outbox where recipient_id = ${context.readerId}`,
    );
    expect(rows.rows.map((row) => row.type)).toEqual(["content.changed"]);
  });
});
