import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import type { DocumentJson, NodeJson } from "@lunedo/editor-schema";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accountPrincipal, type Principal, SYSTEM } from "../accounts/principal.js";
import type { PrincipalKind } from "../organizations/access-schema.js";
import { randomPersonalSpaceKey } from "../spaces/keys.js";
import type { SpaceRole, SpaceVisibility } from "../spaces/schema.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { spaceFixtures } from "../testing/spaces.js";
import type { SearchContentType } from "./adapter.js";
import { pdfFile } from "./extraction/files.testing.js";
import { searchRequest } from "./search.testing.js";
import type { SearchCursor } from "./service.js";

const baseUrl = testDatabaseBaseUrl();

const people = [
  "member",
  "groupMember",
  "otherGroupMember",
  "plainMember",
  "guest",
  "expiredGuest",
  "collaborator",
  "endedMember",
  "deactivated",
  "nonMember",
  "organizationAdministrator",
  "instanceAdministrator",
  "serviceAccount",
  "portal",
  "expiredGroupMember",
] as const;
type Person = (typeof people)[number];

const visibilities: SpaceVisibility[] = ["private", "organization", "instance"];
const roles: SpaceRole[] = ["reader", "commenter", "editor", "admin"];
const shareRoles: SpaceRole[] = ["reader", "commenter", "editor"];
const GENERATED_SPACES = 18;
const WORD = "matrixword";
const UPDATE_WORD = "matrixupdate";
const PRIVATE_WORD = "matrixprivate";

function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function body(text: string): DocumentJson {
  return { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] };
}

function writeUpdate(document: DocumentJson, topicId: string, value: string): DocumentJson {
  const visit = (node: NodeJson): NodeJson => {
    if (node.type === "topicUpdate" && node.attrs?.topicId === topicId) {
      return { ...node, content: [{ type: "paragraph", content: [{ type: "text", text: value }] }] };
    }
    return node.content ? { ...node, content: node.content.map(visit) } : node;
  };
  return visit(document) as DocumentJson;
}

interface Holder {
  kind: PrincipalKind;
  id: string | null;
}

interface World {
  organizationId: string;
  ownerId: string;
  ids: Record<Person, string>;
  items: string[];
  withWord: string[];
  comments: string[];
  hiddenComments: string[];
  attachments: string[];
  topics: { id: string; meetingId: string; commentId: string }[];
  decisions: { id: string; meetingId: string }[];
}

describe.skipIf(!baseUrl)("search access matrix", () => {
  let test: TestServices;
  let world: World;
  const visibleCounts = new Map<Person, number>();
  const fixtures = spaceFixtures(() => test);

  async function query(text: string, values: unknown[] = []) {
    return test.pool.query(text, values);
  }

  async function buildWorld(): Promise<World> {
    const next = random(20261014);
    const pick = <T>(values: readonly T[]): T => values[Math.floor(next() * values.length)] as T;
    const org = await fixtures.organization();
    const owner = accountPrincipal(org.owner);
    const ids = {} as Record<Person, string>;
    for (const person of [
      "member",
      "groupMember",
      "otherGroupMember",
      "plainMember",
      "endedMember",
    ] as const) {
      ids[person] = await fixtures.member(org.id, "member", person);
    }
    ids.deactivated = await fixtures.member(org.id, "member", "deactivated");
    ids.expiredGroupMember = await fixtures.member(org.id, "member", "expiredGroupMember");
    ids.organizationAdministrator = await fixtures.member(org.id, "member", "organizationAdministrator");
    ids.guest = await fixtures.member(org.id, "guest", "guest");
    ids.expiredGuest = await fixtures.member(org.id, "guest", "expiredGuest");
    ids.collaborator = await fixtures.account({ name: "collaborator" });
    await fixtures.join(org.id, ids.collaborator, "collaborator");
    ids.nonMember = await fixtures.account({ name: "nonMember" });
    ids.instanceAdministrator = await fixtures.account({ name: "instanceAdministrator" });
    ids.serviceAccount = (await test.services.serviceAccounts.create(SYSTEM, org.id, { name: "Bot" })).id;
    ids.portal = randomUUID();
    await query(
      "insert into accounts (id, type, state, email, name) values ($1, 'portal', 'active', $2, 'portal')",
      [ids.portal, `${ids.portal}@portal.example.org`],
    );
    await query(
      "insert into memberships (id, organization_id, account_id, kind) values ($1, $2, $3, 'guest')",
      [randomUUID(), org.id, ids.portal],
    );
    await test.services.roles.assign(SYSTEM, {
      scope: "organization",
      organizationId: org.id,
      role: { builtIn: "administrator" },
      principal: { kind: "account", id: ids.organizationAdministrator },
    });
    await test.services.roles.assign(SYSTEM, {
      scope: "instance",
      organizationId: null,
      role: { builtIn: "administrator" },
      principal: { kind: "account", id: ids.instanceAdministrator },
    });

    const groups: string[] = [];
    const groupMembers: Person[][] = [
      ["groupMember", "expiredGuest", "portal", "endedMember"],
      ["otherGroupMember", "collaborator", "guest"],
      ["serviceAccount", "expiredGroupMember", "deactivated"],
    ];
    for (const members of groupMembers) {
      const groupId = randomUUID();
      await query("insert into groups (id, organization_id, name) values ($1, $2, $3)", [
        groupId,
        org.id,
        `Group ${groupId.slice(0, 8)}`,
      ]);
      for (const person of members) {
        await query("insert into group_members (group_id, account_id) values ($1, $2)", [
          groupId,
          ids[person],
        ]);
      }
      groups.push(groupId);
    }

    const accountHolders: Holder[] = people.map((person) => ({ kind: "account", id: ids[person] }));
    const groupHolders: Holder[] = groups.map((id) => ({ kind: "group", id }));
    const spaceHolders: Holder[] = [
      ...accountHolders,
      ...groupHolders,
      { kind: "organizationMembers", id: null },
      { kind: "instanceUsers", id: null },
    ];
    const itemHolders = [...accountHolders, ...groupHolders];

    const items: string[] = [];
    const comments: string[] = [];
    const hiddenComments: string[] = [];
    const attachments: string[] = [];
    const topics: World["topics"] = [];
    const decisions: World["decisions"] = [];
    const file = pdfFile([[`${WORD} attachment text`]]);
    const upload = async (itemId: string, name: string) =>
      (await test.services.attachments.upload(owner, itemId, { name, body: Readable.from([file]) })).id;

    const meetings = async (spaceId: string, parentId: string | null) => {
      const seriesId = await test.services.meetings.createSeries(owner, spaceId, {
        name: `Series ${randomUUID().slice(0, 6)}`,
        parentId,
        members: [org.owner],
        templateId: "builtin:team-meeting",
        rhythm: { frequency: "weekly", interval: 1, weekdays: ["MO"] },
        startsOn: "2030-03-18",
        startTime: "09:30",
        timeZone: "Europe/Vienna",
        durationMinutes: 30,
      });
      const meetingId = (await test.services.meetings.details(owner, seriesId)).upcoming?.id ?? "";
      const topicId = await test.services.topics.create(owner, seriesId, { title: `${WORD} topic` });
      const snapshot = await test.services.documents.snapshot(meetingId);
      if (!snapshot) throw new Error("The meeting has no content");
      await test.services.documents.replace(
        owner,
        meetingId,
        writeUpdate(snapshot.document, topicId, UPDATE_WORD),
      );
      const commentId = await test.services.comments.create(owner, topicId, {
        body: body(`${WORD} topic comment`),
      });
      const decision = await test.services.topics.closeAsDecision(owner, topicId, {
        statement: `${WORD} decided`,
      });
      await test.services.privateNotes.save(owner, meetingId, { document: body(PRIVATE_WORD), revision: 0 });
      items.push(meetingId);
      topics.push({ id: topicId, meetingId, commentId });
      decisions.push({ id: decision.decisionId, meetingId });
      return [seriesId, meetingId, topicId];
    };

    const page = async (
      spaceId: string,
      parentId: string | null,
      mode: "live" | "publish",
      publish: boolean,
    ) => {
      const created = await test.services.tree.create(owner, spaceId, {
        kind: "page",
        title: `Page ${randomUUID().slice(0, 6)}`,
        mode,
        placement: { parentId },
        document: body(`${WORD} content ${randomUUID()}`),
      });
      if (mode === "publish" && publish) await test.services.versions.publish(owner, created.id);
      return created.id;
    };

    const comment = async (itemId: string, options: { hidden?: boolean; deleted?: boolean } = {}) => {
      const id = randomUUID();
      await query(
        `insert into comments (id, item_id, author_id, body, quote, quote_public, deleted_at)
         values ($1, $2, $3, $4, $5, false, $6)`,
        [
          id,
          itemId,
          org.owner,
          body(`${WORD} comment`),
          options.hidden ? "draft words" : null,
          options.deleted ? new Date() : null,
        ],
      );
      return id;
    };

    const fill = async (
      spaceId: string,
      index: number,
      holders: Holder[] = itemHolders,
      options: { meetings?: boolean } = { meetings: true },
    ) => {
      const root = await page(spaceId, null, "publish", true);
      const child = await page(spaceId, root, "live", false);
      const grandchild = await page(spaceId, child, "live", false);
      const draft = await page(spaceId, root, "publish", false);
      const belowDraft = await page(spaceId, draft, "live", false);
      const second = await page(spaceId, null, "live", false);
      const secondChild = await page(spaceId, second, "publish", true);
      const tree = [root, child, grandchild, draft, belowDraft, second, secondChild];
      items.push(...tree);
      const published = await upload(root, "published.pdf");
      const removedAtPublication = await upload(root, "removed.pdf");
      const removedInDraft = await upload(root, "removed-in-draft.pdf");
      await test.services.versions.publish(owner, root);
      await test.services.attachments.delete(owner, removedAtPublication);
      await test.services.versions.publish(owner, root);
      const draftOnly = await upload(root, "draft-only.pdf");
      await test.services.attachments.delete(owner, removedInDraft);
      attachments.push(published, removedAtPublication, removedInDraft, draftOnly);
      attachments.push(await upload(child, "live.pdf"), await upload(belowDraft, "below-draft.pdf"));
      const meetingItems = options.meetings ? await meetings(spaceId, index % 3 === 0 ? draft : null) : [];
      for (const itemId of [...tree, ...meetingItems]) {
        if (next() < 0.3) {
          await query("insert into page_restrictions (item_id, kind) values ($1, 'view')", [itemId]);
          const count = 1 + Math.floor(next() * 2);
          for (let holder = 0; holder < count; holder++) {
            const chosen = pick(holders);
            await query(
              `insert into page_restriction_holders (item_id, kind, principal_kind, principal_id)
               values ($1, 'view', $2, $3) on conflict do nothing`,
              [itemId, chosen.kind, chosen.id],
            );
          }
        }
        if (next() < 0.3) {
          const chosen = pick(holders);
          await query(
            `insert into page_shares (id, item_id, principal_kind, principal_id, role, include_descendants)
             values ($1, $2, $3, $4, $5, $6) on conflict do nothing`,
            [randomUUID(), itemId, chosen.kind, chosen.id, pick(shareRoles), next() < 0.5],
          );
        }
      }
      comments.push(await comment(root), await comment(secondChild));
      hiddenComments.push(await comment(second, { hidden: true }), await comment(root, { deleted: true }));
      if (index % 5 === 0) await test.services.archive.archive(owner, child);
      if (index % 4 === 1) await test.services.trash.deleteItem(owner, grandchild);
    };

    for (let index = 0; index < GENERATED_SPACES; index++) {
      const created = await fixtures.space(org.id, org.owner, { visibility: visibilities[index % 3] });
      const count = 1 + Math.floor(next() * 4);
      for (let grant = 0; grant < count; grant++) {
        const holder = pick(spaceHolders);
        await query(
          `insert into space_permissions (id, space_id, principal_kind, principal_id, role)
           values ($1, $2, $3, $4, $5) on conflict do nothing`,
          [randomUUID(), created.id, holder.kind, holder.id, pick(roles)],
        );
      }
      await fill(created.id, index);
    }

    const confidential = await test.services.spaces.create(
      owner,
      org.id,
      { name: "Works council", key: "WCX", visibility: "private", grants: [], confidential: true },
      test.services.spacePermissions.holders,
    );
    for (const [person, role] of [
      ["plainMember", "reader"],
      ["member", "editor"],
      ["endedMember", "admin"],
    ] as const) {
      await query(
        "insert into space_permissions (id, space_id, principal_kind, principal_id, role) values ($1, $2, 'account', $3, $4)",
        [randomUUID(), confidential.id, ids[person], role],
      );
    }
    await fill(confidential.id, 2, accountHolders);

    const personalSpaces: string[] = [];
    for (const [person, index] of [
      ["member", 6],
      ["guest", 7],
      ["endedMember", 9],
    ] as const) {
      const personal = randomUUID();
      personalSpaces.push(personal);
      await query(
        `insert into spaces (id, personal_of, owner_account_id, key, name, visibility, created_by)
         values ($1, $2, $2, $3, '', 'private', $2)`,
        [personal, ids[person], randomPersonalSpaceKey()],
      );
      for (const account of [ids[person], org.owner]) {
        await query(
          "insert into space_permissions (id, space_id, principal_kind, principal_id, role) values ($1, $2, 'account', $3, 'admin')",
          [randomUUID(), personal, account],
        );
      }
      for (let grant = 0; grant < 2; grant++) {
        const holder = pick(spaceHolders);
        await query(
          `insert into space_permissions (id, space_id, principal_kind, principal_id, role)
           values ($1, $2, $3, $4, $5) on conflict do nothing`,
          [randomUUID(), personal, holder.kind, holder.id, pick(roles)],
        );
      }
      await fill(personal, index, itemHolders, { meetings: false });
    }

    const deleted = await fixtures.space(org.id, org.owner, {
      visibility: "organization",
      grants: [{ principalKind: "organizationMembers", principalId: null, role: "reader" }],
    });
    await fill(deleted.id, 3);
    await test.services.trash.deleteSpace(owner, deleted.id, deleted.name);

    await test.services.memberships.remove(SYSTEM, org.id, ids.endedMember, "removed", { releaseHome: true });
    await query(
      "update memberships set expires_at = now() - interval '1 day' where organization_id = $1 and account_id = $2",
      [org.id, ids.expiredGuest],
    );
    await query("update group_members set expires_at = now() - interval '1 day' where account_id = $1", [
      ids.expiredGroupMember,
    ]);
    await query("update accounts set state = 'deactivated' where id = $1", [ids.deactivated]);
    const all = await query(
      `select t.id from tree_items t join spaces s on s.id = t.space_id
       where (s.organization_id = $1 or s.id = any($2::uuid[])) and t.kind = 'page' order by t.id`,
      [org.id, personalSpaces],
    );
    expect(all.rows.length).toBeGreaterThan(items.length);
    return {
      organizationId: org.id,
      ownerId: org.owner,
      ids,
      items: all.rows.map((row) => row.id),
      withWord: items,
      comments,
      hiddenComments,
      attachments,
      topics,
      decisions,
    };
  }

  beforeAll(async () => {
    test = await createTestServices(baseUrl ?? "");
    await query("insert into instance (id, setup_completed_at) values (1, now())");
    world = await buildWorld();
    await test.services.search.indexer.drain();
  }, 600_000);

  afterAll(async () => {
    await test?.close();
  });

  function principal(person: Person): Principal {
    return accountPrincipal(world.ids[person]);
  }

  async function allowed(person: Person, action: string, type: string, ids: string[]): Promise<string[]> {
    const result: string[] = [];
    for (const id of ids) {
      const decision = await test.services.authorization.explain(
        principal(person),
        action,
        { type, id },
        {
          fresh: true,
        },
      );
      if (decision.allowed) result.push(id);
    }
    return result.sort();
  }

  async function found(person: Person, text: string, contentTypes: SearchContentType[]): Promise<string[]> {
    const ids: string[] = [];
    let cursor: SearchCursor | null = null;
    for (let page = 0; page < 100; page++) {
      const response = await test.services.search.search(
        principal(person),
        world.organizationId,
        searchRequest(text, {
          contentTypes,
          includeArchived: true,
          sort: text ? "relevance" : "newest",
          limit: 50,
          cursor,
        }),
      );
      ids.push(...response.results.map((hit) => hit.id));
      if (!response.nextCursor) {
        expect(new Set(ids).size).toBe(response.total);
        return ids.sort();
      }
      cursor = response.nextCursor;
    }
    throw new Error("Search did not finish paging");
  }

  async function compare(person: Person) {
    const pages = await allowed(person, "item.view", "item", world.items);
    const indexable = await query(
      `select t.id from tree_items t where t.id = any($1::uuid[]) and (t.mode = 'live' or t.published_version_id is not null)`,
      [world.items],
    );
    const expectedPages = pages.filter((id) => indexable.rows.some((row) => row.id === id));
    expect(await found(person, "", ["page"]), "pages").toEqual(expectedPages);
    expect(await found(person, WORD, ["page"]), "pages with word").toEqual(
      expectedPages.filter((id) => world.withWord.includes(id)),
    );
    const expectedComments = await allowed(person, "comment.view", "comment", world.comments);
    expect(await found(person, "", ["comment"]), "comments").toEqual(expectedComments);

    const viewable = await allowed(person, "attachment.view", "attachment", world.attachments);
    const publishedAttachments = await query(
      `select a.id from attachments a join tree_items t on t.id = a.item_id
       where a.id = any($1::uuid[]) and a.published_version_id is not null
         and (t.mode = 'live' or t.published_version_id is not null)`,
      [viewable],
    );
    const expectedAttachments = publishedAttachments.rows.map((row) => row.id as string).sort();
    expect(await found(person, "", ["attachment"]), "attachments").toEqual(expectedAttachments);
    expect(await found(person, WORD, ["attachment"]), "attachments with word").toEqual(expectedAttachments);

    const topics = await allowed(
      person,
      "item.view",
      "item",
      world.topics.map((topic) => topic.id),
    );
    const topicComments = await allowed(
      person,
      "comment.view",
      "comment",
      world.topics.filter((topic) => topics.includes(topic.id)).map((topic) => topic.commentId),
    );
    expect(await found(person, "", ["topic"]), "topics").toEqual([...topics, ...topicComments].sort());
    const meetings = await allowed(
      person,
      "item.view",
      "item",
      world.topics.map((topic) => topic.meetingId),
    );
    expect(await found(person, UPDATE_WORD, ["topic"]), "topic updates").toEqual(
      world.topics
        .filter((topic) => topics.includes(topic.id) && meetings.includes(topic.meetingId))
        .map((topic) => topic.id)
        .sort(),
    );
    const expectedDecisions = world.decisions
      .filter((decision) => meetings.includes(decision.meetingId))
      .map((decision) => decision.id)
      .sort();
    expect(await found(person, "", ["decision"]), "decisions").toEqual(expectedDecisions);
    expect(await found(person, PRIVATE_WORD, []), "private notes").toEqual([]);
    visibleCounts.set(
      person,
      expectedPages.length + expectedComments.length + expectedAttachments.length + topics.length,
    );
  }

  describe("with stored access", () => {
    it("starts without pending access updates", async () => {
      const pending = await query("select count(*)::int as count from search_pending_spaces");
      expect(pending.rows[0]?.count).toBe(0);
    });

    for (const person of people) {
      it(`finds exactly what ${person} may view`, async () => {
        await compare(person);
      });
    }

    it("covers people who see something and people who see nothing", () => {
      expect(visibleCounts.size).toBe(people.length);
      expect(visibleCounts.get("member")).toBeGreaterThan(0);
      expect(visibleCounts.get("guest")).toBeGreaterThan(0);
      expect(visibleCounts.get("deactivated")).toBe(0);
      expect(visibleCounts.get("endedMember")).toBeLessThan(visibleCounts.get("member") ?? 0);
    });

    it("covers attachments, topics and decisions that only some people may view", async () => {
      const counts = await Promise.all(
        (["member", "plainMember", "guest"] as const).map(async (person) => ({
          attachments: (await found(person, "", ["attachment"])).length,
          topics: (await found(person, "", ["topic"])).length,
          decisions: (await found(person, "", ["decision"])).length,
        })),
      );
      for (const count of counts) {
        expect(count.attachments).toBeLessThan(world.attachments.length);
        expect(count.topics).toBeLessThan(world.topics.length * 2);
        expect(count.decisions).toBeLessThan(world.decisions.length);
      }
      expect(counts.some((count) => count.attachments > 0 && count.topics > 0 && count.decisions > 0)).toBe(
        true,
      );
    });

    it("never finds private notes, not even their author", async () => {
      const author = await test.services.search.search(
        accountPrincipal(world.ownerId),
        world.organizationId,
        searchRequest(PRIVATE_WORD, { includeArchived: true }),
      );
      expect(author.results).toEqual([]);
    });

    it("never finds hidden or deleted comments, also for editors", async () => {
      for (const person of people) {
        const ids = await found(person, "", ["comment"]);
        expect(ids.filter((id) => world.hiddenComments.includes(id))).toEqual([]);
      }
    });
  });

  describe("while access updates are pending", () => {
    beforeAll(async () => {
      await query(
        `update search_chunks set readers = $1::text[], restrictions = '{}',
           context_readers = case when context_item_id is not null then $1::text[] end, context_restrictions = '{}'
         where organization_id = $2`,
        [
          [
            "internal",
            `members:${world.organizationId}`,
            ...people.flatMap((person) => [
              `account:${world.ids[person]}`,
              `share-account:${world.ids[person]}`,
            ]),
          ],
          world.organizationId,
        ],
      );
      await query(
        "insert into search_pending_spaces (space_id) select id from spaces where organization_id = $1",
        [world.organizationId],
      );
    });

    afterAll(async () => {
      await query("delete from search_pending_spaces");
    });

    for (const person of people) {
      it(`checks access of ${person} directly and ignores the outdated stored access`, async () => {
        await compare(person);
      });
    }
  });
});
