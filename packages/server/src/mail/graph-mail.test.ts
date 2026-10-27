import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { instanceUrlSetting } from "../accounts/instance-settings.js";
import { accountPrincipal } from "../accounts/principal.js";
import { createLogger } from "../logging/logger.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import {
  type FakeGraph,
  GRAPH_CLIENT_ID,
  GRAPH_CLIENT_SECRET,
  GRAPH_TENANT_ID,
  startFakeGraph,
} from "../testing/fakes/index.js";
import { deliverPendingMail } from "../testing/jobs.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { graphMailSetting, MailService } from "./mail-service.js";

const baseUrl = testDatabaseBaseUrl();
const SENDER = "alice@example.org";

function headerOf(mime: string | undefined, name: string): string | undefined {
  const head = (mime ?? "").split("\r\n\r\n")[0] ?? "";
  const unfolded = head.replace(/\r\n[ \t]+/g, " ");
  const line = unfolded.split("\r\n").find((item) => item.toLowerCase().startsWith(`${name.toLowerCase()}:`));
  return line?.slice(name.length + 1).trim();
}

describe.skipIf(!baseUrl)("e-mail through Microsoft Graph", () => {
  let test: TestServices;
  let graph: FakeGraph;
  let ownerId: string;

  beforeAll(async () => {
    test = await createTestServices(baseUrl ?? "");
    graph = await startFakeGraph();
    const owner = await test.database.transaction((tx) =>
      test.services.accounts.createStandard(tx, {
        email: "owner@lunedo.test",
        name: "Owner",
        password: "a long test passphrase",
        homeOrganizationId: null,
      }),
    );
    ownerId = owner.id;
    await test.pool.query(
      "insert into instance (id, owner_account_id, setup_completed_at) values (1, $1, now())",
      [owner.id],
    );
  });

  afterAll(async () => {
    await graph?.close();
    await test?.close();
  });

  beforeEach(() => {
    graph.data.mailScope = null;
    graph.data.secretExpired = false;
  });

  const actor = () => accountPrincipal(ownerId);
  const configuration = (sender = SENDER) => ({
    tenantId: GRAPH_TENANT_ID,
    clientId: GRAPH_CLIENT_ID,
    sender,
    senderName: "Lunedo",
    authority: graph.url,
    graphUrl: graph.url,
  });

  it("switches to Graph only once the settings and a credential are stored, and sends through sendMail", async () => {
    await expect(test.services.mail.setMethod(actor(), "graph")).rejects.toMatchObject({
      code: "mailNotReady",
    });
    await test.services.mail.configureGraph(actor(), configuration());
    await expect(test.services.mail.setMethod(actor(), "graph")).rejects.toMatchObject({
      code: "mailNotReady",
    });
    await test.services.mail.addGraphCredential(actor(), {
      kind: "clientSecret",
      secret: GRAPH_CLIENT_SECRET,
      expiresAt: null,
    });
    await test.services.mail.setMethod(actor(), "graph");

    await test.database.transaction((tx) =>
      test.services.mail.queue(tx, {
        to: "reader@example.net",
        template: "smtpTest",
        language: "en",
        params: {},
      }),
    );
    await deliverPendingMail(test.services, test.database);
    const sent = graph.sentMail.at(-1);
    expect(sent).toMatchObject({
      mailbox: SENDER,
      saveToSentItems: false,
      message: {
        toRecipients: [{ emailAddress: { address: "reader@example.net" } }],
        from: { emailAddress: { address: SENDER, name: "Lunedo" } },
        body: { contentType: "HTML" },
      },
    });
    expect(sent?.mime).toBeUndefined();
    expect(test.mail.sent.some((mail) => mail.to === "reader@example.net")).toBe(false);

    const events = await test.pool.query<{ name: string; fields: unknown }>(
      "select name, fields from audit_events where name like 'mail.%' order by sequence",
    );
    expect(events.rows.map((row) => row.name)).toEqual([
      "mail.graphChanged",
      "mail.credentialAdded",
      "mail.methodChanged",
    ]);
    expect(JSON.stringify(events.rows)).not.toContain(GRAPH_CLIENT_SECRET);
  });

  it("keeps no copy and sends HTML only without the list headers while the copy is off", async () => {
    await test.services.mail.configureGraph(actor(), { ...configuration(), saveToSentItems: false });
    await test.database.transaction((tx) =>
      test.services.mail.queueMessage(tx, "notification", {
        to: "reader@example.net",
        subject: "Ada mentioned you",
        text: "Ada mentioned you in Runbook, plain text part",
        html: '<p>Ada mentioned you in Runbook</p><a href="https://wiki.example.org/unsubscribe/token">Stop</a>',
        headers: {
          "List-Unsubscribe": "<https://wiki.example.org/api/v1/notifications/unsubscribe/token>",
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      }),
    );
    await deliverPendingMail(test.services, test.database);
    const sent = graph.sentMail.at(-1);
    expect(sent?.saveToSentItems).toBe(false);
    expect(sent?.mime).toBeUndefined();
    expect(sent?.message.body.contentType).toBe("HTML");
    expect(sent?.message.body.content).toContain("https://wiki.example.org/unsubscribe/token");
    expect(JSON.stringify(sent)).not.toContain("List-Unsubscribe");
    expect(JSON.stringify(sent)).not.toContain("plain text part");
  });

  it("sends notification mails as MIME with the list headers, the text part and the HTML part", async () => {
    await test.services.mail.configureGraph(actor(), { ...configuration(), saveToSentItems: true });
    await test.database.transaction((tx) =>
      test.services.mail.queueMessage(tx, "notification", {
        to: "reader@example.net",
        subject: "Ada mentioned you",
        text: "Ada mentioned you in Runbook, plain text part",
        html: '<p>Ada mentioned you in Runbook</p><a href="https://wiki.example.org/unsubscribe/token">Stop</a>',
        headers: {
          "List-Unsubscribe": "<https://wiki.example.org/api/v1/notifications/unsubscribe/token>",
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      }),
    );
    await deliverPendingMail(test.services, test.database);
    const sent = graph.sentMail.at(-1);
    expect(headerOf(sent?.mime, "List-Unsubscribe")).toBe(
      "<https://wiki.example.org/api/v1/notifications/unsubscribe/token>",
    );
    expect(headerOf(sent?.mime, "List-Unsubscribe-Post")).toBe("List-Unsubscribe=One-Click");
    expect(headerOf(sent?.mime, "Subject")).toBe("Ada mentioned you");
    expect(headerOf(sent?.mime, "Content-Type")).toMatch(/^multipart\/alternative/);
    expect(sent?.mime).toMatch(/Content-Type: text\/plain/);
    expect(sent?.mime).toMatch(/Content-Type: text\/html/);
    expect(sent?.mime).toContain("Ada mentioned you in Runbook, plain text part");
    expect(sent?.mime?.replace(/=\r\n/g, "")).toContain("https://wiki.example.org/unsubscribe/token");
  });

  it("lets a reader switch off a mail type through the one-click header of a mail sent through Graph", async () => {
    await test.services.mail.configureGraph(actor(), { ...configuration(), saveToSentItems: true });
    const reader = await test.database.transaction((tx) =>
      test.services.accounts.createStandard(tx, {
        email: "one-click@lunedo.test",
        name: "Reader",
        password: "a long test passphrase",
        homeOrganizationId: null,
      }),
    );
    await test.settings.set(instanceUrlSetting, {}, "instance", "https://wiki.example.org");
    const links = await test.services.unsubscribe.links(reader.id, { kind: "event", event: "mentions" });
    expect(links).not.toBeNull();
    await test.database.transaction((tx) =>
      test.services.mail.queueMessage(tx, "notification", {
        to: "one-click@lunedo.test",
        subject: "Ada mentioned you",
        text: "Ada mentioned you",
        html: "<p>Ada mentioned you</p>",
        headers: {
          "List-Unsubscribe": `<${links?.oneClick}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      }),
    );
    await deliverPendingMail(test.services, test.database);
    const header = headerOf(graph.sentMail.at(-1)?.mime, "List-Unsubscribe") ?? "";
    const token = /\/unsubscribe\/([^>]+)>/.exec(header)?.[1] ?? "";
    expect(await test.services.unsubscribe.apply(token)).toMatchObject({
      applied: true,
      state: { off: true },
    });
  });

  it("explains a mailbox outside the scope of the app, an unknown mailbox and an expired secret", async () => {
    graph.data.mailScope = ["bob@example.org"];
    expect(await test.services.mail.sendGraphTest(actor(), "reader@example.net", "en")).toEqual({
      delivered: false,
      error: { code: "graphMailboxNotAllowed", responseCode: 403, step: "send" },
    });
    graph.data.mailScope = null;
    expect(
      await test.services.mail.sendGraphTest(
        actor(),
        "reader@example.net",
        "en",
        configuration("nobody@example.org"),
      ),
    ).toEqual({ delivered: false, error: { code: "graphMailboxUnknown", responseCode: 404, step: "send" } });

    graph.data.secretExpired = true;
    const other = test.anotherNode();
    expect(await other.mail.sendGraphTest(actor(), "reader@example.net", "en")).toEqual({
      delivered: false,
      error: { code: "graphCredentialExpired", responseCode: 401, step: "token" },
    });
  });

  it("never sends the stored credentials to another app or endpoint in a test", async () => {
    const before = graph.requests.length;
    const other = await test.services.mail.sendGraphTest(actor(), "reader@example.net", "en", {
      ...configuration(),
      clientId: "another-client",
    });
    expect(other).toEqual({
      delivered: false,
      error: { code: "graphCredentialMissing", responseCode: null, step: "token" },
    });
    expect(graph.requests.length).toBe(before);
  });

  it("signs in to Graph with a certificate as well", async () => {
    const certificate = await test.services.mail.addGraphCredential(actor(), {
      kind: "certificate",
      validDays: 365,
    });
    expect(certificate.certificate).toContain("BEGIN CERTIFICATE");
    graph.data.secretExpired = true;
    const node = test.anotherNode();
    expect(await node.mail.sendGraphTest(actor(), "reader@example.net", "en")).toEqual({
      delivered: true,
      error: null,
    });
    await expect(test.services.mail.graphCertificate(certificate.id)).resolves.toContain("BEGIN CERTIFICATE");
  });

  it("keeps the last credential while Graph sends and removes others with an audit event", async () => {
    const credentials = await test.services.mail.graphCredentials();
    for (const credential of credentials.slice(1))
      await test.services.mail.removeGraphCredential(actor(), credential.id);
    const [last] = await test.services.mail.graphCredentials();
    await expect(test.services.mail.removeGraphCredential(actor(), last?.id ?? "")).rejects.toMatchObject({
      code: "lastCredential",
    });
    const removed = await test.pool.query("select 1 from audit_events where name = 'mail.credentialRemoved'");
    expect(removed.rowCount).toBe(credentials.length - 1);
  });

  it("reminds the settings administrators before the last credential expires", async () => {
    const expiring = await test.services.mail.addGraphCredential(actor(), {
      kind: "clientSecret",
      secret: `secret-${randomUUID()}`,
      expiresAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
    });
    await test.pool.query("delete from mail_credentials where id <> $1", [expiring.id]);
    expect(await test.services.mail.sendCredentialReminders()).toBe(1);
    expect(await test.services.mail.sendCredentialReminders()).toBe(0);
    const notices = await test.pool.query<{ recipient_id: string }>(
      "select recipient_id from notifications where type = 'mail.credentialExpiring'",
    );
    expect(notices.rows).toEqual([{ recipient_id: ownerId }]);
  });

  it("refuses Graph settings outside the Microsoft clouds unless insecure providers are allowed", async () => {
    await expect(
      test.services.mail.configureGraph(actor(), { ...configuration(), tenantId: "not a tenant" }),
    ).rejects.toMatchObject({ code: "invalidMailConfiguration", details: { fields: ["tenantId"] } });
    const strict = new MailService({
      database: test.database,
      encryption: test.encryption,
      settings: test.settings,
      audit: test.services.audit,
      jobs: undefined,
      logger: createLogger({ service: "test", level: "silent" }),
    });
    await expect(strict.configureGraph(actor(), configuration())).rejects.toMatchObject({
      code: "invalidMailConfiguration",
      details: { fields: ["authority"] },
    });
    await expect(
      strict.configureGraph(actor(), {
        ...configuration(),
        authority: "https://login.microsoftonline.com",
        graphUrl: "https://graph.example.org",
      }),
    ).rejects.toMatchObject({ details: { fields: ["graphUrl"] } });

    await test.settings.set(graphMailSetting, {}, "instance", { ...configuration(), saveToSentItems: false });
    const before = graph.requests.length;
    const result = await strict.sendGraphTest(actor(), "reader@example.net", "en");
    expect(result.delivered).toBe(false);
    expect(graph.requests.length).toBe(before);
  });
});
