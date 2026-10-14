import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accountPrincipal, SYSTEM } from "../accounts/principal.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { spaceFixtures } from "../testing/spaces.js";
import {
  RECENT_SEARCH_LIMIT,
  SAVED_SEARCH_LIMIT,
  SavedSearchLimitError,
  SavedSearchNameError,
  type SearchFilterValues,
  searchFiltersSchema,
} from "./saved-searches.js";

const baseUrl = testDatabaseBaseUrl();

function filters(values: Partial<SearchFilterValues> = {}): SearchFilterValues {
  return searchFiltersSchema.parse(values);
}

describe.skipIf(!baseUrl)("recent and saved searches", () => {
  let test: TestServices;
  const { organization, member, join } = spaceFixtures(() => test);

  beforeAll(async () => {
    test = await createTestServices(baseUrl ?? "");
    await test.pool.query("insert into instance (id, setup_completed_at) values (1, now())");
  });

  afterAll(async () => {
    await test?.close();
  });

  async function people() {
    const org = await organization();
    const owner = accountPrincipal(await member(org.id, "member", "Owner"));
    const other = accountPrincipal(await member(org.id, "member", "Other"));
    return { org, owner, other };
  }

  it("keeps the last ten searches per person, newest first, without duplicates", async () => {
    const { org, owner } = await people();
    const searches = test.services.savedSearches;
    for (let index = 0; index < RECENT_SEARCH_LIMIT + 3; index += 1) {
      await searches.remember(owner, org.id, `query ${index}`, filters());
    }
    await searches.remember(owner, org.id, "  query 5 ", filters());
    const recent = await searches.recent(owner, org.id);
    expect(recent).toHaveLength(RECENT_SEARCH_LIMIT);
    expect(recent[0]?.query).toBe("query 5");
    expect(recent.filter((entry) => entry.query === "query 5")).toHaveLength(1);
    expect(recent.map((entry) => entry.query)).not.toContain("query 0");
    const rows = await test.pool.query<{ n: number }>(
      "select count(*)::int as n from recent_searches where organization_id = $1",
      [org.id],
    );
    expect(rows.rows[0]?.n).toBe(RECENT_SEARCH_LIMIT);
  });

  it("treats the same query with other filters as another search and ignores empty queries", async () => {
    const { org, owner } = await people();
    const searches = test.services.savedSearches;
    await searches.remember(owner, org.id, "vpn", filters());
    await searches.remember(owner, org.id, "vpn", filters({ labels: ["runbook"] }));
    await searches.remember(owner, org.id, "vpn", filters({ labels: ["runbook", "runbook"] }));
    expect(await searches.remember(owner, org.id, "   ", filters())).toBeNull();
    const recent = await searches.recent(owner, org.id);
    expect(recent.map((entry) => entry.filters.labels)).toEqual([["runbook"], []]);
  });

  it("shows recent searches only to the person who searched, in the organization they searched in", async () => {
    const { org, owner, other } = await people();
    const elsewhere = await organization();
    await join(elsewhere.id, owner.id);
    const searches = test.services.savedSearches;
    const own = await searches.remember(owner, org.id, "private words", filters());
    expect(await searches.recent(other, org.id)).toEqual([]);
    expect(await searches.recent(owner, elsewhere.id)).toEqual([]);
    expect(await searches.forget(other, org.id, own?.id ?? "")).toBe(false);
    await searches.forgetAll(other, org.id);
    expect(await searches.recent(owner, org.id)).toHaveLength(1);
    expect(await searches.forget(owner, elsewhere.id, own?.id ?? "")).toBe(false);
    expect(await searches.forget(owner, org.id, own?.id ?? "")).toBe(true);
    expect(await searches.recent(owner, org.id)).toEqual([]);
  });

  it("deletes all recent searches of the caller at once and leaves those of others", async () => {
    const { org, owner, other } = await people();
    const searches = test.services.savedSearches;
    await searches.remember(owner, org.id, "one", filters());
    await searches.remember(owner, org.id, "two", filters());
    await searches.remember(other, org.id, "theirs", filters());
    await searches.forgetAll(owner, org.id);
    expect(await searches.recent(owner, org.id)).toEqual([]);
    expect((await searches.recent(other, org.id)).map((entry) => entry.query)).toEqual(["theirs"]);
  });

  it("keeps two simultaneous recordings of new searches within the limit", async () => {
    const { org, owner } = await people();
    const searches = test.services.savedSearches;
    await Promise.all(
      Array.from({ length: RECENT_SEARCH_LIMIT * 2 }, (_, index) =>
        searches.remember(owner, org.id, `parallel ${index}`, filters()),
      ),
    );
    expect(await searches.recent(owner, org.id)).toHaveLength(RECENT_SEARCH_LIMIT);
    const rows = await test.pool.query<{ n: number }>(
      "select count(*)::int as n from recent_searches where organization_id = $1",
      [org.id],
    );
    expect(rows.rows[0]?.n).toBe(RECENT_SEARCH_LIMIT);
  });

  it("saves, renames and deletes searches that only their owner sees", async () => {
    const { org, owner, other } = await people();
    const searches = test.services.savedSearches;
    const saved = await searches.save(owner, org.id, {
      name: "  Runbooks to verify ",
      query: "label:runbook",
      filters: filters({ sort: "newest", updated: "month" }),
    });
    expect(saved).toMatchObject({ name: "Runbooks to verify", query: "label:runbook" });
    expect(saved.filters).toMatchObject({ sort: "newest", updated: "month" });
    expect(await searches.saved(other, org.id)).toEqual([]);
    expect(await searches.update(other, org.id, saved.id, { name: "Taken over" })).toBeNull();
    expect(await searches.remove(other, org.id, saved.id)).toBe(false);
    const renamed = await searches.update(owner, org.id, saved.id, { name: "Verify runbooks" });
    expect(renamed?.name).toBe("Verify runbooks");
    expect((await searches.saved(owner, org.id)).map((entry) => entry.name)).toEqual(["Verify runbooks"]);
    expect(await searches.remove(owner, org.id, saved.id)).toBe(true);
    expect(await searches.saved(owner, org.id)).toEqual([]);
  });

  it("refuses empty names and more than the limit of saved searches", async () => {
    const { org, owner } = await people();
    const searches = test.services.savedSearches;
    await expect(
      searches.save(owner, org.id, { name: "  ", query: "x", filters: filters() }),
    ).rejects.toThrow(SavedSearchNameError);
    await test.pool.query(
      `insert into saved_searches (id, organization_id, account_id, name, query, filters)
       select gen_random_uuid(), $1, $2, 'Saved ' || n, 'q', '{}'::jsonb from generate_series(1, $3) n`,
      [org.id, owner.id, SAVED_SEARCH_LIMIT],
    );
    await expect(
      searches.save(owner, org.id, { name: "One more", query: "x", filters: filters() }),
    ).rejects.toThrow(SavedSearchLimitError);
  });

  it("forgets recent and saved searches when the membership ends", async () => {
    const { org, owner, other } = await people();
    const elsewhere = await organization();
    await join(elsewhere.id, owner.id);
    const searches = test.services.savedSearches;
    await searches.remember(owner, org.id, "before leaving", filters());
    await searches.save(owner, org.id, { name: "Mine", query: "q", filters: filters() });
    await searches.remember(owner, elsewhere.id, "kept", filters());
    await searches.remember(other, org.id, "theirs", filters());
    await test.services.memberships.remove(SYSTEM, org.id, owner.id, "removed", { releaseHome: true });
    const rows = await test.pool.query<{ query: string }>(
      `select query from recent_searches where account_id = $1
       union all select query from saved_searches where account_id = $1`,
      [owner.id],
    );
    expect(rows.rows.map((row) => row.query)).toEqual(["kept"]);
    expect((await searches.recent(other, org.id)).map((entry) => entry.query)).toEqual(["theirs"]);
  });
});
