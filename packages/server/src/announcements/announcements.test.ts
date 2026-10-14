import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accountPrincipal, SYSTEM } from "../accounts/principal.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { spaceFixtures } from "../testing/spaces.js";
import {
  type AnnouncementInput,
  AnnouncementService,
  parseAnnouncementChangeSignal,
} from "./announcements.js";

const baseUrl = testDatabaseBaseUrl();
const DAY = 86_400_000;

describe("announcement change signals", () => {
  it("accepts only well-formed signals", () => {
    expect(parseAnnouncementChangeSignal('{"scope":"instance","organizationId":null}')).toEqual({
      scope: "instance",
      organizationId: null,
    });
    const id = "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a01";
    expect(
      parseAnnouncementChangeSignal(JSON.stringify({ scope: "organization", organizationId: id })),
    ).toEqual({
      scope: "organization",
      organizationId: id,
    });
    expect(parseAnnouncementChangeSignal('{"scope":"organization","organizationId":null}')).toBeNull();
    expect(parseAnnouncementChangeSignal('{"scope":"instance","organizationId":"x"}')).toBeNull();
    expect(parseAnnouncementChangeSignal("not json")).toBeNull();
  });
});

describe.skipIf(!baseUrl)("announcements", () => {
  let test: TestServices;
  const { organization, member } = spaceFixtures(() => test);
  let now = new Date();

  beforeAll(async () => {
    test = await createTestServices(baseUrl ?? "");
    await test.pool.query("insert into instance (id, setup_completed_at) values (1, now())");
  });

  afterAll(async () => {
    await test?.close();
  });

  function service() {
    return new AnnouncementService({
      database: test.database,
      authorization: test.services.authorization,
      audit: test.services.audit,
      people: test.services.people,
      clock: () => now,
    });
  }

  function banner(overrides: Partial<AnnouncementInput> = {}): AnnouncementInput {
    return {
      severity: "information",
      text: "New: search in attachments.",
      link: { url: "https://wiki.example.org/spaces/ENG/blog", label: "Read the post" },
      startsAt: null,
      endsAt: new Date(now.getTime() + DAY),
      ...overrides,
    };
  }

  async function setup() {
    now = new Date();
    await test.database.execute(sql`delete from announcements`);
    const org = await organization();
    const other = await organization();
    const memberId = await member(org.id, "member", "Member");
    const guestId = await member(org.id, "guest", "Guest");
    const outsiderId = await member(other.id, "member", "Outsider");
    return {
      org,
      other,
      member: accountPrincipal(memberId),
      memberId,
      guest: accountPrincipal(guestId),
      outsider: accountPrincipal(outsiderId),
      admin: accountPrincipal(org.owner),
    };
  }

  it("shows the instance banner above the banner of the person's own organization only", async () => {
    const context = await setup();
    const announcements = service();
    await announcements.set(context.admin, context.org.id, banner({ text: "Organization news" }));
    await announcements.set(
      context.admin,
      null,
      banner({ severity: "warning", text: "Maintenance tonight" }),
    );
    await announcements.set(context.admin, context.other.id, banner({ text: "Other organization" }));

    const shown = await announcements.shown(context.member);
    expect(shown.map((entry) => [entry.scope, entry.text])).toEqual([
      ["instance", "Maintenance tonight"],
      ["organization", "Organization news"],
    ]);
    expect((await announcements.shown(context.guest)).map((entry) => entry.text)).toEqual([
      "Maintenance tonight",
      "Organization news",
    ]);
    expect((await announcements.shown(context.outsider)).map((entry) => entry.text)).toEqual([
      "Maintenance tonight",
      "Other organization",
    ]);
  });

  it("stops showing an organization banner when the membership ends", async () => {
    const context = await setup();
    const announcements = service();
    await announcements.set(context.admin, context.org.id, banner());
    await test.services.memberships.remove(SYSTEM, context.org.id, context.memberId, "removed", {
      releaseHome: true,
    });
    expect(await announcements.shown(context.member)).toEqual([]);
  });

  it("includes banners that start later and drops them at their end", async () => {
    const context = await setup();
    const announcements = service();
    const startsAt = new Date(now.getTime() + DAY);
    const endsAt = new Date(now.getTime() + 2 * DAY);
    await announcements.set(context.admin, context.org.id, banner({ startsAt, endsAt }));
    expect((await announcements.shown(context.member))[0]).toMatchObject({ startsAt, endsAt });
    now = new Date(endsAt.getTime() + 1);
    expect(await announcements.shown(context.member)).toEqual([]);
  });

  it("lets people dismiss information until it changes, but never a warning", async () => {
    const context = await setup();
    const announcements = service();
    const information = await announcements.set(context.admin, context.org.id, banner());
    await announcements.dismiss(context.member, information.id, information.version);
    expect((await announcements.shown(context.member))[0]?.dismissed).toBe(true);
    expect((await announcements.shown(context.guest))[0]?.dismissed).toBe(false);

    const changed = await announcements.set(context.admin, context.org.id, banner({ text: "Changed text" }));
    expect(changed.id).toBe(information.id);
    expect(changed.version).not.toBe(information.version);
    expect((await announcements.shown(context.member))[0]?.dismissed).toBe(false);
    await expect(
      announcements.dismiss(context.member, changed.id, information.version),
    ).rejects.toMatchObject({
      code: "announcementChanged",
    });

    const warning = await announcements.set(context.admin, null, banner({ severity: "warning" }));
    await expect(announcements.dismiss(context.member, warning.id, warning.version)).rejects.toMatchObject({
      code: "announcementNotDismissible",
    });
  });

  it("does not let people dismiss banners they are not shown", async () => {
    const context = await setup();
    const announcements = service();
    const information = await announcements.set(context.admin, context.org.id, banner());
    await expect(
      announcements.dismiss(context.outsider, information.id, information.version),
    ).rejects.toMatchObject({ code: "notFound" });
  });

  it("validates text, link and period", async () => {
    const context = await setup();
    const announcements = service();
    await expect(
      announcements.set(context.admin, context.org.id, banner({ text: "  " })),
    ).rejects.toMatchObject({
      code: "invalidAnnouncement",
    });
    for (const url of ["javascript:alert(1)", "/relative", "ftp://files.example.org"]) {
      await expect(
        announcements.set(context.admin, context.org.id, banner({ link: { url, label: "Open" } })),
      ).rejects.toMatchObject({ code: "invalidAnnouncement" });
    }
    await expect(
      announcements.set(context.admin, context.org.id, banner({ endsAt: new Date(now.getTime() - 1) })),
    ).rejects.toMatchObject({ code: "invalidAnnouncement" });
    await expect(
      announcements.set(
        context.admin,
        context.org.id,
        banner({ startsAt: new Date(now.getTime() + 2 * DAY), endsAt: new Date(now.getTime() + DAY) }),
      ),
    ).rejects.toMatchObject({ code: "invalidAnnouncement" });
  });

  it("records every change and removal in the audit log and signals open sessions", async () => {
    const context = await setup();
    const announcements = service();
    const listened: string[] = [];
    const client = await test.pool.connect();
    try {
      await client.query("listen pagehall_announcement_changes");
      client.on("notification", (message) => listened.push(message.payload ?? ""));
      const saved = await announcements.set(context.admin, context.org.id, banner());
      expect(await announcements.remove(context.admin, context.org.id)).toBe(true);
      expect(await announcements.remove(context.admin, context.org.id)).toBe(false);
      const events = await test.database.execute<{ name: string; fields: Record<string, unknown> }>(sql`
        select name, fields from audit_events where target_id = ${saved.id} order by occurred_at`);
      expect(events.rows.map((row) => row.name)).toEqual(["announcement.changed", "announcement.removed"]);
      expect(events.rows[0]?.fields).toMatchObject({
        level: "organization",
        replaced: false,
        severity: "information",
        text: "New: search in attachments.",
        linkUrl: "https://wiki.example.org/spaces/ENG/blog",
      });
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(listened).toEqual([
        JSON.stringify({ scope: "organization", organizationId: context.org.id }),
        JSON.stringify({ scope: "organization", organizationId: context.org.id }),
      ]);
    } finally {
      await client.query("unlisten pagehall_announcement_changes");
      client.release();
    }
  });
});
