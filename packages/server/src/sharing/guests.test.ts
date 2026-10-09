import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { instanceUrlSetting } from "../accounts/instance-settings.js";
import { accountPrincipal, SYSTEM } from "../accounts/principal.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { deliverPendingMail } from "../testing/jobs.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { spaceFixtures } from "../testing/spaces.js";
import { membersInviteGuestsSetting } from "./settings.js";

const baseUrl = testDatabaseBaseUrl();

describe.skipIf(!baseUrl)("inviting guests to a page", () => {
  let test: TestServices;
  const { organization, member, space } = spaceFixtures(() => test);

  beforeAll(async () => {
    test = await createTestServices(baseUrl ?? "");
    await test.pool.query("insert into instance (id, setup_completed_at) values (1, now())");
    await test.settings.set(instanceUrlSetting, {}, "instance", "https://wiki.example.org");
    await test.pool.query(
      "insert into setting_values (id, level, scope_id, key, value) values (gen_random_uuid(), 'instance', '00000000-0000-0000-0000-000000000000', 'mail.smtp', $1)",
      [
        JSON.stringify({
          host: "smtp.example.org",
          port: 25,
          security: "none",
          username: null,
          from: "wiki@example.org",
        }),
      ],
    );
  });

  afterAll(async () => {
    await test?.close();
  });

  async function setup() {
    const org = await organization();
    const editorId = await member(org.id, "member", "Editor");
    const created = await space(org.id, editorId);
    const editor = accountPrincipal(editorId);
    const page = await test.services.tree.create(editor, created.id, {
      kind: "page",
      title: "Contract draft",
      mode: "live",
      placement: { parentId: null },
    });
    return { org, editorId, editor, space: created, page };
  }

  async function accept(email: string) {
    await deliverPendingMail(test.services, test.database);
    const mail = test.mail.sent.filter((entry) => entry.to.toLowerCase() === email.toLowerCase()).at(-1);
    const token = /#token=([\w-]{43})/.exec(mail?.text ?? "")?.[1] ?? "";
    return test.services.invitations.accept(
      token,
      { name: "Guest", password: "a long guest passphrase" },
      "203.0.113.9",
    );
  }

  it("is refused while the organization does not allow it", async () => {
    const context = await setup();
    await expect(
      test.services.guestShares.invite(context.editor, context.page.id, {
        email: `${randomUUID()}@guest.example.net`,
        role: "reader",
        includeDescendants: false,
      }),
    ).rejects.toMatchObject({ code: "guestInvitesDisabled" });
  });

  it("shares the page with the guest on acceptance and audits the invitation", async () => {
    const context = await setup();
    await test.settings.set(
      membersInviteGuestsSetting,
      { organization: context.org.id },
      "organization",
      true,
    );
    const email = `${randomUUID()}@guest.example.net`;
    await test.services.guestShares.invite(context.editor, context.page.id, {
      email,
      role: "commenter",
      includeDescendants: false,
    });
    const accepted = await accept(email);
    const guest = accountPrincipal(accepted.accountId);
    expect(
      (
        await test.services.authorization.explain(guest, "item.comment", {
          type: "item",
          id: context.page.id,
        })
      ).allowed,
    ).toBe(true);
    expect(
      (
        await test.services.authorization.explain(guest, "space.view", {
          type: "space",
          id: context.space.id,
        })
      ).allowed,
    ).toBe(false);
    const audit = await test.pool.query<{ name: string }>(
      "select name from audit_events where target_id = $1",
      [context.page.id],
    );
    expect(audit.rows.map((row) => row.name)).toEqual(
      expect.arrayContaining(["page.guestInvited", "page.shared"]),
    );
  });

  it("holds the share as an access request when the sharer lost the right to share", async () => {
    const context = await setup();
    await test.settings.set(
      membersInviteGuestsSetting,
      { organization: context.org.id },
      "organization",
      true,
    );
    const email = `${randomUUID()}@guest.example.net`;
    await test.services.guestShares.invite(context.editor, context.page.id, {
      email,
      role: "reader",
      includeDescendants: false,
    });
    const permissions = await test.services.spacePermissions.list(context.space.id);
    const admin = await member(context.org.id);
    await test.services.spacePermissions.apply(SYSTEM, context.space.id, {
      action: "grant",
      principalKind: "account",
      principalId: admin,
      role: "admin",
    });
    for (const permission of permissions.filter((entry) => entry.principalId === context.editorId)) {
      await test.services.spacePermissions.apply(SYSTEM, context.space.id, {
        action: "change",
        permissionId: permission.id,
        role: "reader",
      });
    }
    const accepted = await accept(email);
    const guest = accountPrincipal(accepted.accountId);
    expect(
      (await test.services.authorization.explain(guest, "item.view", { type: "item", id: context.page.id }))
        .allowed,
    ).toBe(false);
    const requests = await test.services.accessRequests.forSpace(accountPrincipal(admin), context.space.id);
    expect(requests.map((request) => [request.requester.id, request.itemId])).toEqual([
      [accepted.accountId, context.page.id],
    ]);
  });
});
