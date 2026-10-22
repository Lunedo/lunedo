import { randomUUID } from "node:crypto";
import type { DocumentJson, NodeJson } from "@lunedo/editor-schema";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accountPrincipal, type Principal } from "../accounts/principal.js";
import type { Rhythm } from "../meetings/schedule.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { spaceFixtures } from "../testing/spaces.js";
import { searchRequest } from "./search.testing.js";
import type { SearchRequest } from "./service.js";

const baseUrl = testDatabaseBaseUrl();
const WEEKLY: Rhythm = { frequency: "weekly", interval: 1, weekdays: ["MO"] };

function paragraph(value: string): NodeJson {
  return { type: "paragraph", content: [{ type: "text", text: value }] };
}

function writeUpdate(document: DocumentJson, topicId: string, value: string): DocumentJson {
  const visit = (node: NodeJson): NodeJson => {
    if (node.type === "topicUpdate" && node.attrs?.topicId === topicId) {
      return { ...node, content: [paragraph(value)] };
    }
    return node.content ? { ...node, content: node.content.map(visit) } : node;
  };
  return visit(document) as DocumentJson;
}

function word(): string {
  return `w${randomUUID()
    .replace(/[^a-f]/g, "")
    .slice(0, 10)}`;
}

describe.skipIf(!baseUrl)("search over meetings", () => {
  let test: TestServices;
  const fixtures = spaceFixtures(() => test);

  beforeAll(async () => {
    test = await createTestServices(baseUrl ?? "");
    await test.pool.query("insert into instance (id, setup_completed_at) values (1, now())");
  });

  afterAll(async () => {
    await test?.close();
  });

  async function drain() {
    await test.pool.query("update search_pending_items set due_at = now()");
    return test.services.search.indexer.drain();
  }

  async function setup() {
    const org = await fixtures.organization();
    const leadId = await fixtures.member(org.id, "member", "Lead");
    const editorId = await fixtures.member(org.id, "member", "Editor");
    const readerId = await fixtures.member(org.id, "member", "Reader");
    const outsiderId = await fixtures.member(org.id, "member", "Outsider");
    const space = await fixtures.space(org.id, leadId, {
      grants: [
        { principalKind: "account", principalId: editorId, role: "editor" },
        { principalKind: "account", principalId: readerId, role: "reader" },
      ],
    });
    const lead = accountPrincipal(leadId);
    const seriesId = await test.services.meetings.createSeries(lead, space.id, {
      name: "Jour fixe IT",
      parentId: null,
      members: [leadId, editorId],
      templateId: "builtin:team-meeting",
      rhythm: WEEKLY,
      startsOn: "2030-03-18",
      startTime: "09:30",
      timeZone: "Europe/Vienna",
      durationMinutes: 45,
    });
    const meetingId = (await test.services.meetings.details(lead, seriesId)).upcoming?.id ?? "";
    const words = { topic: word(), update: word(), comment: word(), decision: word() };
    const topicId = await test.services.topics.create(lead, seriesId, { title: `Rollout ${words.topic}` });
    const snapshot = await test.services.documents.snapshot(meetingId);
    if (!snapshot) throw new Error("The meeting has no content");
    await test.services.documents.replace(
      lead,
      meetingId,
      writeUpdate(snapshot.document, topicId, `Status ${words.update}`),
    );
    const commentId = await test.services.comments.create(lead, topicId, {
      body: { type: "doc", content: [paragraph(`Question ${words.comment}`)] },
    });
    const { decisionId } = await test.services.topics.closeAsDecision(lead, topicId, {
      statement: `We choose ${words.decision}`,
    });
    await drain();
    return {
      org,
      space,
      lead,
      leadId,
      editor: accountPrincipal(editorId),
      reader: accountPrincipal(readerId),
      outsider: accountPrincipal(outsiderId),
      outsiderId,
      seriesId,
      meetingId,
      topicId,
      commentId,
      decisionId,
      words,
    };
  }

  async function search(
    viewer: Principal,
    organizationId: string,
    query: string,
    overrides: Partial<SearchRequest> = {},
  ) {
    return test.services.search.search(viewer, organizationId, searchRequest(query, overrides));
  }

  async function found(viewer: Principal, organizationId: string, query: string) {
    const response = await search(viewer, organizationId, query, { contentTypes: ["topic", "decision"] });
    return response.results.map((hit) => [hit.type, hit.id]);
  }

  async function anything(viewer: Principal, organizationId: string, query: string) {
    return (await search(viewer, organizationId, query)).results.map((hit) => [hit.type, hit.id]);
  }

  it("finds running topics with their updates and comments, and decisions, in their series", async () => {
    const context = await setup();
    const series = { id: context.seriesId, title: "Jour fixe IT" };
    const topic = { id: context.topicId, title: `Rollout ${context.words.topic}` };
    const byTitle = await search(context.reader, context.org.id, context.words.topic);
    expect(byTitle.results).toHaveLength(1);
    expect(byTitle.results[0]).toMatchObject({
      type: "topic",
      id: context.topicId,
      itemId: context.topicId,
      itemType: "topic",
      topic,
      series,
      attachment: null,
    });
    const byUpdate = await search(context.reader, context.org.id, context.words.update);
    expect(byUpdate.results.map((hit) => [hit.type, hit.id, hit.heading])).toEqual([
      ["topic", context.topicId, "Jour fixe IT · 18 Mar 2030"],
      ["page", context.meetingId, "Running topics"],
    ]);
    const byComment = await search(context.reader, context.org.id, context.words.comment);
    expect(byComment.results).toHaveLength(1);
    expect(byComment.results[0]).toMatchObject({ type: "topic", id: context.commentId, topic, series });
    const byDecision = await search(
      context.reader,
      context.org.id,
      `type:decision ${context.words.decision}`,
    );
    expect(byDecision.results).toHaveLength(1);
    expect(byDecision.results[0]).toMatchObject({
      type: "decision",
      id: context.decisionId,
      itemId: context.meetingId,
      topic,
      series,
    });
    expect(await anything(context.reader, context.org.id, `type:topic ${context.words.decision}`)).toEqual(
      [],
    );
    const all = await search(context.reader, context.org.id, "", { spaceIds: [context.space.id] });
    expect(all.facets?.contentTypes).toEqual(
      expect.arrayContaining([
        { value: "topic", count: 2 },
        { value: "decision", count: 1 },
      ]),
    );
    expect(await found(context.outsider, context.org.id, context.words.topic)).toEqual([]);
  });

  it("hides updates and decisions of a restricted meeting, also while the access update is pending", async () => {
    const context = await setup();
    await test.services.pageAccess.change(context.lead, context.meetingId, [
      { action: "restrict", kind: "view" },
    ]);
    const pending = await test.pool.query("select 1 from search_pending_spaces where space_id = $1", [
      context.space.id,
    ]);
    expect(pending.rows).toHaveLength(1);
    for (const run of ["pending", "stored"]) {
      if (run === "stored") await drain();
      expect(await found(context.reader, context.org.id, context.words.update)).toEqual([]);
      expect(await found(context.reader, context.org.id, context.words.decision)).toEqual([]);
      expect(await found(context.reader, context.org.id, context.words.topic)).toEqual([
        ["topic", context.topicId],
      ]);
      expect(await found(context.lead, context.org.id, context.words.update)).toEqual([
        ["topic", context.topicId],
      ]);
      expect(await found(context.lead, context.org.id, context.words.decision)).toEqual([
        ["decision", context.decisionId],
      ]);
    }
  });

  it("shows a person who holds only a share of the meeting its decisions but nothing of the series", async () => {
    const context = await setup();
    await test.services.pageAccess.change(context.lead, context.meetingId, [
      { action: "share", holderKind: "account", holderId: context.outsiderId, role: "reader" },
    ]);
    await drain();
    const decision = await search(context.outsider, context.org.id, context.words.decision, {
      contentTypes: ["decision"],
    });
    expect(decision.results).toHaveLength(1);
    expect(decision.results[0]).toMatchObject({
      type: "decision",
      id: context.decisionId,
      topic: null,
      series: null,
      space: null,
      sharedWithYou: true,
      path: [],
    });
    expect(await found(context.outsider, context.org.id, context.words.update)).toEqual([]);
    expect(await found(context.outsider, context.org.id, context.words.topic)).toEqual([]);
  });

  it("drops updates of a skipped meeting from the index", async () => {
    const context = await setup();
    const fresh = word();
    const { nextMeetingId } = await test.services.meetings.close(context.lead, context.meetingId);
    const topicId = await test.services.topics.create(context.lead, context.seriesId, { title: "Printers" });
    const snapshot = await test.services.documents.snapshot(nextMeetingId ?? "");
    await test.services.documents.replace(
      context.lead,
      nextMeetingId ?? "",
      writeUpdate(snapshot?.document as DocumentJson, topicId, `Toner ${fresh}`),
    );
    await drain();
    expect(await found(context.reader, context.org.id, fresh)).toEqual([["topic", topicId]]);
    const skipped = nextMeetingId ?? "";
    const indexed = () =>
      test.pool.query("select 1 from search_chunks where item_id = $1 and context_item_id = $2", [
        topicId,
        skipped,
      ]);
    expect((await indexed()).rows).toHaveLength(1);
    await test.services.meetings.skip(context.lead, skipped);
    await drain();
    expect((await indexed()).rows).toEqual([]);
  });

  it("never indexes private notes, not even for their author", async () => {
    const context = await setup();
    const note = "Quillfeathered promotion";
    await test.services.privateNotes.save(context.editor, context.meetingId, {
      document: { type: "doc", content: [paragraph(note)] },
      revision: 0,
    });
    await drain();
    for (const viewer of [context.editor, context.lead, context.reader]) {
      expect(await anything(viewer, context.org.id, "quillfeathered")).toEqual([]);
      expect((await search(viewer, context.org.id, "quillfeatherd")).suggestion).toBeNull();
    }
    const stored = await test.pool.query(
      "select 1 from search_chunks where body ilike '%quillfeathered%' or title ilike '%quillfeathered%'",
    );
    expect(stored.rows).toEqual([]);
    const terms = await test.pool.query("select 1 from search_terms where word like 'quillfeather%'");
    expect(terms.rows).toEqual([]);
  });

  it("follows renaming, closing as a decision, moving and deleting the series", async () => {
    const context = await setup();
    const renamed = word();
    await test.services.topics.update(context.lead, context.topicId, { title: `Renamed ${renamed}` });
    await drain();
    expect(await found(context.reader, context.org.id, renamed)).toEqual([["topic", context.topicId]]);
    expect(await found(context.reader, context.org.id, context.words.topic)).toEqual([]);

    const second = await test.services.topics.create(context.lead, context.seriesId, {
      title: "Second topic",
    });
    const statement = word();
    const { decisionId } = await test.services.topics.closeAsDecision(context.lead, second, {
      statement: `Agreed ${statement}`,
    });
    await drain();
    expect(await found(context.reader, context.org.id, statement)).toEqual([["decision", decisionId]]);

    const target = await fixtures.space(context.org.id, context.leadId);
    const impact = await test.services.tree.moveImpact(context.lead, context.seriesId, {
      spaceId: target.id,
      parentId: null,
    });
    await test.services.tree.move(context.lead, context.seriesId, {
      spaceId: target.id,
      parentId: null,
      confirmation: impact.confirmation ?? "",
    });
    for (const run of ["pending", "stored"]) {
      if (run === "stored") await drain();
      expect(await found(context.reader, context.org.id, context.words.update)).toEqual([]);
      expect(await found(context.reader, context.org.id, statement)).toEqual([]);
      const moved = await search(context.lead, context.org.id, context.words.update, {
        contentTypes: ["topic"],
      });
      expect(moved.results.map((hit) => [hit.id, hit.space?.id])).toEqual([[context.topicId, target.id]]);
    }

    await test.services.trash.deleteItem(context.lead, context.seriesId);
    await drain();
    for (const text of [
      renamed,
      context.words.update,
      context.words.comment,
      context.words.decision,
      statement,
    ]) {
      expect(await found(context.lead, context.org.id, text)).toEqual([]);
    }
  });

  it("keeps one-on-ones to their two people", async () => {
    const org = await fixtures.organization();
    const leadId = await fixtures.member(org.id, "member", "Lead");
    const otherId = await fixtures.member(org.id, "member", "Other");
    const administratorId = await fixtures.member(org.id, "member", "Administrator");
    await test.services.roles.assign(accountPrincipal(org.owner), {
      scope: "organization",
      organizationId: org.id,
      role: { builtIn: "administrator" },
      principal: { kind: "account", id: administratorId },
    });
    const lead = accountPrincipal(leadId);
    const { seriesId } = await test.services.oneOnOnes.create(lead, {
      otherId,
      organizationId: org.id,
      rhythm: WEEKLY,
      startsOn: "2030-03-18",
      startTime: "09:30",
      timeZone: "Europe/Vienna",
      durationMinutes: 30,
    });
    const secret = word();
    const topicId = await test.services.topics.create(lead, seriesId, { title: `Career ${secret}` });
    await drain();
    for (const viewer of [lead, accountPrincipal(otherId)]) {
      expect(await found(viewer, org.id, secret)).toEqual([["topic", topicId]]);
    }
    for (const viewer of [accountPrincipal(administratorId), accountPrincipal(org.owner)]) {
      expect(await found(viewer, org.id, secret)).toEqual([]);
    }
  });
});
