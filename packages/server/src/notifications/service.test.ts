import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { instanceUrlSetting } from "../accounts/instance-settings.js";
import { accountPrincipal, SYSTEM } from "../accounts/principal.js";
import { NotificationListener } from "../database/notifications.js";
import { createLogger } from "../logging/logger.js";
import { graphMailSetting, mailMethodSetting, smtpSetting } from "../mail/mail-service.js";
import { accentColorSetting, dateFormatSetting } from "../settings/preferences.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { deliverPendingMail } from "../testing/jobs.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { NotificationHub } from "./hub.js";
import type { NotifyInput } from "./service.js";
import { notificationEventSettings, notificationRetentionSetting } from "./types.js";

const baseUrl = testDatabaseBaseUrl();

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

const SMTP = {
  host: "smtp.example.org",
  port: 25,
  security: "none" as const,
  username: null,
  from: "w@example.org",
  oauth2: null,
};

describe.skipIf(!baseUrl)("notifications", () => {
  let test: TestServices;

  beforeAll(async () => {
    test = await createTestServices(baseUrl ?? "");
    await test.pool.query("insert into instance (id, setup_completed_at) values (1, now())");
    await test.settings.set(instanceUrlSetting, {}, "instance", "https://wiki.example.org");
  });

  afterAll(async () => {
    await test?.close();
  });

  async function standard(home: string | null): Promise<{ id: string; email: string }> {
    const email = `${randomUUID()}@example.org`;
    const account = await test.database.transaction((tx) =>
      test.services.accounts.createStandard(tx, {
        email,
        name: "Person",
        password: "a long test passphrase",
        homeOrganizationId: home,
      }),
    );
    return { id: account.id, email };
  }

  async function organization() {
    const owner = await standard(null);
    const created = await test.services.organizations.createAsActor(SYSTEM, {
      name: `Organization ${randomUUID().slice(0, 8)}`,
      ownerAccountId: owner.id,
    });
    return { id: created.id, name: created.name, owner };
  }

  function guestNotice(
    organizationId: string,
    recipients: string[],
    targetId: string = randomUUID(),
  ): NotifyInput {
    return {
      type: "guest.expiring",
      recipients,
      organizationId,
      targetId,
      params: { organizationName: "Org", guestName: "Gina <Guest>", expiresAt: "2026-10-20T10:00:00.000Z" },
    };
  }

  async function notify(input: NotifyInput) {
    const result = await test.database.transaction((tx) => test.services.notifications.notify(tx, input));
    await test.services.notifications.dispatch(result.mailIds);
    return result;
  }

  async function rows(recipientId: string) {
    const result = await test.pool.query<{ type: string; count: number; read_at: Date | null }>(
      "select type, count, read_at from notifications where recipient_id = $1 order by created_at",
      [recipientId],
    );
    return result.rows;
  }

  it("combines events on the same target within a short time into one notification", async () => {
    const org = await organization();
    const target = randomUUID();
    await notify(guestNotice(org.id, [org.owner.id], target));
    await notify(guestNotice(org.id, [org.owner.id], target));
    await notify(guestNotice(org.id, [org.owner.id]));
    expect((await rows(org.owner.id)).map((row) => row.count)).toEqual([2, 1]);

    const [first] = (await test.services.notifications.list(org.owner.id, { limit: 10 })).items.slice(-1);
    expect(await test.services.notifications.markRead(org.owner.id, first?.id ?? "")).toBe(true);
    await notify(guestNotice(org.id, [org.owner.id], target));
    expect((await rows(org.owner.id)).map((row) => row.count)).toEqual([2, 1, 1]);

    await test.pool.query(
      "update notifications set updated_at = now() - interval '1 hour' where recipient_id = $1",
      [org.owner.id],
    );
    await notify(guestNotice(org.id, [org.owner.id], target));
    expect(await rows(org.owner.id)).toHaveLength(4);
  });

  it("never creates two notifications when two nodes notify at the same moment", async () => {
    const org = await organization();
    const target = randomUUID();
    await Promise.all(Array.from({ length: 6 }, () => notify(guestNotice(org.id, [org.owner.id], target))));
    expect(await rows(org.owner.id)).toEqual([expect.objectContaining({ count: 6 })]);
  });

  it("hides notifications whose target the recipient can no longer see", async () => {
    const org = await organization();
    const administrator = await standard(org.id);
    const assignment = await test.services.roles.assign(SYSTEM, {
      scope: "organization",
      organizationId: org.id,
      role: { builtIn: "administrator" },
      principal: { kind: "account", id: administrator.id },
    });
    await notify(guestNotice(org.id, [administrator.id]));
    expect(await test.services.notifications.unreadCount(administrator.id)).toBe(1);

    await test.services.roles.unassign(SYSTEM, "organization", org.id, assignment.id);
    expect(await test.services.notifications.unreadCount(administrator.id)).toBe(0);
    expect((await test.services.notifications.list(administrator.id, { limit: 10 })).items).toEqual([]);
  });

  it("treats hidden notifications like unknown ones when marking them as read", async () => {
    const org = await organization();
    const administrator = await standard(org.id);
    const assignment = await test.services.roles.assign(SYSTEM, {
      scope: "organization",
      organizationId: org.id,
      role: { builtIn: "administrator" },
      principal: { kind: "account", id: administrator.id },
    });
    await notify(guestNotice(org.id, [administrator.id]));
    await notify(guestNotice(org.id, [administrator.id]));
    const [hidden] = (await test.services.notifications.list(administrator.id, { limit: 10 })).items;
    await test.services.roles.unassign(SYSTEM, "organization", org.id, assignment.id);

    expect(await test.services.notifications.markRead(administrator.id, hidden?.id ?? "")).toBe(false);
    expect(await test.services.notifications.markRead(administrator.id, randomUUID())).toBe(false);
    expect(await test.services.notifications.markAllRead(administrator.id)).toBe(0);
    expect((await rows(administrator.id)).every((row) => row.read_at === null)).toBe(true);
  });

  it("shows guest notices to the guest's responsible person without administrator rights", async () => {
    const org = await organization();
    const responsible = await standard(org.id);
    const guest = await standard(null);
    await test.pool.query(
      "insert into memberships (id, organization_id, account_id, kind, responsible_account_id) values (gen_random_uuid(), $1, $2, 'guest', $3)",
      [org.id, guest.id, responsible.id],
    );
    await notify(guestNotice(org.id, [responsible.id], guest.id));
    const page = await test.services.notifications.list(responsible.id, { limit: 10 });
    expect(page.items).toEqual([
      expect.objectContaining({
        type: "guest.expiring",
        organizationId: org.id,
        target: { type: "account", id: guest.id },
        count: 1,
        readAt: null,
      }),
    ]);
  });

  it("pages over hidden notifications without losing visible ones", async () => {
    const org = await organization();
    const other = await organization();
    for (let index = 0; index < 5; index += 1) {
      await notify(guestNotice(org.id, [org.owner.id]));
      await notify(guestNotice(other.id, [org.owner.id]));
    }
    const seen: string[] = [];
    let after: [string, string] | undefined;
    do {
      const page = await test.services.notifications.list(org.owner.id, { limit: 2, after });
      seen.push(...page.items.map((item) => item.organizationId ?? ""));
      after = page.next ?? undefined;
    } while (after);
    expect(seen).toEqual([org.id, org.id, org.id, org.id, org.id]);
  });

  it("follows the preferences of instance, organization and user", async () => {
    await test.settings.set(smtpSetting, {}, "instance", SMTP);
    const org = await organization();
    const setting = notificationEventSettings.get("guestExpiring");
    if (!setting) throw new Error("No settings for guest expiry");
    await test.settings.set(setting.email, { organization: org.id }, "organization", "off");

    const first = await notify(guestNotice(org.id, [org.owner.id]));
    expect(first.mailIds).toEqual([]);
    expect(await rows(org.owner.id)).toHaveLength(1);

    await test.settings.set(setting.inApp, { organization: org.id, user: org.owner.id }, "user", false);
    await test.settings.set(
      setting.email,
      { organization: org.id, user: org.owner.id },
      "user",
      "immediately",
    );
    const second = await notify(guestNotice(org.id, [org.owner.id]));
    expect(second.mailIds).toHaveLength(1);
    expect(await rows(org.owner.id)).toHaveLength(1);
    expect(setting.inApp.key).toBe("notifications.guestExpiring.inApp");
    expect(setting.email.key).toBe("notifications.guestExpiring.email");
    await test.settings.set(smtpSetting, {}, "instance", null);
  });

  it("queues e-mail when the instance sends through Microsoft Graph", async () => {
    const org = await organization();
    await test.settings.set(graphMailSetting, {}, "instance", {
      tenantId: "00000000-0000-0000-0000-000000000001",
      clientId: "00000000-0000-0000-0000-000000000002",
      sender: "wiki@example.org",
      senderName: "Lunedo",
      authority: "https://login.microsoftonline.com",
      graphUrl: "https://graph.microsoft.com",
    });
    await test.settings.set(mailMethodSetting, {}, "instance", "graph");
    const sent = await notify(guestNotice(org.id, [org.owner.id]));
    expect(sent.mailIds).toHaveLength(1);
    await test.settings.set(mailMethodSetting, {}, "instance", "smtp");
    await test.settings.set(graphMailSetting, {}, "instance", null);
  });

  it("splits stored preferences of a type into one value per channel", async () => {
    const scopeId = randomUUID();
    await test.pool.query(
      `insert into setting_values (id, level, scope_id, key, value, locked) values
        (gen_random_uuid(), 'organization', $1, 'notifications.guestExpiring', '{"inApp": false, "email": true}', true),
        (gen_random_uuid(), 'organization', $1, 'notifications.guestInactive', null, true),
        (gen_random_uuid(), 'organization', $1, 'notifications.retentionDays', '30', false)`,
      [scopeId],
    );
    const migration = readFileSync(
      new URL("../../drizzle/0061_watching_and_preferences.sql", import.meta.url),
      "utf8",
    );
    for (const statement of migration.split("--> statement-breakpoint").slice(-3)) {
      await test.pool.query(statement);
    }
    const stored = await test.pool.query<{ key: string; value: unknown; locked: boolean }>(
      "select key, value, locked from setting_values where scope_id = $1 order by key",
      [scopeId],
    );
    expect(stored.rows).toEqual([
      { key: "notifications.guestExpiring.email", value: "immediately", locked: true },
      { key: "notifications.guestExpiring.inApp", value: false, locked: true },
      { key: "notifications.guestInactive.email", value: null, locked: true },
      { key: "notifications.guestInactive.inApp", value: null, locked: true },
      { key: "notifications.retentionDays", value: 30, locked: false },
    ]);
  });

  it("sends e-mail only when a mail server is configured, with the organization's logo and the instance color", async () => {
    const org = await organization();
    const quiet = await notify(guestNotice(org.id, [org.owner.id]));
    expect(quiet.mailIds).toEqual([]);

    await test.settings.set(smtpSetting, {}, "instance", SMTP);
    await test.settings.set(accentColorSetting, {}, "instance", "violet");
    const updated = await test.services.organizations.setLogo(SYSTEM, org.id, {
      contentType: "image/png",
      data: PNG,
    });
    const sent = await notify(guestNotice(org.id, [org.owner.id]));
    expect(sent.mailIds).toHaveLength(1);
    await deliverPendingMail(test.services, test.database);
    const mail = test.mail.sent.filter((entry) => entry.to === org.owner.email).at(-1);
    expect(mail?.subject).toContain("Gina <Guest>");
    expect(mail?.html).toContain("Gina &lt;Guest&gt;");
    expect(mail?.html).toContain(
      `https://wiki.example.org/api/v1/organizations/${org.id}/logo?v=${updated.logoRef}`,
    );
    expect(mail?.html).toContain("#6B4FB3");
    expect(mail?.html).toContain('href="https://wiki.example.org/settings/notifications"');
    expect(mail?.text).toContain("https://wiki.example.org/settings/notifications");
    expect(mail?.text).toContain("20 Oct 2026");

    await test.settings.set(dateFormatSetting, { user: org.owner.id }, "user", "DD.MM.YYYY");
    await notify(guestNotice(org.id, [org.owner.id]));
    await deliverPendingMail(test.services, test.database);
    const own = test.mail.sent.filter((entry) => entry.to === org.owner.email).at(-1);
    expect(own?.text).toContain("20.10.2026");
    await test.settings.set(smtpSetting, {}, "instance", null);
    await test.settings.clear(accentColorSetting, {}, "instance");
  });

  it("offers a one-click unsubscribe in administration mails and none in security mails", async () => {
    const org = await organization();
    await test.settings.set(smtpSetting, {}, "instance", SMTP);
    await notify(guestNotice(org.id, [org.owner.id]));
    await notify({
      type: "signIn.newBrowser",
      recipients: [org.owner.id],
      organizationId: null,
      targetId: randomUUID(),
      params: { browser: "Firefox", operatingSystem: "Linux", clientIp: "192.0.2.1" },
    });
    await deliverPendingMail(test.services, test.database);
    const [guest, security] = test.mail.sent.filter((entry) => entry.to === org.owner.email).slice(-2);

    const oneClick = /^<https:\/\/wiki\.example\.org\/api\/v1\/notifications\/unsubscribe\/([^>]+)>$/.exec(
      guest?.headers?.["List-Unsubscribe"] ?? "",
    );
    expect(guest?.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(guest?.text).toContain(
      `Stop e-mails like this: https://wiki.example.org/unsubscribe/${oneClick?.[1]}`,
    );
    expect(guest?.text).not.toContain("for your account's security");
    expect(await test.services.unsubscribe.describe(oneClick?.[1] ?? "")).toEqual({
      scope: { kind: "event", event: "guestExpiring" },
      off: false,
    });

    expect(security?.headers).toBeUndefined();
    expect(security?.text).not.toContain("/unsubscribe/");
    expect(security?.text).toContain("You receive this mail for your account's security.");
    expect(security?.html).toContain("You receive this mail for your account&#39;s security.");
    const forged = await test.services.unsubscribe.token(org.owner.id, {
      kind: "event",
      event: "signInNewBrowser",
    });
    expect(await test.services.unsubscribe.describe(forged)).toBeNull();
    expect(await test.services.unsubscribe.apply(forged)).toBeNull();
    await test.settings.set(smtpSetting, {}, "instance", null);
  });

  it("skips deactivated recipients", async () => {
    const org = await organization();
    const person = await standard(org.id);
    await test.pool.query("update accounts set state = 'deactivated' where id = $1", [person.id]);
    const result = await notify(guestNotice(org.id, [person.id, org.owner.id]));
    expect(result.recipients).toBe(1);
    expect(await rows(person.id)).toEqual([]);
  });

  it("marks one or all notifications as read, only for their recipient", async () => {
    const org = await organization();
    const stranger = await standard(null);
    await notify(guestNotice(org.id, [org.owner.id]));
    await notify(guestNotice(org.id, [org.owner.id]));
    const [newest] = (await test.services.notifications.list(org.owner.id, { limit: 10 })).items;
    expect(await test.services.notifications.markRead(stranger.id, newest?.id ?? "")).toBe(false);
    expect(await test.services.notifications.markRead(org.owner.id, newest?.id ?? "")).toBe(true);
    expect(await test.services.notifications.unreadCount(org.owner.id)).toBe(1);

    const before = new Date(Date.now() - 60_000);
    expect(await test.services.notifications.markAllRead(org.owner.id, before)).toBe(0);
    expect(await test.services.notifications.markAllRead(org.owner.id)).toBe(1);
    expect(await test.services.notifications.unreadCount(org.owner.id)).toBe(0);
    const unread = await test.services.notifications.list(org.owner.id, { limit: 10, unreadOnly: true });
    expect(unread.items).toEqual([]);
  });

  it("counts unread notifications the recipient may see, without read, in-app disabled, hidden or deleted ones", async () => {
    const org = await organization();
    const other = await organization();
    for (let index = 0; index < 4; index += 1) await notify(guestNotice(org.id, [org.owner.id]));
    await notify(guestNotice(other.id, [org.owner.id]));
    const [newest, second, third] = (await test.services.notifications.list(org.owner.id, { limit: 10 }))
      .items;
    await test.services.notifications.markRead(org.owner.id, newest?.id ?? "");
    await test.pool.query("update notifications set in_app = false where id = $1", [second?.id]);
    await test.pool.query("delete from notifications where id = $1", [third?.id]);

    expect(await test.services.notifications.unreadCount(org.owner.id)).toBe(1);
    expect(await test.services.notifications.unreadCount(org.owner.id, "requests")).toBe(0);
    expect(await test.services.notifications.unreadCount(other.owner.id)).toBe(0);
  });

  it("counts a notification that combines several events once", async () => {
    const org = await organization();
    const target = randomUUID();
    await notify(guestNotice(org.id, [org.owner.id], target));
    await notify(guestNotice(org.id, [org.owner.id], target));
    await notify(guestNotice(org.id, [org.owner.id]));
    expect(await test.services.notifications.unreadCount(org.owner.id)).toBe(2);
  });

  it("stops counting at 100, so a large backlog costs a bounded amount of work", async () => {
    const org = await organization();
    await notify(guestNotice(org.id, [org.owner.id]));
    await test.pool.query(
      `insert into notifications (id, recipient_id, organization_id, type, target_type, target_id, params, group_key,
         in_app, email_status, count, created_at, updated_at)
       select gen_random_uuid(), recipient_id, organization_id, type, target_type, gen_random_uuid()::text, params,
         group_key || n, in_app, email_status, count, created_at, updated_at - make_interval(secs => n)
       from notifications, generate_series(1, 1000) as n where recipient_id = $1`,
      [org.owner.id],
    );
    expect(await test.services.notifications.unreadCount(org.owner.id)).toBe(100);
  });

  it("counts visible notifications behind more than 100 hidden ones", async () => {
    const org = await organization();
    for (let index = 0; index < 3; index += 1) await notify(guestNotice(org.id, [org.owner.id]));
    await test.pool.query(
      `insert into notifications (id, recipient_id, organization_id, type, target_type, target_id, params, group_key,
         in_app, count, created_at, updated_at)
       select gen_random_uuid(), $1, $2, 'content.changed', 'item', gen_random_uuid()::text, '{}'::jsonb,
         'hidden-' || n, true, 1, now(), now() + make_interval(secs => n)
       from generate_series(1, 150) as n`,
      [org.owner.id, org.id],
    );
    expect(await test.services.notifications.unreadCount(org.owner.id)).toBe(3);
  });

  it("asks the authorization service once per decision, however many notifications share it", async () => {
    const org = await organization();
    const administrator = await standard(org.id);
    await test.services.roles.assign(SYSTEM, {
      scope: "organization",
      organizationId: org.id,
      role: { builtIn: "administrator" },
      principal: { kind: "account", id: administrator.id },
    });
    for (let index = 0; index < 12; index += 1) {
      await notify({
        ...guestNotice(org.id, [administrator.id]),
        params: {
          organizationName: "Org",
          guestName: `Guest ${index}`,
          expiresAt: "2026-10-20T10:00:00.000Z",
        },
      });
    }
    const explain = vi.spyOn(test.services.authorization, "explainMany");
    try {
      expect(await test.services.notifications.unreadCount(administrator.id)).toBe(12);
      expect(explain).toHaveBeenCalledTimes(1);
      expect(explain.mock.calls[0]?.[2]).toHaveLength(1);
    } finally {
      explain.mockRestore();
    }
  });

  it("removes notifications older than the retention period", async () => {
    const org = await organization();
    await notify(guestNotice(org.id, [org.owner.id]));
    await notify(guestNotice(org.id, [org.owner.id]));
    await test.settings.set(notificationRetentionSetting, {}, "instance", 30);
    await test.pool.query(
      "update notifications set updated_at = now() - interval '31 days' where id = (select id from notifications where recipient_id = $1 limit 1)",
      [org.owner.id],
    );
    expect(await test.services.notifications.applyRetention()).toBeGreaterThanOrEqual(1);
    expect(await rows(org.owner.id)).toHaveLength(1);
    await test.settings.set(notificationRetentionSetting, {}, "instance", 90);
  });

  it("rejects unknown types and invalid parameters", async () => {
    const org = await organization();
    await expect(notify({ ...guestNotice(org.id, [org.owner.id]), type: "unknown.type" })).rejects.toThrow(
      "Unknown notification type",
    );
    await expect(
      notify({ ...guestNotice(org.id, [org.owner.id]), params: { guestName: 1 } }),
    ).rejects.toThrow();
  });

  it("tells every node about new notifications of an account after the commit", async () => {
    const org = await organization();
    const logger = createLogger({ service: "test", level: "silent" });
    const listeners = [
      new NotificationListener({ connectionString: test.url, logger }),
      new NotificationListener({ connectionString: test.url, logger }),
    ];
    try {
      const hubs = listeners.map((listener) => new NotificationHub(listener));
      const received = [0, 0];
      const unsubscribe = await Promise.all(
        hubs.map((hub, index) =>
          hub.subscribe(org.owner.id, () => {
            received[index] = (received[index] ?? 0) + 1;
          }),
        ),
      );
      const other = await standard(null);
      let foreign = 0;
      await hubs[0]?.subscribe(other.id, () => {
        foreign += 1;
      });
      await test.database.transaction(async (tx) => {
        await test.services.notifications.notify(tx, guestNotice(org.id, [org.owner.id]));
        await new Promise((resolve) => setTimeout(resolve, 200));
        expect(received).toEqual([0, 0]);
      });
      await expect.poll(() => received, { timeout: 5000 }).toEqual([1, 1]);
      expect(foreign).toBe(0);
      for (const remove of unsubscribe) remove();
      expect(hubs[1]?.subscriptions).toBe(0);
    } finally {
      for (const listener of listeners) await listener.close();
    }
  });

  it("explains a notification only to those who may see its target", async () => {
    const org = await organization();
    const outsider = await standard(null);
    await notify({
      type: "breakGlass.started",
      recipients: [org.owner.id, outsider.id],
      organizationId: org.id,
      targetId: randomUUID(),
      actor: accountPrincipal(outsider.id),
      params: {
        organizationName: org.name,
        requesterName: "Person",
        reason: "A long enough reason",
        minutes: 60,
      },
    });
    expect(await test.services.notifications.unreadCount(org.owner.id)).toBe(1);
    expect(await test.services.notifications.unreadCount(outsider.id)).toBe(0);
    const [item] = (await test.services.notifications.list(org.owner.id, { limit: 1 })).items;
    expect(item?.actor).toEqual({ type: "account", id: outsider.id, name: "Person" });
  });
});
