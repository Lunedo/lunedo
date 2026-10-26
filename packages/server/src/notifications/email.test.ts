import { randomUUID } from "node:crypto";
import type { DocumentJson, NodeJson } from "@lunedo/editor-schema";
import { notificationEvents } from "@lunedo/shared";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { instanceUrlSetting } from "../accounts/instance-settings.js";
import { accountPrincipal, SYSTEM } from "../accounts/principal.js";
import { smtpSetting } from "../mail/mail-service.js";
import { languageSetting, timeZoneSetting } from "../settings/builtin.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { deliverPendingMail, testJobContext } from "../testing/jobs.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { spaceFixtures } from "../testing/spaces.js";
import { latestDigestAt } from "./email.js";
import { digestEnabledSetting, digestTimeSetting, notificationEventSettings } from "./types.js";

const baseUrl = testDatabaseBaseUrl();

function paragraph(text: string): NodeJson {
  return { type: "paragraph", content: [{ type: "text", text }] };
}

function doc(...content: NodeJson[]): DocumentJson {
  return { type: "doc", content };
}

function settingsOf(event: string) {
  const settings = notificationEventSettings.get(event);
  if (!settings) throw new Error(`No settings for ${event}`);
  return settings;
}

describe("latestDigestAt", () => {
  it("finds the last digest time in the person's time zone", () => {
    const now = new Date("2026-03-02T07:30:00Z");
    expect(latestDigestAt(now, "08:00", "Europe/Berlin").toISOString()).toBe("2026-03-02T07:00:00.000Z");
    expect(latestDigestAt(now, "08:00", "America/New_York").toISOString()).toBe("2026-03-01T13:00:00.000Z");
    expect(latestDigestAt(now, "07:30", "Europe/Berlin").toISOString()).toBe("2026-03-02T06:30:00.000Z");
  });

  it("keeps the wall-clock time across a change to daylight saving time", () => {
    const now = new Date("2026-03-30T07:00:00Z");
    expect(latestDigestAt(now, "08:00", "Europe/Berlin").toISOString()).toBe("2026-03-30T06:00:00.000Z");
  });
});

describe.skipIf(!baseUrl)("notification e-mails", () => {
  let test: TestServices;
  const { organization, member, space } = spaceFixtures(() => test);

  beforeAll(async () => {
    test = await createTestServices(baseUrl ?? "");
    await test.pool.query("insert into instance (id, setup_completed_at) values (1, now())");
    await test.settings.set(instanceUrlSetting, {}, "instance", "https://wiki.example.org");
    await test.settings.set(smtpSetting, {}, "instance", {
      host: "smtp.example.org",
      port: 25,
      security: "none",
      username: null,
      from: "wiki@example.org",
      oauth2: null,
    });
  });

  beforeEach(async () => {
    await test.database.execute(
      sql`update notifications set email_status = 'skipped' where email_status in ('immediate', 'digest')`,
    );
    await deliverPendingMail(test.services, test.database);
    test.mail.sent.length = 0;
  });

  afterAll(async () => {
    await test?.close();
  });

  async function setup() {
    const org = await organization();
    const authorId = await member(org.id, "member", "Ada Author");
    const readerId = await member(org.id, "member", "Rita Reader");
    const otherId = await member(org.id, "member", "Otto Other");
    const created = await space(org.id, authorId, {
      grants: [
        { principalKind: "account", principalId: readerId, role: "reader" },
        { principalKind: "account", principalId: otherId, role: "reader" },
      ],
    });
    const page = await test.services.tree.create(accountPrincipal(authorId), created.id, {
      kind: "page",
      title: `Runbook ${randomUUID().slice(0, 6)}`,
      mode: "publish",
      placement: { parentId: null },
    });
    await test.services.documents.replace(accountPrincipal(authorId), page.id, doc(paragraph("Steps")));
    await test.services.versions.publish(accountPrincipal(authorId), page.id);
    return { org, authorId, readerId, otherId, space: created, page };
  }

  type Context = Awaited<ReturnType<typeof setup>>;

  async function mention(context: Context, recipients: string[]) {
    await test.database.transaction((tx) =>
      test.services.notifications.notify(tx, {
        type: "content.mentioned",
        recipients,
        organizationId: context.org.id,
        targetId: context.page.id,
        actor: accountPrincipal(context.authorId),
        params: {
          itemTitle: context.page.title,
          itemKind: "page",
          spaceKey: context.space.key,
          commentId: null,
        },
      }),
    );
  }

  async function comment(context: Context, recipients: string[], text = "Looks good") {
    const created = await test.services.comments.create(accountPrincipal(context.authorId), context.page.id, {
      body: doc(paragraph(text)),
    });
    await test.database.transaction((tx) =>
      test.services.notifications.notify(tx, {
        type: "comment.created",
        recipients,
        organizationId: context.org.id,
        targetId: context.page.id,
        actor: accountPrincipal(context.authorId),
        params: {
          itemTitle: context.page.title,
          itemKind: "page",
          spaceKey: context.space.key,
          commentId: created,
        },
      }),
    );
  }

  async function emailRows(recipientId: string) {
    const result = await test.database.execute<{ id: string; email_status: string | null; count: number }>(
      sql`select id, email_status, count from notifications where recipient_id = ${recipientId} order by created_at`,
    );
    return result.rows;
  }

  async function settle(recipientId: string, minutes = 31) {
    await test.database.execute(sql`
      update notifications set updated_at = updated_at - make_interval(mins => ${minutes}),
        created_at = created_at - make_interval(mins => ${minutes})
      where recipient_id = ${recipientId}`);
  }

  async function emailOf(accountId: string) {
    const result = await test.database.execute<{ email: string }>(
      sql`select email from accounts where id = ${accountId}`,
    );
    return result.rows[0]?.email ?? "";
  }

  async function sent(accountId: string) {
    await deliverPendingMail(test.services, test.database);
    const email = await emailOf(accountId);
    return test.mail.sent.filter((message) => message.to === email);
  }

  describe("immediately", () => {
    it("waits until the combining window has settled and sends one mail for a burst", async () => {
      const context = await setup();
      await mention(context, [context.readerId]);
      await mention(context, [context.readerId]);
      await mention(context, [context.readerId]);
      expect(await emailRows(context.readerId)).toMatchObject([{ email_status: "immediate", count: 3 }]);

      expect(await test.services.notificationMailer.sendDue()).toEqual({ immediate: 0, digests: 0 });
      expect(await sent(context.readerId)).toEqual([]);

      await settle(context.readerId);
      expect((await test.services.notificationMailer.sendDue()).immediate).toBe(1);
      const [mail, ...more] = await sent(context.readerId);
      expect(more).toEqual([]);
      const [row] = await emailRows(context.readerId);
      expect(row?.email_status).toBe("sent");
      expect(mail?.subject).toBe(`Ada Author mentioned you in ${context.page.title}`);
      expect(mail?.text).toContain(`https://wiki.example.org/notifications/${row?.id}`);
      expect(mail?.text).toContain("3 times");
      expect(mail?.html).toContain("https://wiki.example.org/settings/notifications");
      expect(mail?.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
      expect(mail?.headers?.["List-Unsubscribe"]).toMatch(
        new RegExp(
          `^<https://wiki\\.example\\.org/api/v1/notifications/unsubscribe/${context.readerId}\\.mentions\\.`,
        ),
      );

      expect((await test.services.notificationMailer.sendDue()).immediate).toBe(0);
      expect(await sent(context.readerId)).toHaveLength(1);
    });

    const inMinutes = (minutes: number) => new Date(Date.now() + minutes * 60_000 + 5_000);

    async function notifyOf(
      context: Context,
      type: string,
      params: Record<string, unknown>,
      recipient: string,
    ) {
      await test.database.transaction((tx) =>
        test.services.notifications.notify(tx, {
          type,
          recipients: [recipient],
          organizationId: context.org.id,
          targetId: context.page.id,
          actor: accountPrincipal(context.authorId),
          params: { itemTitle: context.page.title, itemKind: "page", spaceKey: context.space.key, ...params },
        }),
      );
    }

    it("sends mentions after two minutes as one mail, long before the combining window ends", async () => {
      const context = await setup();
      await mention(context, [context.readerId]);
      await mention(context, [context.readerId]);
      await mention(context, [context.readerId]);

      expect((await test.services.notificationMailer.sendDue(inMinutes(1))).immediate).toBe(0);
      expect(await sent(context.readerId)).toEqual([]);

      expect((await test.services.notificationMailer.sendDue(inMinutes(2))).immediate).toBe(1);
      const [mail, ...more] = await sent(context.readerId);
      expect(more).toEqual([]);
      expect(mail?.text).toContain("3 times");
      expect((await emailRows(context.readerId)).map((row) => row.email_status)).toEqual(["sent"]);
    });

    it("sends assigned tasks and shares after two minutes", async () => {
      const context = await setup();
      await notifyOf(
        context,
        "task.assigned",
        { taskId: randomUUID(), taskText: "Check the steps", dueDate: null },
        context.readerId,
      );
      await notifyOf(context, "page.shared", { role: "reader", includeDescendants: false }, context.otherId);
      expect((await test.services.notificationMailer.sendDue(inMinutes(1))).immediate).toBe(0);
      expect((await test.services.notificationMailer.sendDue(inMinutes(2))).immediate).toBe(2);
      expect(await sent(context.readerId)).toHaveLength(1);
      expect(await sent(context.otherId)).toHaveLength(1);
    });

    it("covers exactly the mentions, tasks, shares and access requests", () => {
      expect(
        notificationEvents
          .filter((event) => event.keptWhenMuted)
          .flatMap((event) => [...event.types])
          .sort(),
      ).toEqual([
        "access.requestDecided",
        "access.requested",
        "content.mentioned",
        "page.shared",
        "task.assigned",
      ]);
    });

    it("keeps comments and changes waiting for the combining window", async () => {
      const context = await setup();
      await test.settings.set(
        settingsOf("comments").email,
        { user: context.readerId },
        "user",
        "immediately",
      );
      await comment(context, [context.readerId]);
      expect((await test.services.notificationMailer.sendDue(inMinutes(5))).immediate).toBe(0);
      expect((await emailRows(context.readerId)).map((row) => row.email_status)).toEqual(["immediate"]);
      expect((await test.services.notificationMailer.sendDue(inMinutes(31))).immediate).toBe(1);
      expect(await sent(context.readerId)).toHaveLength(1);
    });

    it("sends an action mail once with two nodes at the two-minute mark", async () => {
      const context = await setup();
      await mention(context, [context.readerId, context.otherId]);
      const second = test.anotherNode();
      const due = inMinutes(2);
      const results = await Promise.all([
        test.services.notificationMailer.sendDue(due),
        second.notificationMailer.sendDue(due),
      ]);
      expect(results.reduce((sum, result) => sum + result.immediate, 0)).toBe(2);
      expect((await test.services.notificationMailer.sendDue(inMinutes(3))).immediate).toBe(0);
      expect(await sent(context.readerId)).toHaveLength(1);
      expect(await sent(context.otherId)).toHaveLength(1);
    });

    it("sends after 24 hours even while events keep coming", async () => {
      const context = await setup();
      await mention(context, [context.readerId]);
      await test.database.execute(sql`
        update notifications set created_at = now() - interval '25 hours' where recipient_id = ${context.readerId}`);
      expect((await test.services.notificationMailer.sendDue()).immediate).toBe(1);
    });

    it("writes the mail in the person's language", async () => {
      const context = await setup();
      await test.settings.set(languageSetting, { user: context.readerId }, "user", "de");
      await mention(context, [context.readerId]);
      await settle(context.readerId);
      await test.services.notificationMailer.sendDue();
      const [mail] = await sent(context.readerId);
      expect(mail?.subject).toBe(`Ada Author hat dich in ${context.page.title} erwähnt`);
      expect(mail?.text).toContain("Gesendet von");
    });

    it("checks access when the mail is built and leaves out what the person can no longer read", async () => {
      const context = await setup();
      await test.settings.set(
        settingsOf("comments").email,
        { user: context.readerId },
        "user",
        "immediately",
      );
      await comment(context, [context.readerId], "Secret remark");
      await mention(context, [context.readerId]);
      await test.services.pageAccess.change(accountPrincipal(context.authorId), context.page.id, [
        { action: "restrict", kind: "view" },
      ]);
      await settle(context.readerId);
      await test.services.notificationMailer.sendDue();
      expect(await sent(context.readerId)).toEqual([]);
      expect((await emailRows(context.readerId)).map((row) => row.email_status)).toEqual([
        "skipped",
        "skipped",
      ]);
    });

    it("sends nothing to deactivated accounts, ended memberships, people without an address or what was read", async () => {
      const context = await setup();
      const deactivated = await member(context.org.id, "member", "Dee");
      const leaving = await member(context.org.id, "member", "Lee");
      const withoutAddress = await member(context.org.id, "member", "Noa");
      const grants = [deactivated, leaving, withoutAddress].map((principalId) => ({
        action: "share" as const,
        holderKind: "account" as const,
        holderId: principalId,
        role: "reader" as const,
      }));
      await test.services.pageAccess.change(accountPrincipal(context.authorId), context.page.id, grants);
      await mention(context, [context.readerId, deactivated, leaving, withoutAddress]);
      await test.database.execute(sql`update accounts set state = 'deactivated' where id = ${deactivated}`);
      await test.services.memberships.remove(SYSTEM, context.org.id, leaving, "removed", {
        releaseHome: true,
      });
      await test.database.execute(sql`update accounts set email = null where id = ${withoutAddress}`);
      const [read] = (await test.services.notifications.list(context.readerId, { limit: 5 })).items;
      await test.services.notifications.markRead(context.readerId, read?.id ?? "");
      for (const id of [context.readerId, deactivated, leaving, withoutAddress]) await settle(id);
      await test.services.notificationMailer.sendDue();
      await deliverPendingMail(test.services, test.database);
      expect(test.mail.sent).toEqual([]);
    });

    it("delivers by e-mail only when the app channel is off, without showing it in the app", async () => {
      const context = await setup();
      await test.settings.set(settingsOf("mentions").inApp, { user: context.readerId }, "user", false);
      await mention(context, [context.readerId]);
      expect((await test.services.notifications.unreadCount(context.readerId)).count).toBe(0);
      expect((await test.services.notifications.list(context.readerId, { limit: 5 })).items).toEqual([]);
      await settle(context.readerId);
      await test.services.notificationMailer.sendDue();
      expect(await sent(context.readerId)).toHaveLength(1);
    });

    it("never sends a mail twice with two nodes and after a restart", async () => {
      const context = await setup();
      const recipients = [context.readerId, context.otherId];
      for (let index = 0; index < 3; index += 1) await mention(context, recipients);
      for (const id of recipients) await settle(id);
      const second = test.anotherNode();
      const results = await Promise.all([
        test.services.notificationMailer.sendDue(),
        second.notificationMailer.sendDue(),
        second.notificationMailer.sendDue(),
      ]);
      expect(results.reduce((sum, result) => sum + result.immediate, 0)).toBe(2);
      expect((await test.anotherNode().notificationMailer.sendDue()).immediate).toBe(0);

      const outbox = await test.database.execute<{ id: string }>(
        sql`select id from mail_outbox where status = 'pending'`,
      );
      await Promise.all(
        outbox.rows.flatMap((row) => [
          test.services.mail.deliver(testJobContext("mail.deliver", { mailId: row.id })),
          second.mail.deliver(testJobContext("mail.deliver", { mailId: row.id })),
        ]),
      );
      expect(test.mail.sent).toHaveLength(2);
      expect(new Set(test.mail.sent.map((message) => message.messageId)).size).toBe(2);
    });

    it("hands a mail claimed by a node that stopped to the next run", async () => {
      const context = await setup();
      await mention(context, [context.readerId]);
      await settle(context.readerId);
      await test.services.notificationMailer.sendDue();
      await test.database.execute(sql`
        update mail_outbox set status = 'sending', updated_at = now() - interval '11 minutes' where status = 'pending'`);
      const outbox = await test.database.execute<{ id: string }>(
        sql`select id from mail_outbox where status = 'sending'`,
      );
      expect(await test.services.mail.dispatchPending()).toBeGreaterThanOrEqual(outbox.rows.length);
      for (const row of outbox.rows) {
        await test.services.mail.deliver(testJobContext("mail.deliver", { mailId: row.id }));
      }
      expect(await sent(context.readerId)).toHaveLength(1);
    });
  });

  describe("daily digest", () => {
    async function pendingSince(recipientId: string, since: string) {
      await test.database.execute(sql`
        update notifications set email_pending_since = ${since}::timestamptz,
          updated_at = ${since}::timestamptz, created_at = ${since}::timestamptz
        where recipient_id = ${recipientId}`);
    }

    it("sends one mail at the digest time of each person's time zone, grouped by space, newest first", async () => {
      const context = await setup();
      await test.settings.set(timeZoneSetting, { user: context.readerId }, "user", "Europe/Berlin");
      await test.settings.set(timeZoneSetting, { user: context.otherId }, "user", "America/New_York");
      await comment(context, [context.readerId, context.otherId], "First remark");
      const second = await test.services.tree.create(accountPrincipal(context.authorId), context.space.id, {
        kind: "page",
        title: "Second page",
        mode: "publish",
        placement: { parentId: null },
      });
      await test.services.versions.publish(accountPrincipal(context.authorId), second.id);
      await test.database.transaction((tx) =>
        test.services.notifications.notify(tx, {
          type: "comment.created",
          recipients: [context.readerId],
          organizationId: context.org.id,
          targetId: second.id,
          actor: accountPrincipal(context.authorId),
          params: {
            itemTitle: "Second page",
            itemKind: "page",
            spaceKey: context.space.key,
            commentId: randomUUID(),
          },
        }),
      );
      await pendingSince(context.readerId, "2026-03-01T14:00:00Z");
      await pendingSince(context.otherId, "2026-03-01T14:00:00Z");
      await test.database.execute(sql`
        update notifications set updated_at = '2026-03-01T15:00:00Z' where target_id = ${second.id}`);

      const mailer = test.services.notificationMailer;
      expect(await mailer.sendDue(new Date("2026-03-02T06:30:00Z"))).toEqual({ immediate: 0, digests: 0 });
      expect(await mailer.sendDue(new Date("2026-03-02T07:01:00Z"))).toEqual({ immediate: 0, digests: 1 });
      const [berlin, ...rest] = await sent(context.readerId);
      expect(rest).toEqual([]);
      expect(berlin?.subject).toBe("Your daily summary from Lunedo: 2 notifications");
      expect(berlin?.text).toContain(context.space.name);
      expect(berlin?.text.indexOf("Second page")).toBeLessThan(berlin?.text.indexOf(context.page.title) ?? 0);
      expect(berlin?.text).toContain("First remark");
      expect(berlin?.headers?.["List-Unsubscribe"]).toContain(`${context.readerId}.digest.`);
      expect(await sent(context.otherId)).toEqual([]);

      expect(await mailer.sendDue(new Date("2026-03-02T13:01:00Z"))).toEqual({ immediate: 0, digests: 1 });
      expect(await sent(context.otherId)).toHaveLength(1);
      expect(await mailer.sendDue(new Date("2026-03-03T13:01:00Z"))).toEqual({ immediate: 0, digests: 0 });
    });

    it("sends nothing when there is nothing new or nothing the person can still read", async () => {
      const context = await setup();
      const mailer = test.services.notificationMailer;
      expect(await mailer.sendDue(new Date("2026-03-02T07:01:00Z"))).toEqual({ immediate: 0, digests: 0 });
      await comment(context, [context.readerId]);
      await pendingSince(context.readerId, "2026-03-01T12:00:00Z");
      await test.services.pageAccess.change(accountPrincipal(context.authorId), context.page.id, [
        { action: "restrict", kind: "view" },
      ]);
      expect(await mailer.sendDue(new Date("2026-03-02T09:01:00Z"))).toEqual({ immediate: 0, digests: 0 });
      expect(await sent(context.readerId)).toEqual([]);
      expect((await emailRows(context.readerId)).map((row) => row.email_status)).toEqual(["skipped"]);
    });

    it("follows the digest time and the switch of the person", async () => {
      const context = await setup();
      await test.settings.set(digestTimeSetting, { user: context.readerId }, "user", "17:30");
      await test.settings.set(digestEnabledSetting, { user: context.otherId }, "user", false);
      await comment(context, [context.readerId, context.otherId]);
      await pendingSince(context.readerId, "2026-03-01T12:00:00Z");
      await pendingSince(context.otherId, "2026-03-01T12:00:00Z");
      const mailer = test.services.notificationMailer;
      expect((await mailer.sendDue(new Date("2026-03-01T17:29:00Z"))).digests).toBe(0);
      expect((await mailer.sendDue(new Date("2026-03-01T17:31:00Z"))).digests).toBe(1);
      expect(await sent(context.readerId)).toHaveLength(1);
      expect(await sent(context.otherId)).toEqual([]);
    });
  });

  describe("unsubscribe", () => {
    it("turns off e-mail for the event of the link and nothing else, without signing in", async () => {
      const context = await setup();
      const token = await test.services.unsubscribe.token(context.readerId, {
        kind: "event",
        event: "mentions",
      });
      expect(await test.services.unsubscribe.describe(token)).toEqual({
        scope: { kind: "event", event: "mentions" },
        off: false,
      });
      expect(await test.services.unsubscribe.apply(token)).toMatchObject({
        applied: true,
        state: { off: true },
      });
      expect(await test.settings.get(settingsOf("mentions").email, { user: context.readerId })).toBe("off");
      expect(await test.settings.get(settingsOf("tasks").email, { user: context.readerId })).toBe(
        "immediately",
      );
      expect(await test.settings.get(settingsOf("mentions").email, { user: context.otherId })).toBe(
        "immediately",
      );
      expect(await test.settings.get(settingsOf("mentions").inApp, { user: context.readerId })).toBe(true);
    });

    it("turns off the digest from a digest link", async () => {
      const context = await setup();
      const token = await test.services.unsubscribe.token(context.readerId, { kind: "digest" });
      await test.services.unsubscribe.apply(token);
      expect(await test.settings.get(digestEnabledSetting, { user: context.readerId })).toBe(false);
      expect(await test.settings.get(settingsOf("comments").email, { user: context.readerId })).toBe(
        "digest",
      );
    });

    it("refuses tampered links and links moved to another person", async () => {
      const context = await setup();
      const token = await test.services.unsubscribe.token(context.readerId, {
        kind: "event",
        event: "mentions",
      });
      const [, event, mac] = token.split(".");
      const forged = [
        `${context.otherId}.${event}.${mac}`,
        `${context.readerId}.tasks.${mac}`,
        `${context.readerId}.${event}.${mac?.slice(0, -2)}AA`,
        `${context.readerId}.unknown.${mac}`,
        "not-a-token",
      ];
      for (const candidate of forged) {
        expect(await test.services.unsubscribe.describe(candidate)).toBeNull();
        expect(await test.services.unsubscribe.apply(candidate)).toBeNull();
      }
      expect(await test.settings.get(settingsOf("mentions").email, { user: context.otherId })).toBe(
        "immediately",
      );
      expect(await test.settings.get(settingsOf("tasks").email, { user: context.readerId })).toBe(
        "immediately",
      );
    });

    it("reports a value the organization has locked instead of changing it", async () => {
      const context = await setup();
      await test.settings.set(
        settingsOf("tasks").email,
        { organization: context.org.id },
        "organization",
        "immediately",
      );
      await test.settings.lock(settingsOf("tasks").email, { organization: context.org.id }, "organization");
      await test.database.execute(
        sql`update accounts set home_organization_id = ${context.org.id} where id = ${context.readerId}`,
      );
      const token = await test.services.unsubscribe.token(context.readerId, {
        kind: "event",
        event: "tasks",
      });
      expect(await test.services.unsubscribe.apply(token)).toEqual({ applied: false, reason: "locked" });
    });
  });
});
