import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accountPrincipal } from "../accounts/principal.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { spaceFixtures } from "../testing/spaces.js";

const baseUrl = testDatabaseBaseUrl();

describe.skipIf(!baseUrl)("notification filters", () => {
  let test: TestServices;
  const { organization, member, space } = spaceFixtures(() => test);

  beforeAll(async () => {
    test = await createTestServices(baseUrl ?? "");
    await test.pool.query("insert into instance (id, setup_completed_at) values (1, now())");
  });

  afterAll(async () => {
    await test?.close();
  });

  it("list one kind or one space and keep hiding what the recipient cannot see", async () => {
    const org = await organization();
    const ownerId = await member(org.id, "member", "Owner");
    const readerId = await member(org.id, "member", "Reader");
    const owner = accountPrincipal(ownerId);
    const grants = [{ principalKind: "account" as const, principalId: readerId, role: "reader" as const }];
    const first = await space(org.id, ownerId, { grants });
    const second = await space(org.id, ownerId, { grants });
    const hidden = await space(org.id, ownerId);
    const page = async (spaceId: string, title: string) =>
      test.services.tree.create(owner, spaceId, {
        kind: "page",
        title,
        mode: "live",
        placement: { parentId: null },
      });
    const mentioned = async (spaceId: string, key: string, title: string) => {
      const created = await page(spaceId, title);
      await test.database.transaction((tx) =>
        test.services.notifications.notify(tx, {
          type: "content.mentioned",
          recipients: [readerId],
          organizationId: org.id,
          targetId: created.id,
          actor: owner,
          params: { itemTitle: title, itemKind: "page", spaceKey: key, commentId: null },
        }),
      );
    };
    await mentioned(first.id, first.key, "First");
    await mentioned(second.id, second.key, "Second");
    await mentioned(hidden.id, hidden.key, "Hidden");
    await test.database.transaction((tx) =>
      test.services.notifications.notify(tx, {
        type: "guest.expiring",
        recipients: [readerId],
        organizationId: org.id,
        targetId: randomUUID(),
        params: { organizationName: "Org", guestName: "Gina", expiresAt: "2030-10-20T10:00:00.000Z" },
      }),
    );
    const titles = async (filter: { kind?: "mentions" | "watched" | "requests"; spaceId?: string }) =>
      (await test.services.notifications.list(readerId, { limit: 20, ...filter })).items.map(
        (item) => (item.params as { itemTitle?: string }).itemTitle,
      );
    expect(await titles({ kind: "mentions" })).toEqual(["Second", "First"]);
    expect(await titles({ spaceId: first.id })).toEqual(["First"]);
    expect(await titles({ spaceId: hidden.id })).toEqual([]);
    expect(await titles({ kind: "requests" })).toEqual([]);
    expect(await titles({ kind: "watched", spaceId: first.id })).toEqual([]);
  });
});
