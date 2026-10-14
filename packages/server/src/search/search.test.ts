import { randomUUID } from "node:crypto";
import type { DocumentJson, NodeJson } from "@pagehall/editor-schema";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accountPrincipal, type Principal } from "../accounts/principal.js";
import { pageStatusEnabledSetting } from "../spaces/settings.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { spaceFixtures } from "../testing/spaces.js";
import { searchRequest } from "./search.testing.js";
import { correctedQuery } from "./service.js";

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
        { value: w.shared.id, count: 2, key: w.shared.key, name: "Shared space", personal: false },
        { value: w.second.id, count: 1, key: w.second.key, name: "Second space", personal: false },
      ]),
    );
    expect(result.facets?.authors.map((facet) => [facet.name, facet.count]).sort()).toEqual([
      ["Ada Author", 2],
      ["Otto Other", 1],
    ]);
    const outsider = await find(w.outsider, w.org.id, w.word);
    expect(outsider.total).toBe(0);
    expect(outsider.facets).toEqual({ contentTypes: [], spaces: [], labels: [], authors: [], statuses: [] });
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

  it("builds the suggested search text from the corrected words only", () => {
    const corrections = new Map([["cartrige", "cartridge"]]);
    expect(correctedQuery('Cartrige "cartrige ink" -cartrige label:cartrige', corrections)).toBe(
      'cartridge "cartrige ink" -cartrige label:cartrige',
    );
    expect(correctedQuery("printer", corrections)).toBeNull();
    expect(correctedQuery("cartrige", new Map())).toBeNull();
  });

  it("filters by page status and follows changes of status, values and the space setting", async () => {
    const w = await world();
    const statuses = test.services.pageStatus;
    const [, inProgress, , verified] = await statuses.values(w.shared.id);
    const [, , , secondVerified] = await statuses.values(w.second.id);
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
    expect(own.results[0]?.space).toMatchObject({ id: personal.id, personal: true });
    expect(own.facets?.spaces).toEqual([
      { value: personal.id, count: 1, key: personal.key, name: personal.name, personal: true },
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
});
