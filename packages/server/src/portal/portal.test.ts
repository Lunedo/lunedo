import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ANONYMOUS, accountPrincipal, SYSTEM } from "../accounts/principal.js";
import { generateToken } from "../auth/tokens.js";
import type { KnowledgeBaseAudience } from "../spaces/schema.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { spaceFixtures } from "../testing/spaces.js";
import { checkBrand } from "./portals.js";
import { PortalSessionService } from "./sessions.js";
import { cleanFeedback, normalizeTerm, PortalStatistics } from "./statistics.js";

const baseUrl = testDatabaseBaseUrl();
const paragraph = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });

describe("statistics values", () => {
  it("normalizes search terms and feedback without changing their meaning", () => {
    expect(normalizeTerm("  VPN   Zugang\n")).toBe("vpn zugang");
    expect(normalizeTerm("   ")).toBeNull();
    expect(normalizeTerm("x".repeat(300))?.length).toBe(200);
    expect(cleanFeedback(" Schritt 2\nfehlt \u0007")).toBe("Schritt 2\nfehlt");
    expect(cleanFeedback("\u0000")).toBeNull();
  });

  it("accepts every palette color in light and dark mode", () => {
    for (const color of ["petrol", "blue", "violet", "amber", "red", "green", "gray"] as const) {
      const checks = checkBrand({ color, light: null, dark: null });
      expect(checks.light.passes, `${color} light`).toBe(true);
      expect(checks.dark.passes, `${color} dark`).toBe(true);
    }
  });
});

describe.skipIf(!baseUrl)("knowledge base portal", () => {
  let test: TestServices;
  const fixtures = spaceFixtures(() => test);
  const { organization, member, group, space, account, join } = fixtures;

  beforeAll(async () => {
    test = await createTestServices(baseUrl ?? "");
    await test.pool.query("insert into instance (id, setup_completed_at) values (1, now())");
  });

  afterAll(async () => {
    await test?.close();
  });

  async function knowledgeBase(organizationId: string, creator: string, audience: KnowledgeBaseAudience) {
    const name = `Help ${randomUUID().slice(0, 8)}`;
    return test.services.spaces.create(
      accountPrincipal(creator),
      organizationId,
      { name, key: await test.services.spaces.suggestKey(name), type: "knowledgeBase", audience, grants: [] },
      test.services.spacePermissions.holders,
    );
  }

  async function portalAccount(organizationId: string): Promise<string> {
    const id = randomUUID();
    await test.database.execute(sql`
      insert into accounts (id, type, state, email, name)
      values (${id}, 'portal', 'active', ${`${id}@portal.example.org`}, 'Reader')`);
    await join(organizationId, id, "guest");
    return id;
  }

  async function publishedPage(actor: string, spaceId: string, title: string, text: string) {
    const page = await test.services.tree.create(accountPrincipal(actor), spaceId, {
      kind: "page",
      title,
      placement: { parentId: null },
    });
    await test.services.documents.replace(accountPrincipal(actor), page.id, {
      type: "doc",
      content: [paragraph(text)],
    });
    const mode = await test.database.execute<{ mode: string }>(
      sql`select mode from tree_items where id = ${page.id}`,
    );
    if (mode.rows[0]?.mode === "publish")
      await test.services.versions.publish(accountPrincipal(actor), page.id);
    return page.id;
  }

  it("keeps portal accounts to knowledge bases in permissions, lists and search", async () => {
    const org = await organization();
    const reader = await portalAccount(org.id);
    const groupId = await group(org.id, [reader]);
    const internal = await space(org.id, org.owner, {
      grants: [{ principalKind: "group", principalId: groupId, role: "reader" }],
    });
    const kb = await knowledgeBase(org.id, org.owner, "signedIn");
    await test.services.spacePermissions.apply(accountPrincipal(org.owner), kb.id, {
      action: "grant",
      principalKind: "group",
      principalId: groupId,
      role: "reader",
    });
    const internalPage = await publishedPage(org.owner, internal.id, "Interne Seite", "geheimwort intern");
    const article = await publishedPage(org.owner, kb.id, "Artikel", "geheimwort artikel");
    await test.services.search.indexer.drain();
    const principal = accountPrincipal(reader);
    const decide = (id: string) =>
      test.services.authorization.decide(principal, "item.view", { type: "item", id }).then((d) => d.allowed);
    expect(await decide(internalPage)).toBe(false);
    expect(await decide(article)).toBe(true);
    const listed = await test.database.execute<{ id: string }>(sql`
      select t.id from tree_items t join spaces s on s.id = t.space_id
      where t.id in (${internalPage}, ${article})
        and ${test.services.authorization.itemFilter(principal, sql`t`, sql`s`)}`);
    expect(listed.rows.map((row) => row.id)).toEqual([article]);
    const results = await test.services.search.search(principal, org.id, {
      query: "geheimwort",
      mode: "full",
      spaceIds: [],
      contentTypes: [],
      labels: [],
      authorIds: [],
      statusIds: [],
      languages: [],
      includeArchived: false,
      updatedAfter: null,
      updatedBefore: null,
      sort: "relevance",
      limit: 20,
      cursor: null,
      currentSpaceId: null,
    });
    expect(results.results.map((hit) => hit.itemId)).toEqual([article]);
  });

  it("never lets a share reach a portal account", async () => {
    const org = await organization();
    const reader = await portalAccount(org.id);
    const kb = await knowledgeBase(org.id, org.owner, "signedIn");
    const article = await publishedPage(org.owner, kb.id, "Geteilt", "Text");
    await test.database.execute(sql`
      insert into page_shares (id, item_id, principal_kind, principal_id, role, created_by)
      values (${randomUUID()}, ${article}, 'account', ${reader}, 'reader', ${org.owner})`);
    const decision = await test.services.authorization.decide(accountPrincipal(reader), "item.view", {
      type: "item",
      id: article,
    });
    expect(decision.allowed).toBe(false);
    const config = await test.services.portals.config(kb.id);
    if (!config) throw new Error("missing config");
    expect(await test.services.portalReader.readable(accountPrincipal(reader), config, article)).toBe(false);
  });

  it("decides portal reading per audience for anonymous, members, group members and portal accounts", async () => {
    const org = await organization();
    const memberId = await member(org.id);
    const outsiderOrg = await organization();
    const outsider = await member(outsiderOrg.id);
    const groupMember = await member(org.id);
    const groupId = await group(org.id, [groupMember]);
    const reader = await portalAccount(org.id);
    const cases: [KnowledgeBaseAudience, Record<string, boolean>][] = [
      ["public", { anonymous: true, member: true, outsider: true, groupMember: true, portal: true }],
      ["signedIn", { anonymous: false, member: true, outsider: true, groupMember: true, portal: false }],
      ["groups", { anonymous: false, member: false, outsider: false, groupMember: true, portal: false }],
      ["portal", { anonymous: false, member: false, outsider: false, groupMember: false, portal: true }],
    ];
    for (const [audience, expected] of cases) {
      const kb = await knowledgeBase(org.id, org.owner, "signedIn");
      await test.services.knowledgeBases.changeAudience(accountPrincipal(org.owner), kb.id, {
        audience,
        groupIds: audience === "groups" ? [groupId] : [],
        confirmWidening: true,
      });
      const article = await publishedPage(org.owner, kb.id, "Artikel", "Text");
      const config = await test.services.portals.config(kb.id);
      if (!config) throw new Error("missing config");
      const readable = (principal: Parameters<typeof test.services.portalReader.readable>[0]) =>
        test.services.portalReader.readable(principal, config, article);
      expect(await readable(ANONYMOUS), `${audience} anonymous`).toBe(expected.anonymous);
      expect(await readable(accountPrincipal(memberId)), `${audience} member`).toBe(expected.member);
      expect(await readable(accountPrincipal(outsider)), `${audience} outsider`).toBe(expected.outsider);
      expect(await readable(accountPrincipal(groupMember)), `${audience} group member`).toBe(
        expected.groupMember,
      );
      expect(await readable(accountPrincipal(reader)), `${audience} portal`).toBe(expected.portal);
    }
  });

  it("validates portal addresses, keeps old paths as redirects and gives them up to a new owner", async () => {
    const org = await organization();
    const other = await organization();
    const first = await knowledgeBase(org.id, org.owner, "public");
    const second = await knowledgeBase(org.id, org.owner, "public");
    const actor = accountPrincipal(org.owner);
    const firstConfig = await test.services.portals.config(first.id);
    const secondConfig = await test.services.portals.config(second.id);
    if (!firstConfig || !secondConfig) throw new Error("missing config");
    await expect(
      test.services.portals.setAddress(actor, first.id, { path: "Kein Pfad", domain: null }),
    ).rejects.toMatchObject({
      code: "invalidPortalPath",
    });
    await expect(
      test.services.portals.setAddress(actor, first.id, { path: secondConfig.path, domain: null }),
    ).rejects.toMatchObject({ code: "portalPathTaken" });
    const fresh = `hilfe-${randomUUID().slice(0, 6)}`;
    await test.services.portals.setAddress(actor, first.id, { path: fresh, domain: null });
    expect(await test.services.portals.byPath(firstConfig.path)).toEqual({ type: "moved", path: fresh });
    await test.services.portals.setAddress(actor, second.id, { path: firstConfig.path, domain: null });
    const taken = await test.services.portals.byPath(firstConfig.path);
    expect(taken?.type === "found" && taken.config.spaceId).toBe(second.id);
    const foreign = await knowledgeBase(other.id, other.owner, "public");
    await expect(
      test.services.portals.setAddress(accountPrincipal(other.owner), foreign.id, {
        path: firstConfig.path,
        domain: null,
      }),
    ).rejects.toMatchObject({ code: "portalPathTaken" });
    await test.services.portals.setAddress(actor, second.id, { path: secondConfig.path, domain: null });
    await expect(
      test.services.portals.setAddress(accountPrincipal(other.owner), foreign.id, {
        path: firstConfig.path,
        domain: null,
      }),
    ).rejects.toMatchObject({ code: "portalPathTaken" });
    const domain = `kb-${randomUUID().slice(0, 6)}.example.org`;
    await expect(
      test.services.portals.setAddress(actor, first.id, { path: fresh, domain }),
    ).rejects.toMatchObject({ code: "portalDomainNotAllowed" });
    await test.services.portals.allowDomain(SYSTEM, { domain, organizationId: other.id });
    await expect(
      test.services.portals.setAddress(actor, first.id, { path: fresh, domain }),
    ).rejects.toMatchObject({ code: "portalDomainNotAllowed" });
    const own = `kb-${randomUUID().slice(0, 6)}.example.org`;
    await test.services.portals.allowDomain(SYSTEM, { domain: own, organizationId: org.id });
    await test.services.portals.setAddress(actor, first.id, { path: fresh, domain: own });
    await expect(
      test.services.portals.setAddress(actor, second.id, { path: firstConfig.path, domain: own }),
    ).rejects.toMatchObject({ code: "portalDomainTaken" });
    const audit = await test.database.execute<{ name: string }>(
      sql`select name from audit_events where target_id = ${first.id} and name = 'knowledgeBase.portalAddressChanged'`,
    );
    expect(audit.rows.length).toBe(2);
  });

  it("checks own brand colors and saves the proposed shade only after confirmation", async () => {
    const org = await organization();
    const kb = await knowledgeBase(org.id, org.owner, "public");
    await test.services.portals.updateAppearance(kb.id, {
      brand: { color: "blue", light: null, dark: null },
    });
    const passing = await test.services.portals.updateAppearance(kb.id, {
      brand: { color: "custom", light: "#1f4e99", dark: "#8AA8E6" },
    });
    expect(passing.brand).toEqual({ color: "custom", light: "#1F4E99", dark: "#8AA8E6" });
    const failing = { color: "custom" as const, light: "#FFB000", dark: "#1F4E99" };
    const refused = await test.services.portals
      .updateAppearance(kb.id, { brand: failing })
      .catch((error) => error);
    expect(refused).toMatchObject({ code: "brandContrast" });
    const proposal = refused.details as { light: { proposal: string }; dark: { proposal: string } };
    const unchanged = await test.services.portals.config(kb.id);
    expect(unchanged?.brand.light).toBe("#1F4E99");
    const confirmed = await test.services.portals.updateAppearance(kb.id, {
      brand: failing,
      confirmProposal: true,
    });
    expect(confirmed.brand).toEqual({
      color: "custom",
      light: proposal.light.proposal,
      dark: proposal.dark.proposal,
    });
  });

  it("hands a session to a domain once, bound to its state and domain, and ends with the instance session", async () => {
    const org = await organization();
    const accountId = await account();
    await join(org.id, accountId);
    const domain = `kb-${randomUUID().slice(0, 6)}.example.org`;
    await test.services.portals.allowDomain(SYSTEM, { domain, organizationId: org.id });
    const { session } = await test.database.transaction((tx) =>
      test.services.sessions.create(tx, {
        accountId,
        kind: "full",
        methods: ["password"],
        client: { ip: null } as never,
      }),
    );
    const state = generateToken();
    const code = await test.services.portalSessions.issueHandoff(session, domain, state);
    if (!code) throw new Error("no code");
    expect(await test.services.portalSessions.redeem(code, generateToken(), domain)).toBeNull();
    expect(await test.services.portalSessions.redeem(code, state, "other.example.org")).toBeNull();
    const token = await test.services.portalSessions.redeem(code, state, domain);
    expect(token).not.toBeNull();
    expect(await test.services.portalSessions.redeem(code, state, domain)).toBeNull();
    expect((await test.services.portalSessions.resolve(token ?? "", domain))?.id).toBe(session.id);
    expect(await test.services.portalSessions.resolve(token ?? "", "other.example.org")).toBeNull();
    const late = new PortalSessionService({
      database: test.database,
      sessions: test.services.sessions,
      clock: () => new Date(Date.now() + 120_000),
    });
    const lateState = generateToken();
    const lateCode = await test.services.portalSessions.issueHandoff(session, domain, lateState);
    expect(await late.redeem(lateCode ?? "", lateState, domain)).toBeNull();
    await test.services.sessions.endAll(test.database, accountId);
    expect(await test.services.portalSessions.resolve(token ?? "", domain)).toBeNull();
  });

  it("deletes free text when its retention ends, and at once when the retention gets shorter", async () => {
    const org = await organization();
    const kb = await knowledgeBase(org.id, org.owner, "public");
    const article = await publishedPage(org.owner, kb.id, "Artikel", "Text");
    const past = new PortalStatistics({
      database: test.database,
      clock: () => new Date("2025-01-10T10:00:00Z"),
    });
    await past.recordFeedback(kb.id, article, "Alter Hinweis");
    const statistics = test.services.portalStatistics;
    await statistics.recordFeedback(kb.id, article, "Neuer Hinweis");
    const [recent, old] = await statistics.feedback(kb.id);
    if (!old || !recent) throw new Error("missing feedback");
    expect(await statistics.deleteFeedbackWhenDue(recent.id)).toBe("rescheduled");
    expect(await statistics.deleteFeedbackWhenDue(old.id)).toBe("deleted");
    await past.recordFeedback(kb.id, article, "Noch ein alter Hinweis");
    await test.services.portals.updateAppearance(kb.id, { feedbackRetentionMonths: 24 });
    await statistics.retentionChanged(kb.id);
    expect((await statistics.feedback(kb.id)).map((entry) => entry.text)).toEqual(
      ["Noch ein alter Hinweis", "Neuer Hinweis"].sort((a, b) => (a < b ? 1 : -1)),
    );
    await test.services.portals.updateAppearance(kb.id, { feedbackRetentionMonths: 1 });
    await statistics.retentionChanged(kb.id);
    expect((await statistics.feedback(kb.id)).map((entry) => entry.text)).toEqual(["Neuer Hinweis"]);
    expect(await statistics.deleteFeedbackWhenDue(randomUUID())).toBe("gone");
  });

  it("pre-renders the published article with relative files, portal links and without included pages", async () => {
    const org = await organization();
    const kb = await knowledgeBase(org.id, org.owner, "public");
    const other = await space(org.id, org.owner, { visibility: "organization" });
    const internal = await publishedPage(org.owner, other.id, "Intern", "Interner Text");
    const target = await publishedPage(org.owner, kb.id, "Ziel", "Ziel");
    const attachmentId = randomUUID();
    const colleague = await member(org.id, "member", "Kollegin Klara");
    const stranger = await account({ name: "Fremder Franz" });
    const actor = accountPrincipal(org.owner);
    const page = await test.services.tree.create(actor, kb.id, {
      kind: "page",
      title: "Quelle",
      placement: { parentId: null },
    });
    await test.services.documents.replace(actor, page.id, {
      type: "doc",
      content: [
        {
          type: "section",
          attrs: { key: "steps", title: "Schritte", icon: "list-ordered" },
          content: [
            {
              type: "paragraph",
              content: [
                { type: "pageLink", attrs: { pageId: target, spaceId: kb.id, title: "Zum Ziel" } },
                { type: "text", text: " und " },
                { type: "pageLink", attrs: { pageId: internal, spaceId: other.id, title: "Intern" } },
              ],
            },
            { type: "image", attrs: { attachmentId, alt: "Bild" } },
            { type: "includePage", attrs: { pageId: internal } },
            {
              type: "paragraph",
              content: [
                { type: "mention", attrs: { id: colleague } },
                { type: "text", text: " " },
                { type: "mention", attrs: { id: stranger } },
              ],
            },
          ],
        },
      ],
    });
    await test.services.versions.publish(actor, page.id);
    const rendered = await test.services.articleRenderer.renderPublished(page.id, "de");
    if (!rendered) throw new Error("not rendered");
    const number = await test.database.execute<{ number: number }>(
      sql`select number from article_numbers where item_id = ${target}`,
    );
    expect(rendered.html).toContain(`href="/__portal__/${number.rows[0]?.number}"`);
    expect(rendered.html).toContain(`src="/__portal__/files/${attachmentId}?size=display"`);
    expect(rendered.html).not.toContain("Interner Text");
    expect(rendered.html).not.toContain(internal);
    expect(rendered.html).not.toContain(">Intern<");
    expect(rendered.html).toContain('data-section="steps"');
    expect(rendered.html).toContain("Kollegin Klara");
    expect(rendered.html).not.toContain("Fremder Franz");
    expect(rendered.headings).toEqual([expect.objectContaining({ title: "Schritte", level: 2 })]);
    const again = await test.services.articleRenderer.renderPublished(page.id, "de");
    expect(again?.html).toBe(rendered.html);
  });

  it("counts zero-result searches and offers only repeated terms with results as frequent searches", async () => {
    const org = await organization();
    const kb = await knowledgeBase(org.id, org.owner, "public");
    const statistics = test.services.portalStatistics;
    for (let index = 0; index < 3; index += 1) {
      await statistics.recordSearch(kb.id, { term: "VPN", results: 4, categoryId: null });
      await statistics.recordSearch(kb.id, { term: "Parkausweis", results: 0, categoryId: null });
    }
    await statistics.recordSearch(kb.id, { term: "Drucker", results: 2, categoryId: null });
    expect(await statistics.frequentSearches(kb.id)).toEqual(["vpn"]);
    const period = { from: "2000-01-01", to: "2100-01-01" };
    expect((await statistics.zeroResultTerms(kb.id, period)).map((entry) => entry.term)).toEqual([
      "parkausweis",
    ]);
    expect(await statistics.searches(kb.id, period)).toEqual({ searches: 7, zeroResults: 3 });
    const stored = await test.database.execute<{ searched_at: Date }>(
      sql`select searched_at from portal_searches where space_id = ${kb.id}`,
    );
    for (const row of stored.rows) expect(new Date(row.searched_at).getUTCMinutes()).toBe(0);
  });
});
