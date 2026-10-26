import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accountPrincipal, SYSTEM } from "../accounts/principal.js";
import { ForbiddenError } from "../authorization/service.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { spaceFixtures } from "../testing/spaces.js";
import { SpaceError } from "./common.js";

const baseUrl = testDatabaseBaseUrl();

describe.skipIf(!baseUrl)("ownership of content", () => {
  let test: TestServices;
  const { organization, member } = spaceFixtures(() => test);

  beforeAll(async () => {
    test = await createTestServices(baseUrl ?? "");
    await test.pool.query("insert into instance (id, setup_completed_at) values (1, now())");
  });

  afterAll(async () => {
    await test?.close();
  });

  async function setup(options: { confidential?: boolean } = {}) {
    const org = await organization();
    const authorId = await member(org.id, "member", "Author");
    const editorId = await member(org.id, "member", "Editor");
    const readerId = await member(org.id, "member", "Reader");
    const adminId = await member(org.id, "member", "Space admin");
    const services = test.services;
    const created = await services.spaces.create(
      accountPrincipal(adminId),
      org.id,
      {
        name: `Space ${Math.random().toString(36).slice(2, 8)}`,
        key: `O${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
        visibility: "private",
        confidential: options.confidential === true,
        grants: [
          { principalKind: "account", principalId: authorId, role: "editor" },
          { principalKind: "account", principalId: editorId, role: "editor" },
          { principalKind: "account", principalId: readerId, role: "reader" },
        ],
      },
      services.spacePermissions.holders,
    );
    const author = accountPrincipal(authorId);
    const page = await services.tree.create(author, created.id, {
      kind: "page",
      title: "Restart the VPN gateway",
      mode: "live",
      placement: { parentId: null },
    });
    return {
      org,
      space: created,
      page,
      authorId,
      editorId,
      readerId,
      adminId,
      author,
      editor: accountPrincipal(editorId),
      reader: accountPrincipal(readerId),
      admin: accountPrincipal(adminId),
      orgAdmin: accountPrincipal(org.owner),
    };
  }

  async function ownerOf(itemId: string): Promise<string | null> {
    const result = await test.database.execute<{ owner_id: string | null }>(
      sql`select owner_id from tree_items where id = ${itemId}`,
    );
    return result.rows[0]?.owner_id ?? null;
  }

  it("makes the creator the owner and lets the owner hand the item to an editor", async () => {
    const context = await setup();
    expect(context.page.ownerId).toBe(context.authorId);
    const details = await test.services.tree.details(context.author, context.page.id);
    expect(details?.owner).toMatchObject({ id: context.authorId, name: "Author", active: true });
    expect(details?.ownershipTransferable).toBe(true);

    await test.services.ownership.transfer(context.author, context.page.id, context.editorId);

    expect(await ownerOf(context.page.id)).toBe(context.editorId);
    const audit = await test.database.execute<{ fields: Record<string, unknown> }>(sql`
      select fields from audit_events where name = 'page.ownerTransferred' and target_id = ${context.page.id}`);
    expect(audit.rows[0]?.fields).toMatchObject({
      previousOwnerId: context.authorId,
      ownerId: context.editorId,
    });
    const history = await test.services.ownership.history(context.admin, context.page.id);
    expect(history[0]).toMatchObject({
      previousOwner: { id: context.authorId },
      owner: { id: context.editorId },
      actor: { id: context.authorId },
    });
  });

  it("never hands an item to someone without edit access", async () => {
    const context = await setup();
    await expect(
      test.services.ownership.transfer(context.author, context.page.id, context.readerId),
    ).rejects.toMatchObject({ code: "ownerNeedsEditAccess" });
    const outsider = await member(context.org.id, "member", "Outsider");
    await expect(
      test.services.ownership.transfer(context.author, context.page.id, outsider),
    ).rejects.toMatchObject({ code: "ownerNeedsEditAccess" });
    expect(await ownerOf(context.page.id)).toBe(context.authorId);

    const candidates = await test.services.ownership.candidates(context.author, context.page.id, "");
    const ids = candidates.map((candidate) => candidate.id);
    expect(ids).toContain(context.editorId);
    expect(ids).toContain(context.adminId);
    expect(ids).not.toContain(context.readerId);
    expect(ids).not.toContain(context.authorId);
    expect(ids).not.toContain(outsider);
  });

  it("checks the edit restriction of the item for the new owner", async () => {
    const context = await setup();
    await test.services.pageAccess.change(context.author, context.page.id, [
      { action: "restrict", kind: "edit" },
    ]);
    const candidates = await test.services.ownership.candidates(context.author, context.page.id, "");
    expect(candidates.map((candidate) => candidate.id)).not.toContain(context.editorId);
    await expect(
      test.services.ownership.transfer(context.author, context.page.id, context.editorId),
    ).rejects.toMatchObject({ code: "ownerNeedsEditAccess" });
  });

  it("lets only the owner, space admins and organization admins who read the space transfer", async () => {
    const context = await setup();
    await expect(
      test.services.ownership.transfer(context.editor, context.page.id, context.adminId),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(await test.services.ownership.canTransfer(context.editor, context.page.id)).toBe(false);

    await test.services.ownership.transfer(context.admin, context.page.id, context.editorId);
    expect(await ownerOf(context.page.id)).toBe(context.editorId);

    await expect(
      test.services.ownership.transfer(context.orgAdmin, context.page.id, context.authorId),
    ).rejects.toBeInstanceOf(SpaceError);
    await test.services.spacePermissions.apply(context.admin, context.space.id, {
      action: "grant",
      principalKind: "account",
      principalId: context.org.owner,
      role: "reader",
    });
    await test.services.ownership.transfer(context.orgAdmin, context.page.id, context.authorId);
    expect(await ownerOf(context.page.id)).toBe(context.authorId);
  });

  it("keeps organization admins out of confidential spaces", async () => {
    const context = await setup({ confidential: true });
    await test.services.spacePermissions.apply(context.admin, context.space.id, {
      action: "grant",
      principalKind: "account",
      principalId: context.org.owner,
      role: "reader",
    });
    await expect(
      test.services.ownership.transfer(context.orgAdmin, context.page.id, context.editorId),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const listed = await test.services.ownership.organizationUnowned(context.orgAdmin, context.org.id);
    expect(listed.items.map((item) => item.id)).not.toContain(context.page.id);

    await test.services.ownership.transfer(context.admin, context.page.id, context.editorId);
    expect(await ownerOf(context.page.id)).toBe(context.editorId);
  });

  it("treats a restricted item the actor cannot open as unknown", async () => {
    const context = await setup();
    await test.services.pageAccess.change(context.author, context.page.id, [
      { action: "restrict", kind: "view" },
    ]);
    await expect(
      test.services.ownership.transfer(context.admin, context.page.id, context.authorId),
    ).rejects.toMatchObject({ code: "itemNotFound" });
    await expect(
      test.services.ownership.candidates(context.admin, context.page.id, ""),
    ).rejects.toMatchObject({
      code: "itemNotFound",
    });
  });

  it("keeps the owner of archived items", async () => {
    const context = await setup();
    await test.services.archive.archive(context.author, context.page.id);
    await expect(
      test.services.ownership.transfer(context.author, context.page.id, context.editorId),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("lists items of a deactivated owner, notifies space admins once and restores a returning owner", async () => {
    const context = await setup();
    const second = await test.services.tree.create(context.author, context.space.id, {
      kind: "folder",
      title: "Runbooks",
      placement: { parentId: null },
    });
    const restricted = await test.services.tree.create(context.author, context.space.id, {
      kind: "page",
      title: "Salaries",
      mode: "live",
      placement: { parentId: null },
    });
    await test.services.pageAccess.change(context.author, restricted.id, [
      { action: "restrict", kind: "view" },
    ]);

    await test.services.memberships.deactivate(SYSTEM, context.authorId);

    const notifications = await test.services.notifications.list(context.adminId, { limit: 20 });
    const orphaned = notifications.items.filter((item) => item.type === "ownership.orphaned");
    expect(orphaned).toHaveLength(1);
    expect(orphaned[0]?.params).toMatchObject({ spaceId: context.space.id, items: 3 });
    const editorNotifications = await test.services.notifications.list(context.editorId, { limit: 20 });
    expect(editorNotifications.items.map((item) => item.type)).not.toContain("ownership.orphaned");

    const listed = await test.services.ownership.spaceUnowned(context.admin, context.space.id);
    expect(listed.items.map((item) => item.id).sort()).toEqual([context.page.id, second.id].sort());
    expect(listed.items[0]).toMatchObject({ formerOwner: { id: context.authorId }, reason: "deactivated" });
    expect(listed.hidden).toBe(1);
    expect(JSON.stringify(listed)).not.toContain("Salaries");

    const organizationList = await test.services.ownership.organizationUnowned(
      context.orgAdmin,
      context.org.id,
    );
    expect(organizationList.items).toHaveLength(0);
    expect(organizationList.hidden).toBe(3);

    await test.services.ownership.transfer(context.admin, context.page.id, context.editorId);
    const after = await test.services.ownership.spaceUnowned(context.admin, context.space.id);
    expect(after.items.map((item) => item.id)).toEqual([second.id]);

    await test.services.administration.reactivate(SYSTEM, context.authorId);
    expect(await ownerOf(context.page.id)).toBe(context.editorId);
    expect(await ownerOf(second.id)).toBe(context.authorId);
    const returned = await test.services.ownership.spaceUnowned(context.admin, context.space.id);
    expect(returned.items).toHaveLength(0);
    expect(returned.hidden).toBe(0);
  });

  it("lists items whose owner left the organization and brings them back when the person returns", async () => {
    const context = await setup();
    await test.services.memberships.remove(SYSTEM, context.org.id, context.authorId, "removed", {
      releaseHome: true,
    });

    const listed = await test.services.ownership.spaceUnowned(context.admin, context.space.id);
    expect(listed.items).toEqual([
      expect.objectContaining({
        id: context.page.id,
        number: context.page.number,
        reason: "membershipEnded",
      }),
    ]);
    const details = await test.services.tree.details(context.admin, context.page.id);
    expect(details?.owner?.active).toBe(false);
    const notifications = await test.services.notifications.list(context.adminId, { limit: 20 });
    expect(notifications.items.map((item) => item.type)).toContain("ownership.orphaned");

    await test.database.transaction((tx) =>
      test.services.memberships.add(tx, SYSTEM, {
        organizationId: context.org.id,
        accountId: context.authorId,
        kind: "member",
      }),
    );
    expect((await test.services.ownership.spaceUnowned(context.admin, context.space.id)).items).toHaveLength(
      0,
    );
  });

  it("does not notify about items in the trash", async () => {
    const context = await setup();
    await test.services.trash.deleteItem(context.author, context.page.id);
    await test.services.memberships.deactivate(SYSTEM, context.authorId);
    const notifications = await test.services.notifications.list(context.adminId, { limit: 20 });
    expect(notifications.items.map((item) => item.type)).not.toContain("ownership.orphaned");
  });
});
