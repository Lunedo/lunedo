import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accountPrincipal, type Principal, SYSTEM } from "../accounts/principal.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { spaceFixtures } from "../testing/spaces.js";
import { ANNOUNCEMENT_BATCH } from "./blog-subscriptions.js";

const baseUrl = testDatabaseBaseUrl();

describe.skipIf(!baseUrl)("blog subscriptions", () => {
  let test: TestServices;
  const { organization, member, space } = spaceFixtures(() => test);

  beforeAll(async () => {
    test = await createTestServices(baseUrl ?? "");
    await test.pool.query("insert into instance (id, setup_completed_at) values (1, now())");
  });

  afterAll(async () => {
    await test?.close();
  });

  async function setup() {
    const org = await organization();
    const authorId = await member(org.id, "member", "Author");
    const readerId = await member(org.id, "member", "Reader");
    const otherReaderId = await member(org.id, "member", "Other reader");
    const outsiderId = await member(org.id, "member", "Outsider");
    const created = await space(org.id, authorId, {
      grants: [
        { principalKind: "account", principalId: readerId, role: "reader" },
        { principalKind: "account", principalId: otherReaderId, role: "reader" },
      ],
    });
    return {
      org,
      space: created,
      authorId,
      readerId,
      otherReaderId,
      outsiderId,
      author: accountPrincipal(authorId),
      reader: accountPrincipal(readerId),
      otherReader: accountPrincipal(otherReaderId),
      outsider: accountPrincipal(outsiderId),
    };
  }

  type Context = Awaited<ReturnType<typeof setup>>;

  async function write(context: Context, title: string, author: Principal = context.author) {
    return test.services.blog.create(author, context.space.id, { title });
  }

  async function publish(context: Context, title: string) {
    const post = await write(context, title);
    await test.services.versions.publish(context.author, post.id);
    return post;
  }

  async function permissionOf(context: Context, accountId: string): Promise<string> {
    const result = await test.database.execute<{ id: string }>(sql`
      select id from space_permissions where space_id = ${context.space.id} and principal_id = ${accountId}`);
    const id = result.rows[0]?.id;
    if (!id) throw new Error("The person holds no permission in the space");
    return id;
  }

  async function received(accountId: string, itemId?: string) {
    const result = await test.database.execute<{ target_id: string; params: Record<string, unknown> }>(sql`
      select target_id, params from notifications
      where recipient_id = ${accountId} and type = 'blogPost.published'
        ${itemId ? sql`and target_id = ${itemId}` : sql``}`);
    return result.rows;
  }

  it("notifies followers once when a post is published, but not its author or others", async () => {
    const context = await setup();
    await test.services.blogSubscriptions.follow(context.reader, context.space.id);
    await test.services.blogSubscriptions.follow(context.author, context.space.id);
    const post = await write(context, "WireGuard is here");
    await test.services.blogSubscriptions.deliverPending();
    expect(await received(context.readerId)).toEqual([]);

    await test.services.versions.publish(context.author, post.id);
    expect(await test.services.blogSubscriptions.deliverPending()).toBeGreaterThanOrEqual(1);
    expect(await received(context.readerId, post.id)).toEqual([
      {
        target_id: post.id,
        params: {
          itemTitle: "WireGuard is here",
          itemKind: "blogPost",
          spaceKey: context.space.key,
          spaceName: context.space.name,
        },
      },
    ]);
    expect(await received(context.authorId)).toEqual([]);
    expect(await received(context.otherReaderId)).toEqual([]);

    await test.services.versions.publish(context.author, post.id);
    await test.services.blogSubscriptions.deliverPending();
    expect(await received(context.readerId, post.id)).toHaveLength(1);
  });

  it("leaves out people who contributed to the published version", async () => {
    const context = await setup();
    await test.services.spacePermissions.apply(context.author, context.space.id, {
      action: "change",
      permissionId: await permissionOf(context, context.otherReaderId),
      role: "editor",
    });
    await test.services.blogSubscriptions.follow(context.otherReader, context.space.id);
    await test.services.blogSubscriptions.follow(context.reader, context.space.id);
    const post = await write(context, "Written together");
    await test.services.versions.publish(context.otherReader, post.id);
    await test.services.blogSubscriptions.deliverPending();
    expect(await received(context.otherReaderId)).toEqual([]);
    expect(await received(context.readerId, post.id)).toHaveLength(1);
  });

  it("notifies scheduled posts when they are published, not when they are scheduled", async () => {
    const context = await setup();
    await test.services.blogSubscriptions.follow(context.reader, context.space.id);
    const post = await write(context, "Scheduled news");
    await test.services.blog.schedule(context.author, post.id, {
      at: new Date(Date.now() + 3_600_000),
      timeZone: "Europe/Vienna",
    });
    await test.services.blogSubscriptions.deliverPending();
    expect(await received(context.readerId)).toEqual([]);

    await test.database.execute(
      sql`update blog_posts set scheduled_at = now() - interval '1 minute' where item_id = ${post.id}`,
    );
    await test.services.blog.publishDue();
    await test.services.blogSubscriptions.deliverPending();
    expect(await received(context.readerId, post.id)).toHaveLength(1);
  });

  it("sends nothing while the follower cannot read the space and resumes when access returns", async () => {
    const context = await setup();
    await test.services.blogSubscriptions.follow(context.reader, context.space.id);
    await test.services.spacePermissions.apply(context.author, context.space.id, {
      action: "remove",
      permissionId: await permissionOf(context, context.readerId),
    });
    const hidden = await publish(context, "While away");
    await test.services.blogSubscriptions.deliverPending();
    expect(await received(context.readerId)).toEqual([]);
    expect(await test.services.blogSubscriptions.list(context.reader)).toEqual({ blogs: [], unavailable: 1 });

    await test.services.spacePermissions.apply(context.author, context.space.id, {
      action: "grant",
      principalKind: "account",
      principalId: context.readerId,
      role: "reader",
    });
    const visible = await publish(context, "Welcome back");
    await test.services.blogSubscriptions.deliverPending();
    expect((await received(context.readerId)).map((row) => row.target_id)).toEqual([visible.id]);
    expect(await received(context.readerId, hidden.id)).toEqual([]);
  });

  it("sends nothing after the membership ended and resumes when the person returns", async () => {
    const context = await setup();
    await test.services.blogSubscriptions.follow(context.reader, context.space.id);
    await test.services.memberships.remove(SYSTEM, context.org.id, context.readerId, "removed", {
      releaseHome: true,
    });
    await publish(context, "After leaving");
    await test.services.blogSubscriptions.deliverPending();
    expect(await received(context.readerId)).toEqual([]);

    await test.database.transaction((tx) =>
      test.services.memberships.add(tx, SYSTEM, {
        organizationId: context.org.id,
        accountId: context.readerId,
        kind: "member",
      }),
    );
    const back = await publish(context, "After returning");
    await test.services.blogSubscriptions.deliverPending();
    expect((await received(context.readerId)).map((row) => row.target_id)).toEqual([back.id]);
  });

  it("skips deactivated followers", async () => {
    const context = await setup();
    await test.services.blogSubscriptions.follow(context.reader, context.space.id);
    await test.database.execute(
      sql`update accounts set state = 'deactivated' where id = ${context.readerId}`,
    );
    await publish(context, "Nobody home");
    await test.services.blogSubscriptions.deliverPending();
    expect(await received(context.readerId)).toEqual([]);
  });

  it("keeps restricted posts from followers outside the restriction", async () => {
    const context = await setup();
    await test.services.blogSubscriptions.follow(context.reader, context.space.id);
    await test.services.blogSubscriptions.follow(context.otherReader, context.space.id);
    const post = await write(context, "Board news");
    await test.services.pageAccess.change(context.author, post.id, [
      { action: "share", holderKind: "account", holderId: context.otherReaderId, role: "reader" },
      { action: "restrict", kind: "view" },
    ]);
    await test.services.versions.publish(context.author, post.id);
    await test.services.blogSubscriptions.deliverPending();
    expect(await received(context.readerId)).toEqual([]);
    expect(await received(context.otherReaderId, post.id)).toHaveLength(1);
  });

  it("hides a delivered notification when the follower loses access", async () => {
    const context = await setup();
    await test.services.blogSubscriptions.follow(context.reader, context.space.id);
    const post = await publish(context, "Later hidden");
    await test.services.blogSubscriptions.deliverPending();
    expect((await test.services.notifications.list(context.readerId, { limit: 10 })).items).toHaveLength(1);
    await test.services.pageAccess.change(context.author, post.id, [{ action: "restrict", kind: "view" }]);
    expect((await test.services.notifications.list(context.readerId, { limit: 10 })).items).toEqual([]);
  });

  it("does not announce posts that were deleted before the delivery", async () => {
    const context = await setup();
    await test.services.blogSubscriptions.follow(context.reader, context.space.id);
    const post = await publish(context, "Deleted at once");
    await test.services.trash.deleteItem(context.author, post.id);
    await test.services.blogSubscriptions.deliverPending();
    expect(await received(context.readerId)).toEqual([]);
    const pending = await test.database.execute(
      sql`select 1 from blog_post_announcements where item_id = ${post.id}`,
    );
    expect(pending.rows).toEqual([]);
  });

  it("announces each post exactly once when two nodes deliver at the same time", async () => {
    const context = await setup();
    await test.services.blogSubscriptions.follow(context.reader, context.space.id);
    const posts = [];
    for (const title of ["One", "Two", "Three"]) posts.push(await publish(context, title));
    await Promise.all([
      test.services.blogSubscriptions.deliverPending(),
      test.services.blogSubscriptions.deliverPending(),
    ]);
    const rows = await received(context.readerId);
    expect(rows.map((row) => row.target_id).sort()).toEqual(posts.map((post) => post.id).sort());
  });

  it("delivers to every follower of a large blog in batches", async () => {
    const context = await setup();
    const followers: string[] = [];
    for (let index = 0; index < ANNOUNCEMENT_BATCH + 5; index += 1) {
      const id = randomUUID();
      followers.push(id);
      await test.database.execute(sql`
        insert into accounts (id, type, state, email, name)
        values (${id}, 'standard', 'active', ${`${id}@example.org`}, ${`Follower ${index}`})`);
    }
    await test.database.execute(sql`
      insert into memberships (id, organization_id, account_id, kind)
      select gen_random_uuid(), ${context.org.id}, unnest(${sql.param(followers)}::uuid[]), 'member'`);
    await test.database.execute(sql`
      insert into space_permissions (id, space_id, principal_kind, principal_id, role)
      select gen_random_uuid(), ${context.space.id}, 'account', unnest(${sql.param(followers)}::uuid[]), 'reader'`);
    await test.database.execute(sql`
      insert into blog_subscriptions (space_id, account_id)
      select ${context.space.id}, unnest(${sql.param(followers)}::uuid[])`);
    const post = await publish(context, "Big audience");
    expect(await test.services.blogSubscriptions.deliverPending()).toBe(followers.length);
    const count = await test.database.execute<{ count: number }>(sql`
      select count(distinct recipient_id)::int as count from notifications
      where type = 'blogPost.published' and target_id = ${post.id}`);
    expect(count.rows[0]?.count).toBe(followers.length);
  });

  it("lists followed blogs the person can read and removes the others on request", async () => {
    const context = await setup();
    const other = await space(context.org.id, context.authorId, { name: "Hidden space" });
    await test.services.blogSubscriptions.follow(context.reader, context.space.id);
    await test.services.blogSubscriptions.follow(context.reader, context.space.id);
    await test.database.execute(sql`
      insert into blog_subscriptions (space_id, account_id) values (${other.id}, ${context.readerId})`);
    const listed = await test.services.blogSubscriptions.list(context.reader);
    expect(listed.unavailable).toBe(1);
    expect(listed.blogs.map((blog) => [blog.spaceId, blog.spaceName])).toEqual([
      [context.space.id, context.space.name],
    ]);
    expect(await test.services.blogSubscriptions.following(context.reader, context.space.id)).toBe(true);
    expect(await test.services.blogSubscriptions.removeUnavailable(context.reader)).toBe(1);
    expect((await test.services.blogSubscriptions.list(context.reader)).unavailable).toBe(0);
    await test.services.blogSubscriptions.unfollow(context.reader, context.space.id);
    expect(await test.services.blogSubscriptions.following(context.reader, context.space.id)).toBe(false);
  });
});
