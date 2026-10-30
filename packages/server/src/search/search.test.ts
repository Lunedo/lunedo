import { randomUUID } from "node:crypto";
import type { DocumentJson, NodeJson } from "@lunedo/editor-schema";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accountPrincipal, type Principal, SYSTEM } from "../accounts/principal.js";
import { pageStatusEnabledSetting } from "../spaces/settings.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { spaceFixtures } from "../testing/spaces.js";
import type { AdapterSearch, SearchAdapter } from "./adapter.js";
import { PostgresSearchAdapter } from "./postgres-adapter.js";
import { searchRequest } from "./search.testing.js";
import { correctedQuery, SearchService } from "./service.js";

const baseUrl = testDatabaseBaseUrl();

function doc(...content: NodeJson[]): DocumentJson {
  return { type: "doc", content };
}

function paragraph(text: string): NodeJson {
  return { type: "paragraph", content: [{ type: "text", text }] };
}

function heading(text: string): NodeJson {
  return { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text }] };
}

describe.skipIf(!baseUrl)("search", () => {
  let test: TestServices;
  const { organization, member, space, join } = spaceFixtures(() => test);

  beforeAll(async () => {
    test = await createTestServices(baseUrl ?? "");
    await test.pool.query("insert into instance (id, setup_completed_at) values (1, now())");
  });

  afterAll(async () => {
    await test?.close();
  });

  async function drain() {
    return test.services.search.indexer.drain();
  }

  async function find(viewer: Principal, organizationId: string, query: string, overrides = {}) {
    return test.services.search.search(viewer, organizationId, searchRequest(query, overrides));
  }

  it("finds the published version of a page by its body and marks the matched words", async () => {
    const org = await organization();
    const authorId = await member(org.id, "member", "Author");
    const created = await space(org.id, authorId, { visibility: "organization" });
    const author = accountPrincipal(authorId);
    const page = await test.services.tree.create(author, created.id, {
      kind: "page",
      title: "VPN access",
      mode: "publish",
      placement: { parentId: null },
      document: doc(heading("Setup"), paragraph("Install the WireGuard client on your laptop.")),
    });
    await test.services.versions.publish(author, page.id);
    await drain();
    const result = await find(author, org.id, "wireguard");
    expect(result.results.map((hit) => hit.title)).toEqual(["VPN access"]);
    expect(result.results[0]?.heading).toBe("Setup");
    expect(result.results[0]?.excerpt.some((part) => part.highlighted && /wireguard/i.test(part.text))).toBe(
      true,
    );
    expect(result.total).toBe(1);
    expect(result.results[0]).toMatchObject({ itemId: page.id, number: page.number, path: [] });
  });

  it("gives the numbers of the result and of its parent pages", async () => {
    const org = await organization();
    const authorId = await member(org.id, "member", "Author");
    const created = await space(org.id, authorId, { visibility: "organization" });
    const author = accountPrincipal(authorId);
    const word = `w${Math.random().toString(36).slice(2, 10)}`;
    const add = (title: string, parentId: string | null, text = "Overview") =>
      test.services.tree.create(author, created.id, {
        kind: "page",
        title,
        mode: "live",
        placement: { parentId },
        document: doc(paragraph(text)),
      });
    const top = await add("Handbook", null);
    const middle = await add("Chapter", top.id);
    const leaf = await add("Printers", middle.id, `${word} printer setup`);
    await drain();
    const own = await find(author, org.id, word);
    expect(own.results[0]).toMatchObject({
      itemId: leaf.id,
      number: leaf.number,
      path: [
        { id: top.id, number: top.number, title: "Handbook" },
        { id: middle.id, number: middle.number, title: "Chapter" },
      ],
    });
  });

  async function world() {
    const org = await organization();
    const authorId = await member(org.id, "member", "Ada Author");
    const otherId = await member(org.id, "member", "Otto Other");
    const outsiderId = await member(org.id, "member", "Olga Outsider");
    const author = accountPrincipal(authorId);
    const other = accountPrincipal(otherId);
    const word = `w${Math.random().toString(36).slice(2, 10)}`;
    const shared = await space(org.id, authorId, {
      visibility: "private",
      grants: [{ principalKind: "account", principalId: otherId, role: "editor" }],
      name: "Shared space",
    });
    const second = await space(org.id, authorId, {
      visibility: "private",
      grants: [{ principalKind: "account", principalId: otherId, role: "reader" }],
      name: "Second space",
    });
    const hidden = await space(org.id, authorId, { visibility: "private", name: "Hidden space" });
    const create = async (spaceId: string, title: string, text: string, by = author) => {
      const created = await test.services.tree.create(by, spaceId, {
        kind: "page",
        title,
        mode: "live",
        placement: { parentId: null },
        document: doc(paragraph(text)),
      });
      return created.id;
    };
    const alpha = await create(shared.id, "Alpha guide", `${word} network printer setup`);
    const beta = await create(shared.id, "Beta guide", `${word} network scanner setup`, other);
    const gamma = await create(second.id, "Gamma notes", `${word} printer cartridge`);
    const secret = await create(hidden.id, "Secret plan", `${word} printer secret`);
    await test.services.documents.addLabel(author, alpha, `howto-${word}`);
    await test.services.documents.addLabel(author, secret, `secret-${word}`);
    await drain();
    return {
      org,
      author,
      authorId,
      other,
      otherId,
      outsider: accountPrincipal(outsiderId),
      word,
      shared,
      second,
      hidden,
      alpha,
      beta,
      gamma,
      secret,
    };
  }

  async function ids(viewer: Principal, organizationId: string, query: string, overrides = {}) {
    return (await find(viewer, organizationId, query, overrides)).results.map((hit) => hit.itemId).sort();
  }

  it("understands phrases, exclusions and alternatives", async () => {
    const w = await world();
    expect(await ids(w.other, w.org.id, `${w.word} printer`)).toEqual([w.alpha, w.gamma].sort());
    expect(await ids(w.other, w.org.id, `"network printer" ${w.word}`)).toEqual([w.alpha]);
    expect(await ids(w.other, w.org.id, `${w.word} printer -cartridge`)).toEqual([w.alpha]);
    expect(await ids(w.other, w.org.id, `${w.word} scanner OR cartridge`)).toEqual([w.beta, w.gamma].sort());
  });

  it("filters by space, label, author and type through operators and parameters", async () => {
    const w = await world();
    expect(await ids(w.other, w.org.id, `${w.word} space:${w.second.key}`)).toEqual([w.gamma]);
    expect(await ids(w.other, w.org.id, w.word, { spaceIds: [w.shared.id] })).toEqual(
      [w.alpha, w.beta].sort(),
    );
    expect(await ids(w.other, w.org.id, `${w.word} label:howto-${w.word}`)).toEqual([w.alpha]);
    expect(await ids(w.other, w.org.id, `${w.word} author:Otto`)).toEqual([w.beta]);
    expect(await ids(w.other, w.org.id, `${w.word} author:"Otto Other"`)).toEqual([w.beta]);
    expect(await ids(w.other, w.org.id, w.word, { authorIds: [w.otherId] })).toEqual([w.beta]);
    expect(await ids(w.other, w.org.id, `${w.word} type:comment`)).toEqual([]);
    expect(await ids(w.other, w.org.id, `${w.word} type:page`)).toHaveLength(3);
    expect(await ids(w.other, w.org.id, `${w.word} type:unknown`)).toEqual([]);
  });

  it("answers the same for hidden and unknown spaces and labels", async () => {
    const w = await world();
    const same = async (first: Promise<unknown>, second: Promise<unknown>) => {
      const [a, b] = (await Promise.all([first, second])) as { index: unknown }[];
      expect({ ...a, index: null }).toEqual({ ...b, index: null });
      return a;
    };
    const hiddenSpace = await same(
      find(w.other, w.org.id, `${w.word} space:${w.hidden.key}`),
      find(w.other, w.org.id, `${w.word} space:NOSUCHKEY`),
    );
    expect(hiddenSpace).toMatchObject({ results: [], total: 0 });
    await same(
      find(w.other, w.org.id, w.word, { spaceIds: [w.hidden.id] }),
      find(w.other, w.org.id, w.word, { spaceIds: ["01a00000-0000-7000-8000-000000000000"] }),
    );
    await same(
      find(w.other, w.org.id, `${w.word} label:secret-${w.word}`),
      find(w.other, w.org.id, `${w.word} label:nothing-${w.word}`),
    );
    const all = await find(w.other, w.org.id, w.word);
    expect(all.facets?.labels.map((facet) => facet.value)).toEqual([`howto-${w.word}`]);
    expect(all.facets?.spaces.map((facet) => facet.name).sort()).toEqual(["Second space", "Shared space"]);
  });

  it("counts results per filter value over visible results only", async () => {
    const w = await world();
    const result = await find(w.other, w.org.id, w.word);
    expect(result.total).toBe(3);
    expect(result.facets?.contentTypes).toEqual([{ value: "page", count: 3 }]);
    expect(result.facets?.spaces).toEqual(
      expect.arrayContaining([
        {
          value: w.shared.id,
          count: 2,
          key: w.shared.key,
          name: "Shared space",
          displayName: "Shared space",
          personal: false,
          mine: false,
        },
        {
          value: w.second.id,
          count: 1,
          key: w.second.key,
          name: "Second space",
          displayName: "Second space",
          personal: false,
          mine: false,
        },
      ]),
    );
    expect(result.facets?.authors.map((facet) => [facet.name, facet.count]).sort()).toEqual([
      ["Ada Author", 2],
      ["Otto Other", 1],
    ]);
    const outsider = await find(w.outsider, w.org.id, w.word);
    expect(outsider.total).toBe(0);
    expect(outsider.facets).toEqual({
      contentTypes: [],
      spaces: [],
      labels: [],
      authors: [],
      statuses: [],
      languages: [],
      updated: [],
    });
  });

  it("pages through results with a cursor in both sort orders", async () => {
    const w = await world();
    for (const sort of ["relevance", "newest"] as const) {
      const first = await find(w.author, w.org.id, w.word, { limit: 2, sort });
      expect(first.results).toHaveLength(2);
      expect(first.total).toBe(4);
      expect(first.nextCursor).not.toBeNull();
      const second = await find(w.author, w.org.id, w.word, { limit: 2, sort, cursor: first.nextCursor });
      expect(second.nextCursor).toBeNull();
      const all = [...first.results, ...second.results].map((hit) => hit.itemId).sort();
      expect(all).toEqual([w.alpha, w.beta, w.gamma, w.secret].sort());
    }
    const newest = await find(w.author, w.org.id, w.word, { sort: "newest" });
    const times = newest.results.map((hit) => hit.updatedAt);
    expect([...times].sort().reverse()).toEqual(times);
  });

  it("lists the current space first in quick search and matches the word being typed", async () => {
    const w = await world();
    const quick = await find(w.other, w.org.id, `${w.word} prin`, {
      mode: "quick",
      currentSpaceId: w.second.id,
    });
    expect(quick.results.map((hit) => hit.itemId)).toEqual([w.gamma, w.alpha]);
    expect(quick.facets).toBeNull();
    expect(quick.nextCursor).toBeNull();
    const hiddenCurrent = await find(w.other, w.org.id, `${w.word} prin`, {
      mode: "quick",
      currentSpaceId: w.hidden.id,
    });
    expect(hiddenCurrent.results.map((hit) => hit.itemId).sort()).toEqual([w.alpha, w.gamma].sort());
    const finished = await find(w.other, w.org.id, `${w.word} prin `, { mode: "quick" });
    expect(finished.results).toEqual([]);
  });

  it("tolerates typos in longer words", async () => {
    const w = await world();
    expect(await ids(w.other, w.org.id, `${w.word} cartrige`)).toEqual([w.gamma]);
  });

  it("looks for similar words only when a search finds fewer than five results", async () => {
    const org = await organization();
    const authorId = await member(org.id, "member", "Typo Author");
    const author = accountPrincipal(authorId);
    const created = await space(org.id, authorId, { visibility: "organization" });
    const stem = `cartridg${Math.random()
      .toString(36)
      .slice(2, 8)
      .replace(/[^a-z]/g, "")}`;
    const add = (title: string, text: string) =>
      test.services.tree.create(author, created.id, {
        kind: "page",
        title,
        mode: "live",
        placement: { parentId: null },
        document: doc(paragraph(text)),
      });
    const near = await add("Near", `${stem}x spare`);
    const first = await add("One", `${stem}e spare`);
    await drain();
    expect((await ids(author, org.id, `${stem}e`)).sort()).toEqual([first.id, near.id].sort());
    for (let index = 0; index < 5; index++) await add(`More ${index}`, `${stem}e spare`);
    await drain();
    const many = await ids(author, org.id, `${stem}e`);
    expect(many).toHaveLength(6);
    expect(many).not.toContain(near.id);
  });

  it("keeps the words used to correct typos per organization", async () => {
    const w = await world();
    const unique = `zephyr${w.word.replace(/[^a-z]/g, "")}`;
    const elsewhere = await organization();
    const ownerId = await member(elsewhere.id, "member", "Elsewhere");
    const other = await space(elsewhere.id, ownerId, { visibility: "organization" });
    await test.services.tree.create(accountPrincipal(ownerId), other.id, {
      kind: "page",
      title: "Elsewhere",
      mode: "live",
      placement: { parentId: null },
      document: doc(paragraph(unique)),
    });
    await drain();
    const rows = await test.pool.query<{ organization_id: string }>(
      "select organization_id from search_terms where word = $1",
      [unique],
    );
    expect(rows.rows.map((row) => row.organization_id)).toEqual([elsewhere.id]);
  });

  it("forgets the words of content that is changed or deleted for good, but keeps shared words", async () => {
    const w = await world();
    const letters = w.word.replace(/[^a-z]/g, "");
    const [kept, edited, purged, shared] = ["kept", "edited", "purged", "shared"].map(
      (word) => `${word}${letters}`,
    );
    const create = async (title: string, text: string) =>
      test.services.tree.create(w.author, w.shared.id, {
        kind: "page",
        title,
        mode: "live",
        placement: { parentId: null },
        document: doc(paragraph(text)),
      });
    const first = await create("First", `${kept} ${edited} ${shared}`);
    const second = await create("Second", `${purged} ${shared}`);
    await drain();
    const terms = async () =>
      (
        await test.pool.query<{ word: string }>(
          "select word from search_terms where organization_id = $1 and word like any($2) order by word",
          [w.org.id, [kept, edited, purged, shared]],
        )
      ).rows.map((row) => row.word);
    expect(await terms()).toEqual([edited, kept, purged, shared].sort());

    await test.services.documents.replace(w.author, first.id, doc(paragraph(`${kept} ${shared}`)));
    await test.pool.query("update search_pending_items set due_at = now() where item_id = $1", [first.id]);
    await drain();
    expect(await terms()).toEqual([kept, purged, shared].sort());

    const entry = await test.services.trash.deleteItem(w.author, second.id);
    await test.services.trash.deleteImmediately(accountPrincipal(w.org.owner), entry.id, "Erasure request");
    expect(await terms()).toEqual([kept, shared].sort());
  });

  it("corrects typos only with words of content the person can read and suggests only those", async () => {
    const w = await world();
    for (const word of ["cartrigea", "cartrigeb", "cartrigec"]) {
      await test.services.tree.create(w.author, w.hidden.id, {
        kind: "page",
        title: "Hidden draft",
        mode: "live",
        placement: { parentId: null },
        document: doc(paragraph(`${w.word} ${word} confidential`)),
      });
    }
    await drain();
    expect(await ids(w.other, w.org.id, `${w.word} cartrige`)).toEqual([w.gamma]);
    expect((await find(w.other, w.org.id, `${w.word} cartrige`)).suggestion).toBe(`${w.word} cartridge`);
    expect((await find(w.author, w.org.id, `${w.word} cartrige`)).suggestion).toBe(`${w.word} cartrigea`);

    const hiddenWord = await find(w.other, w.org.id, "confidentail");
    const unknownWord = await find(w.other, w.org.id, "qwertzuiop");
    expect({ ...hiddenWord, index: null }).toEqual({ ...unknownWord, index: null });
    expect(hiddenWord).toMatchObject({ results: [], total: 0, suggestion: null });
    expect((await find(w.author, w.org.id, "confidentail")).suggestion).toBe("confidential");

    expect((await find(w.other, w.org.id, `${w.word} printer`)).suggestion).toBeNull();
    expect((await find(w.other, w.org.id, `${w.word} cartrige`, { mode: "quick" })).suggestion).toBeNull();
  });

  it("suggests only word forms that occur in content the person can read", async () => {
    const w = await world();
    await test.services.tree.create(w.author, w.hidden.id, {
      kind: "page",
      title: "Hidden notes",
      mode: "live",
      placement: { parentId: null },
      document: doc(paragraph(`${w.word} cartridges`)),
    });
    await drain();
    expect((await find(w.author, w.org.id, "cartridgess")).suggestion).toBe("cartridges");
    expect((await find(w.other, w.org.id, "cartridgess")).suggestion).toBe("cartridge");
  });

  it("builds the suggested search text from the corrected words only", () => {
    const corrections = new Map([["cartrige", "cartridge"]]);
    expect(correctedQuery('Cartrige "cartrige ink" -cartrige label:cartrige', corrections)).toBe(
      'cartridge "cartrige ink" -cartrige label:cartrige',
    );
    expect(correctedQuery("printer", corrections)).toBeNull();
    expect(correctedQuery("cartrige", new Map())).toBeNull();
  });

  function recordingSearch() {
    const adapter = new PostgresSearchAdapter();
    const requests: AdapterSearch[] = [];
    const recording: SearchAdapter = {
      replaceItem: adapter.replaceItem.bind(adapter),
      removeItem: adapter.removeItem.bind(adapter),
      updateAccess: adapter.updateAccess.bind(adapter),
      updateContextAccess: adapter.updateContextAccess.bind(adapter),
      indexedItemsOfSpace: adapter.indexedItemsOfSpace.bind(adapter),
      articles: adapter.articles.bind(adapter),
      articleCounts: adapter.articleCounts.bind(adapter),
      languageCounts: adapter.languageCounts.bind(adapter),
      search: (executor, request) => {
        requests.push(request);
        return adapter.search(executor, request);
      },
    };
    const service = new SearchService({
      database: test.database,
      authorization: test.services.authorization,
      people: test.services.people,
      adapter: recording,
      indexer: test.services.search.indexer,
    });
    return { service, requests };
  }

  it("lists and counts only the most recently changed matches above the limit", async () => {
    const w = await world();
    const bounded = new SearchService({
      database: test.database,
      authorization: test.services.authorization,
      people: test.services.people,
      adapter: new PostgresSearchAdapter({ matchCap: 2 }),
      indexer: test.services.search.indexer,
    });
    const full = await find(w.other, w.org.id, w.word);
    const limited = await bounded.search(w.other, w.org.id, searchRequest(w.word));
    expect(full).toMatchObject({ total: 3, totalCapped: false });
    expect(limited).toMatchObject({ total: 2, totalCapped: true });
    expect(limited.results.map((hit) => hit.itemId).sort()).toEqual([w.beta, w.gamma].sort());
    expect(limited.facets?.contentTypes).toEqual([{ value: "page", count: 2 }]);
    const spaces = limited.facets?.spaces ?? [];
    expect(spaces.map((facet) => facet.value)).not.toContain(w.hidden.id);
    expect(spaces.reduce((sum, facet) => sum + facet.count, 0)).toBe(2);
  });

  it("keeps the counts of the other filters complete when a filter picks few of many matches", async () => {
    const w = await world();
    for (const picked of [w.shared.id, w.second.id]) {
      const filtered = searchRequest(w.word, { spaceIds: [picked] });
      const full = await test.services.search.search(w.other, w.org.id, filtered);
      const bounded = new SearchService({
        database: test.database,
        authorization: test.services.authorization,
        people: test.services.people,
        adapter: new PostgresSearchAdapter({ matchCap: full.total }),
        indexer: test.services.search.indexer,
      });
      const limited = await bounded.search(w.other, w.org.id, filtered);
      expect(full.total).toBeGreaterThan(0);
      expect(limited.facets?.contentTypes).toEqual(full.facets?.contentTypes);
      expect(limited.facets?.authors).toEqual(full.facets?.authors);
      expect(limited.totalCapped).toBe(false);
    }
  });

  it("keeps the other values of a used filter in the counts when more matches pass it than the limit", async () => {
    const w = await world();
    const bounded = new SearchService({
      database: test.database,
      authorization: test.services.authorization,
      people: test.services.people,
      adapter: new PostgresSearchAdapter({ matchCap: 1 }),
      indexer: test.services.search.indexer,
    });
    const limited = await bounded.search(
      w.other,
      w.org.id,
      searchRequest(w.word, { spaceIds: [w.shared.id] }),
    );
    expect(limited).toMatchObject({ total: 1, totalCapped: true });
    const counted = new Map((limited.facets?.spaces ?? []).map((facet) => [facet.value, facet.count]));
    expect(counted.get(w.shared.id)).toBeGreaterThan(0);
    expect(counted.get(w.second.id)).toBe(1);
    expect(counted.has(w.hidden.id)).toBe(false);
  });

  it("looks up status names in spaces the person can see only", async () => {
    const w = await world();
    const statuses = test.services.pageStatus;
    const [, , , sharedVerified] = await statuses.values(SYSTEM, w.shared.id);
    const [, , , hiddenVerified] = await statuses.values(SYSTEM, w.hidden.id);
    await statuses.update(w.author, w.shared.id, sharedVerified?.id ?? "", { name: `Classified ${w.word}` });
    await statuses.update(w.author, w.hidden.id, hiddenVerified?.id ?? "", { name: `Secret ${w.word}` });
    const { service, requests } = recordingSearch();
    await service.search(w.other, w.org.id, searchRequest(`status:"Classified ${w.word}"`));
    expect(requests.map((request) => request.filters.statusIds)).toEqual([[sharedVerified?.id]]);

    requests.length = 0;
    const hiddenName = await service.search(
      w.other,
      w.org.id,
      searchRequest(`${w.word} status:"Secret ${w.word}"`),
    );
    const unknownName = await service.search(
      w.other,
      w.org.id,
      searchRequest(`${w.word} status:"None ${w.word}"`),
    );
    expect(requests).toEqual([]);
    expect({ ...hiddenName, index: null }).toEqual({ ...unknownName, index: null });
    requests.length = 0;
    await service.search(w.author, w.org.id, searchRequest(`status:"Secret ${w.word}"`));
    expect(requests.map((request) => request.filters.statusIds)).toEqual([[hiddenVerified?.id]]);
    await statuses.update(w.author, w.hidden.id, hiddenVerified?.id ?? "", { name: `Classified ${w.word}` });
    requests.length = 0;
    await service.search(w.other, w.org.id, searchRequest(`status:"Classified ${w.word}"`));
    expect(requests.map((request) => request.filters.statusIds)).toEqual([[sharedVerified?.id]]);
  });

  it("filters by author IDs only of people the person can see", async () => {
    const w = await world();
    const leaverId = await member(w.org.id, "member", "Lea Leaver");
    const open = await space(w.org.id, w.authorId, {
      visibility: "organization",
      grants: [{ principalKind: "account", principalId: leaverId, role: "editor" }],
    });
    const left = await test.services.tree.create(accountPrincipal(leaverId), open.id, {
      kind: "page",
      title: "Left behind",
      mode: "live",
      placement: { parentId: null },
      document: doc(paragraph(`${w.word} handover`)),
    });
    await drain();
    expect(await ids(w.other, w.org.id, w.word, { authorIds: [leaverId] })).toEqual([left.id]);

    await test.pool.query("delete from space_permissions where principal_id = $1", [leaverId]);
    await test.pool.query(
      "update memberships set expires_at = now() - interval '1 day' where account_id = $1",
      [leaverId],
    );
    await drain();
    expect(await test.services.people.canSee(w.other, leaverId)).toBe(false);
    expect(await ids(w.other, w.org.id, `${w.word} handover`)).toEqual([left.id]);
    const invisible = await find(w.other, w.org.id, w.word, { authorIds: [leaverId] });
    const unknown = await find(w.other, w.org.id, w.word, { authorIds: [randomUUID()] });
    expect({ ...invisible, index: null }).toEqual({ ...unknown, index: null });
    expect(invisible.results).toEqual([]);
    expect(await ids(w.author, w.org.id, w.word, { authorIds: [w.otherId, leaverId] })).toEqual([w.beta]);
  });

  it("filters by page status and follows changes of status, values and the space setting", async () => {
    const w = await world();
    const statuses = test.services.pageStatus;
    const [, inProgress, , verified] = await statuses.values(SYSTEM, w.shared.id);
    const [, , , secondVerified] = await statuses.values(SYSTEM, w.second.id);
    await statuses.set(w.author, w.alpha, verified?.id ?? "");
    await statuses.set(w.author, w.beta, inProgress?.id ?? "");
    await statuses.set(w.author, w.gamma, secondVerified?.id ?? "");
    await drain();
    expect(await ids(w.other, w.org.id, `${w.word} status:verified`)).toEqual([w.alpha, w.gamma].sort());
    expect(await ids(w.other, w.org.id, `${w.word} status:"in progress"`)).toEqual([w.beta]);
    expect(await ids(w.other, w.org.id, w.word, { statusIds: [verified?.id] })).toEqual([w.alpha]);
    expect(await ids(w.other, w.org.id, `${w.word} status:unknown`)).toEqual([]);
    const all = await find(w.other, w.org.id, w.word);
    expect(all.results.find((hit) => hit.itemId === w.alpha)?.status).toEqual({
      id: verified?.id,
      builtIn: "verified",
      name: null,
      color: "success",
    });
    expect(all.facets?.statuses.map((facet) => [facet.builtIn, facet.count]).sort()).toEqual([
      ["inProgress", 1],
      ["verified", 1],
      ["verified", 1],
    ]);

    await statuses.set(w.author, w.beta, verified?.id ?? "");
    await drain();
    expect(await ids(w.other, w.org.id, `${w.word} status:verified`)).toEqual(
      [w.alpha, w.beta, w.gamma].sort(),
    );

    await statuses.update(w.author, w.shared.id, verified?.id ?? "", { name: "Approved" });
    await drain();
    expect(await ids(w.other, w.org.id, `${w.word} status:approved`)).toEqual([w.alpha, w.beta].sort());
    expect(await ids(w.other, w.org.id, `${w.word} status:verified`)).toEqual([w.gamma]);
    const renamed = await find(w.other, w.org.id, w.word, { statusIds: [verified?.id] });
    expect(renamed.results.map((hit) => hit.status?.name)).toEqual(["Approved", "Approved"]);

    await statuses.remove(w.author, w.shared.id, verified?.id ?? "", 2);
    await drain();
    expect(await ids(w.other, w.org.id, w.word, { statusIds: [verified?.id] })).toEqual([]);
    const stored = await test.pool.query<{ status: string | null }>(
      "select status from search_chunks where item_id = any($1::uuid[])",
      [[w.alpha, w.beta]],
    );
    expect(stored.rows.every((row) => row.status === null)).toBe(true);

    await test.settings.set(pageStatusEnabledSetting, { space: w.second.id }, "space", false);
    const hidden = await find(w.other, w.org.id, w.word, { spaceIds: [w.second.id] });
    expect(hidden.results.map((hit) => hit.status)).toEqual([null]);
    expect(hidden.facets?.statuses).toEqual([]);
    await drain();
    expect(await ids(w.other, w.org.id, w.word, { statusIds: [secondVerified?.id] })).toEqual([]);
    await test.settings.set(pageStatusEnabledSetting, { space: w.second.id }, "space", true);
    await drain();
    expect(await ids(w.other, w.org.id, w.word, { statusIds: [secondVerified?.id] })).toEqual([w.gamma]);
  });

  it("indexes a page moved to another space with the status of that space", async () => {
    const w = await world();
    const statuses = test.services.pageStatus;
    const [, sharedInProgress] = await statuses.values(SYSTEM, w.shared.id);
    const [, secondInProgress] = await statuses.values(SYSTEM, w.second.id);
    const hold = await statuses.add(w.author, w.shared.id, { name: `Hold ${w.word}`, color: "danger" });
    await statuses.set(w.author, w.alpha, hold.id);
    await statuses.set(w.author, w.beta, sharedInProgress?.id ?? "");
    await drain();
    for (const itemId of [w.alpha, w.beta]) {
      const impact = await test.services.tree.moveImpact(w.author, itemId, {
        spaceId: w.second.id,
        parentId: null,
      });
      await test.services.tree.move(w.author, itemId, {
        spaceId: w.second.id,
        parentId: null,
        confirmation: impact.confirmation ?? "",
      });
    }
    await drain();

    expect(await ids(w.author, w.org.id, w.word, { statusIds: [secondInProgress?.id] })).toEqual([w.beta]);
    expect(await ids(w.author, w.org.id, w.word, { statusIds: [sharedInProgress?.id] })).toEqual([]);
    expect(await ids(w.author, w.org.id, w.word, { statusIds: [hold.id] })).toEqual([]);
    const moved = await find(w.author, w.org.id, w.word, { spaceIds: [w.second.id] });
    expect(moved.results.find((hit) => hit.itemId === w.alpha)?.status).toBeNull();
  });

  it("finds pages of personal spaces for their owner and for people they are shared with", async () => {
    const w = await world();
    const personal = await test.services.personalSpaces.ensure(w.author, "Personal space");
    const diary = await test.services.tree.create(w.author, personal.id, {
      kind: "page",
      title: "Diary",
      mode: "live",
      placement: { parentId: null },
      document: doc(paragraph(`${w.word} personal notes`)),
    });
    await drain();
    const own = await find(w.author, w.org.id, `${w.word} personal`);
    expect(own.results.map((hit) => hit.itemId)).toEqual([diary.id]);
    expect(own.results[0]?.space).toMatchObject({ id: personal.id, personal: true, mine: true });
    expect(own.facets?.spaces).toEqual([
      {
        value: personal.id,
        count: 1,
        key: personal.key,
        name: personal.name,
        displayName: personal.displayName,
        personal: true,
        mine: true,
      },
    ]);
    const elsewhere = await organization();
    await join(elsewhere.id, w.authorId);
    expect(await ids(w.author, elsewhere.id, `${w.word} personal`)).toEqual([diary.id]);
    expect(await ids(w.other, w.org.id, `${w.word} personal`)).toEqual([]);

    await test.pool.query(
      `insert into page_shares (id, item_id, principal_kind, principal_id, role, include_descendants)
       values ($1, $2, 'account', $3, 'reader', false)`,
      [randomUUID(), diary.id, w.otherId],
    );
    await drain();
    const shared = await find(w.other, w.org.id, `${w.word} personal`);
    expect(shared.results.map((hit) => [hit.itemId, hit.sharedWithYou, hit.space])).toEqual([
      [diary.id, true, null],
    ]);
    expect(await ids(w.outsider, w.org.id, `${w.word} personal`)).toEqual([]);

    const scoped = {
      type: "account" as const,
      id: w.authorId,
      token: { id: "token", organizationId: w.org.id, scopes: { organization: { spaces: "view" as const } } },
    };
    expect(await ids(scoped, w.org.id, `${w.word} personal`)).toEqual([]);
  });

  it("finds nothing for an API token without access to spaces or for another organization", async () => {
    const w = await world();
    const token = {
      type: "account" as const,
      id: w.otherId,
      token: {
        id: "token",
        organizationId: w.org.id,
        scopes: { organization: { auditLog: "view" as const } },
      },
    };
    expect(await ids(token, w.org.id, w.word)).toEqual([]);
    const scoped = {
      ...token,
      token: { ...token.token, scopes: { organization: { spaces: "view" as const } } },
    };
    expect(await ids(scoped, w.org.id, w.word)).toHaveLength(3);
    const elsewhere = { ...scoped, token: { ...scoped.token, organizationId: (await organization()).id } };
    expect(await ids(elsewhere, w.org.id, w.word)).toEqual([]);
  });
  it("filters by content language and counts results per language", async () => {
    const w = await world();
    await test.services.tree.setContentLanguage(w.author, w.gamma, "de");
    await drain();
    const all = await find(w.other, w.org.id, w.word);
    expect(all.facets?.languages).toEqual(
      expect.arrayContaining([
        { value: "de", count: 1 },
        { value: expect.not.stringMatching(/^de$/), count: 2 },
      ]),
    );
    expect(await ids(w.other, w.org.id, w.word, { languages: ["de"] })).toEqual([w.gamma]);
  });

  it("counts each filter group as if its own filter were not set", async () => {
    const w = await world();
    const result = await find(w.other, w.org.id, w.word, { spaceIds: [w.second.id] });
    expect(result.total).toBe(1);
    expect(result.facets?.spaces.map((facet) => [facet.value, facet.count]).sort()).toEqual(
      [
        [w.shared.id, 2],
        [w.second.id, 1],
      ].sort(),
    );
    expect(result.facets?.authors.map((facet) => [facet.name, facet.count])).toEqual([["Ada Author", 1]]);
    expect(result.facets?.contentTypes).toEqual([{ value: "page", count: 1 }]);
  });

  it("counts results changed within the last week, month and year", async () => {
    const w = await world();
    await test.pool.query(
      "update search_chunks set content_updated_at = now() - interval '40 days' where item_id = $1",
      [w.gamma],
    );
    const result = await find(w.other, w.org.id, w.word);
    expect(result.facets?.updated).toEqual([
      { value: "week", count: 2 },
      { value: "month", count: 2 },
      { value: "year", count: 3 },
    ]);
    const recent = await find(w.other, w.org.id, w.word, {
      updatedAfter: new Date(Date.now() - 7 * 86_400_000),
    });
    expect(recent.total).toBe(2);
    expect(recent.facets?.updated).toEqual(result.facets?.updated);
  });

  it("ranks content the person used recently and often slightly higher in quick search only", async () => {
    const w = await world();
    const text = `${w.word} identical words`;
    const create = async (title: string) => {
      const created = await test.services.tree.create(w.author, w.shared.id, {
        kind: "page",
        title,
        mode: "live",
        placement: { parentId: null },
        document: doc(paragraph(text)),
      });
      return created.id;
    };
    const older = await create("Same title");
    const newer = await create("Same title");
    await drain();
    const query = `${w.word} identical `;
    const quick = { mode: "quick" };
    const before = await find(w.other, w.org.id, query, quick);
    expect(before.results.map((hit) => hit.itemId)).toEqual([newer, older]);
    for (let view = 0; view < 3; view += 1) await test.services.home.recordView(w.other, older);
    const after = await find(w.other, w.org.id, query, quick);
    expect(after.results.map((hit) => hit.itemId)).toEqual([older, newer]);
    expect((await find(w.author, w.org.id, query, quick)).results.map((hit) => hit.itemId)).toEqual([
      newer,
      older,
    ]);
    expect((await find(w.other, w.org.id, query)).results.map((hit) => hit.itemId)).toEqual([newer, older]);
  });

  it("keeps the pages of the search page stable while the person opens results", async () => {
    const w = await world();
    const ids: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      const created = await test.services.tree.create(w.author, w.shared.id, {
        kind: "page",
        title: "Same title",
        mode: "live",
        placement: { parentId: null },
        document: doc(paragraph(`${w.word} identical words`)),
      });
      ids.push(created.id);
    }
    await drain();
    const query = `${w.word} identical`;
    const first = await find(w.other, w.org.id, query, { limit: 1 });
    expect(first.results.map((hit) => hit.itemId)).toEqual([ids[2]]);
    const seen = [...first.results.map((hit) => hit.itemId)];
    let cursor = first.nextCursor;
    for (const opened of [ids[0], ids[2]]) {
      for (let view = 0; view < 5; view += 1) await test.services.home.recordView(w.other, opened as string);
      const page = await find(w.other, w.org.id, query, { limit: 1, cursor });
      seen.push(...page.results.map((hit) => hit.itemId));
      cursor = page.nextCursor;
    }
    expect(cursor).toBeNull();
    expect(seen).toEqual([ids[2], ids[1], ids[0]]);
  });
});
