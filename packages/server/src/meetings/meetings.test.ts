import type { DocumentJson, NodeJson } from "@pagehall/editor-schema";
import { applyDocument, documentFromYDoc, yDocFromDocument } from "@pagehall/editor-schema/yjs";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { accountPrincipal, type Principal } from "../accounts/principal.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { spaceFixtures } from "../testing/spaces.js";
import type { Rhythm } from "./schedule.js";

const baseUrl = testDatabaseBaseUrl();

function text(value: string): NodeJson {
  return { type: "text", text: value };
}

function paragraph(value: string): NodeJson {
  return { type: "paragraph", content: [text(value)] };
}

function find(node: NodeJson, predicate: (node: NodeJson) => boolean): NodeJson[] {
  return [
    ...(predicate(node) ? [node] : []),
    ...(node.content ?? []).flatMap((child) => find(child, predicate)),
  ];
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

function append(document: DocumentJson, ...nodes: NodeJson[]): DocumentJson {
  return { ...document, content: [...(document.content ?? []), ...nodes] };
}

const WEEKLY: Rhythm = { frequency: "weekly", interval: 1, weekdays: ["MO"] };

describe.skipIf(!baseUrl)("meeting series", () => {
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
    const leadId = await member(org.id, "member", "Lead");
    const editorId = await member(org.id, "member", "Editor");
    const readerId = await member(org.id, "member", "Reader");
    const outsiderId = await member(org.id, "member", "Outsider");
    const created = await space(org.id, leadId, {
      grants: [
        { principalKind: "account", principalId: editorId, role: "editor" },
        { principalKind: "account", principalId: readerId, role: "reader" },
      ],
    });
    return {
      org,
      space: created,
      leadId,
      editorId,
      readerId,
      outsiderId,
      lead: accountPrincipal(leadId),
      editor: accountPrincipal(editorId),
      reader: accountPrincipal(readerId),
      outsider: accountPrincipal(outsiderId),
    };
  }

  type Context = Awaited<ReturnType<typeof setup>>;

  async function series(
    context: Context,
    options: { rhythm?: Rhythm; startsOn?: string; startTime?: string; parentId?: string | null } = {},
  ) {
    const id = await test.services.meetings.createSeries(context.lead, context.space.id, {
      name: "Jour fixe IT",
      parentId: options.parentId ?? null,
      members: [context.leadId, context.editorId],
      templateId: "builtin:team-meeting",
      rhythm: options.rhythm ?? WEEKLY,
      startsOn: options.startsOn ?? "2030-03-18",
      startTime: options.startTime ?? "09:30",
      timeZone: "Europe/Vienna",
      durationMinutes: 45,
    });
    const upcoming = (await test.services.meetings.details(context.lead, id)).upcoming;
    if (!upcoming) throw new Error("The series has no upcoming meeting");
    return { id, firstMeetingId: upcoming.id };
  }

  async function content(itemId: string): Promise<DocumentJson> {
    const snapshot = await test.services.documents.snapshot(itemId);
    if (!snapshot) throw new Error("The page has no content");
    return snapshot.document;
  }

  async function edit(actor: Principal, itemId: string, change: (document: DocumentJson) => DocumentJson) {
    await test.services.documents.replace(actor, itemId, change(await content(itemId)));
  }

  async function upcomingOf(context: Context, seriesId: string) {
    return (await test.services.meetings.details(context.lead, seriesId)).upcoming;
  }

  describe("schedules", () => {
    it("create the first meeting from the template with the date, the members and the series' tasks", async () => {
      const context = await setup();
      const created = await series(context);
      const meeting = await test.services.meetings.meeting(context.lead, created.firstMeetingId);
      expect(meeting.startsAt?.toISOString()).toBe("2030-03-18T08:30:00.000Z");
      expect(meeting.title).toBe("Jour fixe IT · 18 Mar 2030");
      expect(meeting.attendees.map((attendee) => attendee.id).sort()).toEqual(
        [context.leadId, context.editorId].sort(),
      );
      const reports = find(await content(created.firstMeetingId), (node) => node.type === "taskReport");
      expect(reports.map((node) => node.attrs?.seriesId)).toEqual([created.id]);
    });

    it("continue weekly across the change to summer time at the same local time", async () => {
      const context = await setup();
      const created = await series(context, { startsOn: "2030-03-25" });
      const { nextMeetingId } = await test.services.meetings.close(context.lead, created.firstMeetingId);
      const next = await test.services.meetings.meeting(context.lead, nextMeetingId ?? "");
      expect(next.startsAt?.toISOString()).toBe("2030-04-01T07:30:00.000Z");
    });

    it("continue every two weeks", async () => {
      const context = await setup();
      const created = await series(context, {
        rhythm: { frequency: "weekly", interval: 2, weekdays: ["TH"] },
        startsOn: "2030-03-14",
        startTime: "14:00",
      });
      const { nextMeetingId } = await test.services.meetings.close(context.lead, created.firstMeetingId);
      const next = await test.services.meetings.meeting(context.lead, nextMeetingId ?? "");
      expect(next.startsAt?.toISOString()).toBe("2030-03-28T13:00:00.000Z");
    });

    it("continue monthly on the first Tuesday and quarterly", async () => {
      const context = await setup();
      const monthly = await series(context, {
        rhythm: { frequency: "monthly", interval: 1, weekOfMonth: 1, weekday: "TU" },
        startsOn: "2030-03-01",
      });
      const firstMonthly = await test.services.meetings.meeting(context.lead, monthly.firstMeetingId);
      expect(firstMonthly.startsAt?.toISOString()).toBe("2030-03-05T08:30:00.000Z");
      const monthlyNext = await test.services.meetings.close(context.lead, monthly.firstMeetingId);
      expect(
        (
          await test.services.meetings.meeting(context.lead, monthlyNext.nextMeetingId ?? "")
        ).startsAt?.toISOString(),
      ).toBe("2030-04-02T07:30:00.000Z");
      const quarterly = await series(context, {
        rhythm: { frequency: "monthly", interval: 3, monthDay: 6 },
        startsOn: "2030-01-06",
      });
      const quarterlyNext = await test.services.meetings.close(context.lead, quarterly.firstMeetingId);
      expect(
        (
          await test.services.meetings.meeting(context.lead, quarterlyNext.nextMeetingId ?? "")
        ).startsAt?.toISOString(),
      ).toBe("2030-04-06T07:30:00.000Z");
    });

    it("keep a moved meeting as an exception and continue with the rule", async () => {
      const context = await setup();
      const created = await series(context);
      await test.services.meetings.move(
        context.lead,
        created.firstMeetingId,
        new Date("2030-03-19T12:00:00.000Z"),
      );
      const moved = await test.services.meetings.meeting(context.lead, created.firstMeetingId);
      expect(moved.startsAt?.toISOString()).toBe("2030-03-19T12:00:00.000Z");
      expect(moved.recurrenceId?.toISOString()).toBe("2030-03-18T08:30:00.000Z");
      expect(moved.title).toBe("Jour fixe IT · 19 Mar 2030");
      const overrides = await test.database.execute<{ starts_at: Date }>(
        sql`select starts_at from meeting_occurrence_overrides where series_id = ${created.id}`,
      );
      expect(overrides.rows).toHaveLength(1);
      const { nextMeetingId } = await test.services.meetings.close(context.lead, created.firstMeetingId);
      expect(
        (await test.services.meetings.meeting(context.lead, nextMeetingId ?? "")).startsAt?.toISOString(),
      ).toBe("2030-03-25T08:30:00.000Z");
    });

    it("skip a meeting, keep its agenda and carry it to the following one", async () => {
      const context = await setup();
      const created = await series(context);
      await edit(context.lead, created.firstMeetingId, (document) =>
        append(document, paragraph("Discuss the printer contract"), {
          type: "taskList",
          content: [
            {
              type: "taskItem",
              attrs: { id: "01929b1e-0000-7000-8000-00000000aa01", assignee: context.editorId },
              content: [paragraph("Ask for a quote")],
            },
          ],
        }),
      );
      const { nextMeetingId } = await test.services.meetings.skip(context.lead, created.firstMeetingId);
      const skipped = await test.services.meetings.meeting(context.lead, created.firstMeetingId);
      expect(skipped.state).toBe("skipped");
      expect(JSON.stringify(await content(created.firstMeetingId))).toContain("Discuss the printer contract");
      const next = await test.services.meetings.meeting(context.lead, nextMeetingId);
      expect(next.startsAt?.toISOString()).toBe("2030-03-25T08:30:00.000Z");
      expect(JSON.stringify(await content(nextMeetingId))).toContain("Discuss the printer contract");
      const tasks = await test.services.tasks.list(context.lead, { seriesId: created.id, status: "open" });
      expect(tasks.items.map((task) => [task.text, task.item.id])).toEqual([
        ["Ask for a quote", nextMeetingId],
      ]);
    });

    it("ask for the next date without a fixed rhythm and allow not scheduled yet", async () => {
      const context = await setup();
      const created = await series(context, { rhythm: { frequency: "none", interval: 1 } });
      await expect(test.services.meetings.close(context.lead, created.firstMeetingId)).rejects.toMatchObject({
        code: "nextDateRequired",
      });
      const { nextMeetingId } = await test.services.meetings.close(context.lead, created.firstMeetingId, {
        nextStartsAt: null,
      });
      const next = await test.services.meetings.meeting(context.lead, nextMeetingId ?? "");
      expect(next.startsAt).toBeNull();
      expect(next.title).toBe("Jour fixe IT · not scheduled yet");
      await test.services.meetings.move(context.lead, next.id, new Date("2030-05-02T08:00:00.000Z"));
      expect((await test.services.meetings.meeting(context.lead, next.id)).title).toBe(
        "Jour fixe IT · 2 May 2030",
      );
    });
  });

  describe("closing", () => {
    it("creates exactly one next meeting when two nodes close the same meeting at the same moment", async () => {
      const context = await setup();
      const created = await series(context);
      const other = test.anotherNode();
      const results = await Promise.allSettled([
        test.services.meetings.close(context.lead, created.firstMeetingId),
        other.meetings.close(context.editor, created.firstMeetingId),
        test.services.meetings.close(context.editor, created.firstMeetingId),
      ]);
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      for (const result of results) {
        if (result.status === "rejected") expect(result.reason).toMatchObject({ code: "meetingClosed" });
      }
      const counts = await test.database.execute<{ state: string; count: string }>(sql`
        select state, count(*) as count from meetings where series_id = ${created.id} group by state order by state::text`);
      expect(counts.rows.map((row) => [row.state, Number(row.count)])).toEqual([
        ["closed", 1],
        ["upcoming", 1],
      ]);
    });

    it("notifies attendees who can read the notes, and undo withdraws it and removes the untouched next meeting", async () => {
      const context = await setup();
      const created = await series(context);
      await test.services.meetings.addAttendee(context.lead, created.firstMeetingId, context.outsiderId);
      const { nextMeetingId } = await test.services.meetings.close(context.lead, created.firstMeetingId);
      const editorNotes = await test.services.notifications.list(context.editorId, { limit: 20 });
      expect(editorNotes.items.map((item) => item.type)).toContain("meeting.notesAvailable");
      const outsiderNotes = await test.services.notifications.list(context.outsiderId, { limit: 20 });
      expect(outsiderNotes.items.map((item) => item.type)).not.toContain("meeting.notesAvailable");
      const undone = await test.services.meetings.undoClose(context.lead, created.firstMeetingId);
      expect(undone.removedMeetingId).toBe(nextMeetingId);
      expect((await test.services.meetings.meeting(context.lead, created.firstMeetingId)).state).toBe(
        "upcoming",
      );
      expect((await test.services.notifications.list(context.editorId, { limit: 20 })).items).toHaveLength(0);
      await expect(test.services.meetings.meeting(context.lead, nextMeetingId ?? "")).rejects.toMatchObject({
        code: "meetingNotFound",
      });
    });

    it("keeps a next meeting someone already used when the close is undone, as with reopening", async () => {
      const context = await setup();
      const created = await series(context);
      const { nextMeetingId } = await test.services.meetings.close(context.lead, created.firstMeetingId);
      await test.services.meetings.setAttendance(
        context.lead,
        nextMeetingId ?? "",
        context.editorId,
        "excused",
      );
      const undone = await test.services.meetings.undoClose(context.lead, created.firstMeetingId);
      expect(undone.removedMeetingId).toBeNull();
      const reopened = await test.services.meetings.meeting(context.lead, created.firstMeetingId);
      expect(reopened.state).toBe("reopened");
      expect(reopened.current).toBe(true);
      expect((await upcomingOf(context, created.id))?.id).toBe(nextMeetingId);
      expect(
        (await test.services.meetings.close(context.lead, created.firstMeetingId)).nextMeetingId,
      ).toBeNull();
    });

    it("records attendance apart from the notes", async () => {
      const context = await setup();
      const created = await series(context);
      const before = await test.services.documents.snapshot(created.firstMeetingId);
      await test.services.meetings.setAttendance(
        context.lead,
        created.firstMeetingId,
        context.editorId,
        "present",
      );
      const meeting = await test.services.meetings.meeting(context.lead, created.firstMeetingId);
      expect(meeting.attendees.find((attendee) => attendee.id === context.editorId)?.attendance).toBe(
        "present",
      );
      expect((await test.services.documents.snapshot(created.firstMeetingId))?.revision).toBe(
        before?.revision,
      );
    });
  });

  describe("running topics", () => {
    it("are added to the upcoming meeting and carried over until they are closed", async () => {
      const context = await setup();
      const created = await series(context);
      const topicId = await test.services.topics.create(context.lead, created.id, {
        title: "Positions in AD",
      });
      const blocks = find(await content(created.firstMeetingId), (node) => node.type === "topicUpdate");
      expect(blocks.map((node) => node.attrs?.topicId)).toEqual([topicId]);
      await edit(context.lead, created.firstMeetingId, (document) =>
        writeUpdate(document, topicId, "Draft is with HR."),
      );
      const { nextMeetingId } = await test.services.meetings.close(context.lead, created.firstMeetingId);
      const carried = find(await content(nextMeetingId ?? ""), (node) => node.type === "topicUpdate");
      expect(carried.map((node) => node.attrs?.topicId)).toEqual([topicId]);
      await test.services.topics.close(context.lead, topicId, {
        outcome: "resolved",
        meetingId: nextMeetingId ?? "",
      });
      const third = await test.services.meetings.close(context.lead, nextMeetingId ?? "");
      expect(find(await content(third.nextMeetingId ?? ""), (node) => node.type === "topicUpdate")).toEqual(
        [],
      );
      const details = await test.services.topics.get(context.lead, topicId);
      expect(details.status).toBe("closed");
      expect(details.seriesTitle).toBe("Jour fixe IT");
      expect(details.timeline.map((entry) => entry.meetingId)).toEqual([created.firstMeetingId]);
    });

    it("leave a later meeting when closed in an earlier one, while their history stays", async () => {
      const context = await setup();
      const created = await series(context);
      const topicId = await test.services.topics.create(context.lead, created.id, {
        title: "Storage migration",
      });
      await edit(context.lead, created.firstMeetingId, (document) =>
        writeUpdate(document, topicId, "Started."),
      );
      const { nextMeetingId } = await test.services.meetings.close(context.lead, created.firstMeetingId);
      await test.services.meetings.reopen(context.lead, created.firstMeetingId);
      await test.services.topics.close(context.lead, topicId, {
        outcome: "dropped",
        meetingId: created.firstMeetingId,
      });
      expect(find(await content(nextMeetingId ?? ""), (node) => node.type === "topicUpdate")).toEqual([]);
      expect((await test.services.topics.get(context.lead, topicId)).timeline).toHaveLength(1);
    });

    it("collect their updates after edits, restores and concurrent editing", async () => {
      const context = await setup();
      const created = await series(context);
      const first = await test.services.topics.create(context.lead, created.id, { title: "First topic" });
      const second = await test.services.topics.create(context.lead, created.id, { title: "Second topic" });
      await edit(context.lead, created.firstMeetingId, (document) =>
        writeUpdate(document, first, "Version one."),
      );
      await test.services.versions.versionLiveSession(created.firstMeetingId);
      const versions = await test.services.versions.list(created.firstMeetingId);
      await edit(context.lead, created.firstMeetingId, (document) =>
        writeUpdate(document, first, "Version two."),
      );
      expect(JSON.stringify((await test.services.topics.get(context.lead, first)).timeline)).toContain(
        "Version two.",
      );
      const base = await content(created.firstMeetingId);
      const left = yDocFromDocument(writeUpdate(base, first, "Left edit."));
      const right = yDocFromDocument(writeUpdate(base, second, "Right edit."));
      const stored = await test.services.documents.state(created.firstMeetingId);
      const leftDoc = new Y.Doc();
      const rightDoc = new Y.Doc();
      Y.applyUpdate(leftDoc, stored ?? new Uint8Array());
      Y.applyUpdate(rightDoc, stored ?? new Uint8Array());
      applyDocument(leftDoc, documentFromYDoc(left) as DocumentJson, "left");
      applyDocument(rightDoc, documentFromYDoc(right) as DocumentJson, "right");
      await Promise.all([
        test.services.documents.store(created.firstMeetingId, leftDoc, { actorId: context.leadId }),
        test.anotherNode().documents.store(created.firstMeetingId, rightDoc, { actorId: context.editorId }),
      ]);
      expect(JSON.stringify((await test.services.topics.get(context.lead, first)).timeline)).toContain(
        "Left edit.",
      );
      expect(JSON.stringify((await test.services.topics.get(context.lead, second)).timeline)).toContain(
        "Right edit.",
      );
      const oldest = versions.at(-1);
      expect(oldest).toBeDefined();
      await test.services.versions.restore(context.lead, created.firstMeetingId, oldest?.number ?? 0);
      expect((await test.services.topics.get(context.lead, second)).timeline).toHaveLength(0);
      expect(JSON.stringify((await test.services.topics.get(context.lead, first)).timeline)).toContain(
        "Version one.",
      );
    });

    it("close as a decision in the current meeting, link both ways and keep their history", async () => {
      const context = await setup();
      const created = await series(context);
      const topicId = await test.services.topics.create(context.lead, created.id, {
        title: "BitLocker rollout",
      });
      await edit(context.lead, created.firstMeetingId, (document) =>
        writeUpdate(document, topicId, "Letters or portal?"),
      );
      const { decisionId, meetingId } = await test.services.topics.closeAsDecision(context.lead, topicId, {
        statement: "PINs are set in the self-service portal.",
      });
      expect(meetingId).toBe(created.firstMeetingId);
      const decisions = find(await content(meetingId), (node) => node.type === "decision");
      expect(decisions.map((node) => [node.attrs?.id, node.attrs?.topicId])).toEqual([[decisionId, topicId]]);
      const topic = await test.services.topics.get(context.lead, topicId);
      expect(topic).toMatchObject({ status: "closed", outcome: "decided", decisionId });
      expect(topic.decision?.text).toBe("PINs are set in the self-service portal.");
      expect(topic.timeline.map((entry) => entry.meetingId)).toEqual([meetingId]);
      const log = await test.services.decisions.log(context.lead, created.id, { text: "portal" });
      expect(log.map((entry) => [entry.id, entry.topic?.id, entry.meeting.id])).toEqual([
        [decisionId, topicId, meetingId],
      ]);
    });

    it("keep decision IDs unique when a decision is pasted into another page", async () => {
      const context = await setup();
      const created = await series(context);
      const decisionId = "01929b1e-0000-7000-8000-00000000dd01";
      const block: NodeJson = {
        type: "decision",
        attrs: { id: decisionId, topicId: null },
        content: [paragraph("Keep it.")],
      };
      await edit(context.lead, created.firstMeetingId, (document) => append(document, block));
      const { nextMeetingId } = await test.services.meetings.close(context.lead, created.firstMeetingId);
      await edit(context.lead, nextMeetingId ?? "", (document) => append(document, block));
      const copied = find(await content(nextMeetingId ?? ""), (node) => node.type === "decision");
      expect(copied[0]?.attrs?.id).not.toBe(decisionId);
      expect(await test.services.decisions.log(context.lead, created.id)).toHaveLength(2);
    });
  });

  describe("gates", () => {
    it("refuse to close a topic in a meeting of another series", async () => {
      const context = await setup();
      const created = await series(context);
      const other = await series(context);
      const topicId = await test.services.topics.create(context.lead, created.id, { title: "Budget" });
      await expect(
        test.services.topics.close(context.lead, topicId, {
          outcome: "resolved",
          meetingId: other.firstMeetingId,
        }),
      ).rejects.toMatchObject({ code: "meetingNotFound" });
      expect((await test.services.topics.get(context.lead, topicId)).status).toBe("open");
    });

    it("accept only members of a confidential space as attendees, as for series members", async () => {
      const context = await setup();
      const confidential = await test.services.spaces.create(
        context.lead,
        context.org.id,
        {
          name: "Works council",
          key: `WC${Math.floor(Math.random() * 9000 + 1000)}`,
          visibility: "private",
          confidential: true,
          grants: [{ principalKind: "account", principalId: context.editorId, role: "editor" }],
        },
        test.services.spacePermissions.holders,
      );
      const id = await test.services.meetings.createSeries(context.lead, confidential.id, {
        name: "Council meeting",
        parentId: null,
        members: [context.leadId, context.editorId],
        templateId: "builtin:team-meeting",
        rhythm: WEEKLY,
        startsOn: "2030-03-18",
        startTime: "09:30",
        timeZone: "Europe/Vienna",
        durationMinutes: 45,
      });
      const meetingId = (await test.services.meetings.details(context.lead, id)).upcoming?.id ?? "";
      await expect(
        test.services.meetings.addAttendee(context.lead, meetingId, context.outsiderId),
      ).rejects.toMatchObject({
        code: "invalidMember",
      });
      await expect(
        test.services.meetings.updateSeries(context.lead, id, {
          members: [context.leadId, context.outsiderId],
        }),
      ).rejects.toMatchObject({ code: "invalidMember" });
    });
  });

  describe("readers", () => {
    it("never see topics, decisions or meetings below an unpublished page", async () => {
      const context = await setup();
      const draft = await test.services.tree.create(context.lead, context.space.id, {
        kind: "page",
        title: "Board preparation",
        mode: "publish",
        placement: { parentId: null },
      });
      const created = await series(context, { parentId: draft.id });
      await test.services.topics.create(context.lead, created.id, { title: "Confidential reorganization" });
      expect(await test.services.topics.list(context.reader, created.id)).toEqual([]);
      expect(await test.services.meetings.upcoming(context.reader)).toEqual([]);
      expect((await test.services.meetings.meetings(context.reader, created.id)).items).toEqual([]);
      expect(await test.services.topics.list(context.editor, created.id)).toHaveLength(1);
    });

    it("never see updates or decisions of a restricted meeting", async () => {
      const context = await setup();
      const created = await series(context);
      const topicId = await test.services.topics.create(context.lead, created.id, { title: "Budget" });
      await edit(context.lead, created.firstMeetingId, (document) =>
        append(writeUpdate(document, topicId, "Salary figures"), {
          type: "decision",
          attrs: { id: "01929b1e-0000-7000-8000-00000000dd02", topicId: null },
          content: [paragraph("Raise by four percent")],
        }),
      );
      await test.services.pageAccess.change(context.lead, created.firstMeetingId, [
        { action: "restrict", kind: "view" },
      ]);
      const topic = await test.services.topics.get(context.reader, topicId);
      expect(JSON.stringify(topic)).not.toContain("Salary");
      expect(await test.services.decisions.log(context.reader, created.id)).toEqual([]);
      expect(JSON.stringify(await test.services.meetings.upcoming(context.reader))).not.toContain(
        created.firstMeetingId,
      );
      expect(await test.services.decisions.log(context.lead, created.id)).toHaveLength(1);
    });

    it("hide a topic and the name of its series when the series is restricted", async () => {
      const context = await setup();
      const created = await series(context);
      const topicId = await test.services.topics.create(context.lead, created.id, { title: "Budget" });
      await test.services.pageAccess.change(context.lead, created.id, [{ action: "restrict", kind: "view" }]);
      await expect(test.services.topics.get(context.reader, topicId)).rejects.toMatchObject({
        code: "topicNotFound",
      });
      expect((await test.services.topics.get(context.lead, topicId)).seriesTitle).toBe("Jour fixe IT");
    });

    it("show a reader who holds only a share of the meeting nothing about its series", async () => {
      const context = await setup();
      const created = await series(context);
      await test.services.pageAccess.change(context.lead, created.firstMeetingId, [
        { action: "share", holderKind: "account", holderId: context.outsiderId, role: "reader" },
      ]);
      const meeting = await test.services.meetings.meeting(context.outsider, created.firstMeetingId);
      expect(meeting).toMatchObject({
        seriesId: null,
        seriesTitle: null,
        timeZone: null,
        rhythm: null,
        nextMeetingId: null,
      });
      expect(meeting.attendees.map((attendee) => attendee.member)).toEqual([null, null]);
      expect(JSON.stringify(meeting)).not.toContain("Europe/Vienna");
      const upcoming = await test.services.meetings.upcoming(context.outsider);
      expect(upcoming.find((entry) => entry.id === created.firstMeetingId)).toMatchObject({
        seriesId: null,
        seriesTitle: null,
      });
      const full = await test.services.meetings.meeting(context.reader, created.firstMeetingId);
      expect(full).toMatchObject({
        seriesId: created.id,
        seriesTitle: "Jour fixe IT",
        timeZone: "Europe/Vienna",
      });
    });
  });

  describe("private notes", () => {
    it("can be read by their author only", async () => {
      const context = await setup();
      const created = await series(context);
      const saved = await test.services.privateNotes.save(context.editor, created.firstMeetingId, {
        document: { type: "doc", content: [paragraph("Ask about the promotion")] },
        revision: 0,
      });
      expect(saved.revision).toBe(1);
      for (const viewer of [context.lead, context.reader]) {
        const seen = await test.services.privateNotes.get(viewer, created.firstMeetingId);
        expect(JSON.stringify(seen)).not.toContain("promotion");
        expect(await test.services.privateNotes.listForSeries(viewer, created.id)).toEqual([]);
      }
      const own = await test.services.privateNotes.listForSeries(context.editor, created.id);
      expect(JSON.stringify(own)).toContain("promotion");
    });

    it("refuse a save based on an older revision", async () => {
      const context = await setup();
      const created = await series(context);
      const first = { type: "doc", content: [paragraph("One")] };
      await test.services.privateNotes.save(context.editor, created.firstMeetingId, {
        document: first,
        revision: 0,
      });
      await test.services.privateNotes.save(context.editor, created.firstMeetingId, {
        document: first,
        revision: 1,
      });
      await expect(
        test.services.privateNotes.save(context.editor, created.firstMeetingId, {
          document: first,
          revision: 1,
        }),
      ).rejects.toMatchObject({ code: "notesChanged" });
      await expect(
        test.services.privateNotes.save(context.editor, created.firstMeetingId, {
          document: { type: "doc", content: [{ type: "script" }] },
          revision: 2,
        }),
      ).rejects.toThrow();
    });

    it("are deleted with the meeting and when their author is anonymized", async () => {
      const context = await setup();
      const created = await series(context);
      await test.services.privateNotes.save(context.editor, created.firstMeetingId, {
        document: { type: "doc", content: [paragraph("Mine")] },
        revision: 0,
      });
      await test.services.privateNotes.save(context.lead, created.firstMeetingId, {
        document: { type: "doc", content: [paragraph("Mine too")] },
        revision: 0,
      });
      await test.pool.query(
        "insert into role_assignments (id, scope, principal_kind, principal_id, built_in_role) values (gen_random_uuid(), 'instance', 'account', $1, 'administrator')",
        [context.org.owner],
      );
      await test.services.accountLifecycle.anonymize(accountPrincipal(context.org.owner), context.editorId, {
        reason: "Erasure request",
        confirmation: "Editor",
      });
      const remaining = await test.database.execute<{ account_id: string }>(
        sql`select account_id from meeting_private_notes where meeting_id = ${created.firstMeetingId}`,
      );
      expect(remaining.rows.map((row) => row.account_id)).toEqual([context.leadId]);
      await test.database.execute(sql`delete from tree_items where id = ${created.firstMeetingId}`);
      const left = await test.database.execute(
        sql`select 1 from meeting_private_notes where meeting_id = ${created.firstMeetingId}`,
      );
      expect(left.rows).toHaveLength(0);
    });
  });
});
