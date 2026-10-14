import type { DocumentJson, NodeJson } from "@pagehall/editor-schema";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accountPrincipal, type Principal } from "../accounts/principal.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { spaceFixtures } from "../testing/spaces.js";
import { searchRequest } from "./search.testing.js";

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
  const { organization, member, space } = spaceFixtures(() => test);

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
        { value: w.shared.id, count: 2, key: w.shared.key, name: "Shared space" },
        { value: w.second.id, count: 1, key: w.second.key, name: "Second space" },
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
