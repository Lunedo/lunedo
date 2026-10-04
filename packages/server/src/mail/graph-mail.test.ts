import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
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

describe.skipIf(!baseUrl)("e-mail through Microsoft Graph", () => {
  let test: TestServices;
  let graph: FakeGraph;
  let ownerId: string;

  beforeAll(async () => {
    test = await createTestServices(baseUrl ?? "");
    graph = await startFakeGraph();
    const owner = await test.database.transaction((tx) =>
      test.services.accounts.createStandard(tx, {
        email: "owner@pagehall.test",
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
    senderName: "Pagehall",
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
        from: { emailAddress: { address: SENDER, name: "Pagehall" } },
        body: { contentType: "HTML" },
      },
    });
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

  it("explains a mailbox outside the scope of the app, an unknown mailbox and an expired secret", async () => {
    graph.data.mailScope = ["bob@example.org"];
    expect(await test.services.mail.sendGraphTest(actor(), "reader@example.net", "en")).toEqual({
      delivered: false,
      error: { code: "graphMailboxNotAllowed", responseCode: 403 },
    });
    graph.data.mailScope = null;
    expect(
      await test.services.mail.sendGraphTest(
        actor(),
        "reader@example.net",
        "en",
        configuration("nobody@example.org"),
      ),
    ).toEqual({ delivered: false, error: { code: "graphMailboxUnknown", responseCode: 404 } });

    graph.data.secretExpired = true;
    const other = test.anotherNode();
    expect(await other.mail.sendGraphTest(actor(), "reader@example.net", "en")).toEqual({
      delivered: false,
      error: { code: "graphCredentialExpired", responseCode: 401 },
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
      error: { code: "graphCredentialMissing", responseCode: null },
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

    await test.settings.set(graphMailSetting, {}, "instance", configuration());
    const before = graph.requests.length;
    const result = await strict.sendGraphTest(actor(), "reader@example.net", "en");
    expect(result.delivered).toBe(false);
    expect(graph.requests.length).toBe(before);
  });
});
