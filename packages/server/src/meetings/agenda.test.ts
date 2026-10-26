import type { DocumentJson, NodeJson } from "@lunedo/editor-schema";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accountPrincipal } from "../accounts/principal.js";
import { bytesOf } from "../exports/fixtures.testing.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { spaceFixtures } from "../testing/spaces.js";
import { updateTextOf, withTask, withUpdateText } from "./agenda.js";
import type { Rhythm } from "./schedule.js";

const baseUrl = testDatabaseBaseUrl();
const WEEKLY: Rhythm = { frequency: "weekly", interval: 1, weekdays: ["MO"] };

function paragraph(value: string): NodeJson {
  return { type: "paragraph", content: [{ type: "text", text: value }] };
}

function blocksOf(document: NodeJson, topicId: string): NodeJson[] {
  const own = document.type === "topicUpdate" && document.attrs?.topicId === topicId ? [document] : [];
  return [...own, ...(document.content ?? []).flatMap((child) => blocksOf(child, topicId))];
}

describe("topic update blocks", () => {
  it("replace the plain text and keep the task lists", () => {
    const task = {
      type: "taskList",
      content: [{ type: "taskItem", attrs: { id: null }, content: [paragraph("T")] }],
    };
    const block: NodeJson = {
      type: "topicUpdate",
      attrs: { topicId: "x" },
      content: [paragraph("Old"), task],
    };
    const next = withUpdateText(block, "First\n\nSecond\n");
    expect(next.content).toEqual([paragraph("First"), { type: "paragraph" }, paragraph("Second"), task]);
    expect(updateTextOf(next)).toEqual({ text: "First\n\nSecond", formatted: false });
    expect(withUpdateText(block, "  ").content).toEqual([task]);
    expect(withUpdateText({ ...block, content: [paragraph("x")] }, "").content).toEqual([
      { type: "paragraph" },
    ]);
  });

  it("count marks and other blocks as formatting", () => {
    const bold: NodeJson = {
      type: "paragraph",
      content: [{ type: "text", text: "Bold", marks: [{ type: "bold" }] }],
    };
    expect(updateTextOf({ type: "topicUpdate", content: [bold] }).formatted).toBe(true);
    expect(
      updateTextOf({ type: "topicUpdate", content: [{ type: "bulletList", content: [] }] }).formatted,
    ).toBe(true);
  });

  it("append tasks to the last task list or start one, replacing an empty paragraph", () => {
    const empty: NodeJson = {
      type: "topicUpdate",
      attrs: { topicId: "x" },
      content: [{ type: "paragraph" }],
    };
    const first = withTask(empty, { id: "a", text: "One", assignee: null, dueDate: null });
    expect(first.content?.map((node) => node.type)).toEqual(["taskList"]);
    const second = withTask(first, { id: "b", text: "Two", assignee: null, dueDate: "2030-01-02" });
    expect(second.content?.[0]?.content?.map((item) => item.attrs?.id)).toEqual(["a", "b"]);
    const withText = withTask(
      { ...empty, content: [paragraph("Note")] },
      { id: "c", text: "Three", assignee: null, dueDate: null },
    );
    expect(withText.content?.map((node) => node.type)).toEqual(["paragraph", "taskList"]);
  });
});

describe.skipIf(!baseUrl)("meeting agenda", () => {
  let test: TestServices;

  let meetingNow: Date | null = null;

  async function meetingStart(meetingId: string): Promise<Date | null> {
    const result = await test.pool.query<{ starts_at: Date | null }>(
      "select starts_at from meetings where item_id = $1",
      [meetingId],
    );
    return result.rows[0]?.starts_at ?? null;
  }

  async function closeMeeting(...args: Parameters<TestServices["services"]["meetings"]["close"]>) {
    meetingNow = await meetingStart(args[1]);
    try {
      return await test.services.meetings.close(...args);
    } finally {
      meetingNow = null;
    }
  }
  const { organization, member, space } = spaceFixtures(() => test);

  beforeAll(async () => {
    test = await createTestServices(baseUrl ?? "", { meetingClock: () => meetingNow ?? new Date() });
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
    const created = await space(org.id, leadId, {
      grants: [
        { principalKind: "account", principalId: editorId, role: "editor" },
        { principalKind: "account", principalId: readerId, role: "reader" },
      ],
    });
    const seriesId = await test.services.meetings.createSeries(accountPrincipal(leadId), created.id, {
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
    const upcoming = (await test.services.meetings.details(accountPrincipal(leadId), seriesId)).upcoming;
    if (!upcoming) throw new Error("The series has no upcoming meeting");
    return {
      org,
      space: created,
      leadId,
      editorId,
      readerId,
      lead: accountPrincipal(leadId),
      editor: accountPrincipal(editorId),
      reader: accountPrincipal(readerId),
      seriesId,
      meetingId: upcoming.id,
    };
  }

  type Context = Awaited<ReturnType<typeof setup>>;

  async function topics(context: Context, ...titles: string[]): Promise<string[]> {
    const ids: string[] = [];
    for (const title of titles)
      ids.push(await test.services.topics.create(context.lead, context.seriesId, { title }));
    return ids;
  }

  async function document(itemId: string): Promise<DocumentJson> {
    const snapshot = await test.services.documents.snapshot(itemId);
    if (!snapshot) throw new Error("The page has no content");
    return snapshot.document;
  }

  it("lists all open topics in one order that a drag changes for everyone", async () => {
    const context = await setup();
    const [first, second, third] = await topics(context, "Firewall", "Printers", "Holidays");
    const titles = async (viewer = context.lead) =>
      (await test.services.agenda.agenda(viewer, context.meetingId)).topics.map((topic) => topic.title);
    expect(await titles()).toEqual(["Firewall", "Printers", "Holidays"]);
    await test.services.agenda.moveTopic(context.lead, context.seriesId, third ?? "", null);
    await test.services.agenda.moveTopic(context.lead, context.seriesId, first ?? "", second ?? "");
    expect(await titles()).toEqual(["Holidays", "Printers", "Firewall"]);
    expect(await titles(context.reader)).toEqual(["Holidays", "Printers", "Firewall"]);
    await expect(
      test.services.agenda.moveTopic(context.lead, context.seriesId, first ?? "", first ?? ""),
    ).rejects.toMatchObject({ code: "topicNotFound" });
    await test.services.topics.close(context.lead, second ?? "", { outcome: "resolved" });
    expect(await titles()).toEqual(["Holidays", "Firewall"]);
    await closeMeeting(context.lead, context.meetingId);
    const next = (await test.services.meetings.details(context.lead, context.seriesId)).upcoming;
    const nextAgenda = await test.services.agenda.agenda(context.lead, next?.id ?? "");
    expect(nextAgenda.topics.map((topic) => topic.title)).toEqual(["Holidays", "Firewall"]);
  });

  it("saves this meeting's update into the notes, keeps tasks and shows it as the last update next time", async () => {
    const context = await setup();
    const [topicId = ""] = await topics(context, "Firewall");
    await test.services.agenda.saveUpdate(context.editor, context.meetingId, topicId, "Window on 1 Nov.");
    const taskId = await test.services.agenda.addTask(context.editor, context.meetingId, topicId, {
      text: "Check the switches",
      assigneeId: context.editorId,
      dueDate: "2030-03-25",
    });
    await test.services.agenda.saveUpdate(context.editor, context.meetingId, topicId, "Window on 2 Nov.");
    const [block] = blocksOf(await document(context.meetingId), topicId);
    expect(block?.content?.map((node) => node.type)).toEqual(["paragraph", "taskList"]);
    const agenda = await test.services.agenda.agenda(context.lead, context.meetingId);
    expect(agenda.topics[0]?.update).toEqual({ text: "Window on 2 Nov.", formatted: false });
    expect(agenda.topics[0]?.tasks).toEqual([
      expect.objectContaining({ id: taskId, text: "Check the switches", done: false, dueDate: "2030-03-25" }),
    ]);
    expect(agenda.tasks.map((task) => task.id)).toEqual([taskId]);
    expect((await test.services.topics.list(context.reader, context.seriesId))[0]?.openTasks).toBe(1);
    const mine = await test.services.tasks.list(context.editor, { assignee: "me" });
    expect(mine.items.map((task) => task.id)).toEqual([taskId]);

    await closeMeeting(context.lead, context.meetingId);
    const next = (await test.services.meetings.details(context.lead, context.seriesId)).upcoming;
    const later = await test.services.agenda.agenda(context.lead, next?.id ?? "");
    expect(later.topics[0]?.update).toEqual({ text: "", formatted: false });
    expect(later.topics[0]?.previous.map((entry) => entry.text)).toEqual(["Window on 2 Nov."]);
    expect(later.topics[0]?.tasks.map((task) => task.id)).toEqual([taskId]);
    await expect(
      test.services.agenda.saveUpdate(context.editor, context.meetingId, topicId, "Too late"),
    ).rejects.toMatchObject({ code: "meetingClosed" });
    const closed = await test.services.agenda.agenda(context.lead, context.meetingId);
    expect(closed.current).toBe(false);
    expect(closed.topics.map((topic) => topic.id)).toEqual([topicId]);
  });

  it("starts the history with the description and counts the meetings a topic has been on", async () => {
    const context = await setup();
    const topicId = await test.services.topics.create(context.lead, context.seriesId, {
      title: "Firewall",
      description: "Two offers to compare.",
      meetingId: context.meetingId,
    });
    const [closedId = ""] = await topics(context, "Printers");
    await test.services.topics.close(context.lead, closedId, {
      outcome: "resolved",
      meetingId: context.meetingId,
    });
    const first = await test.services.agenda.agenda(context.lead, context.meetingId);
    expect(first.closedTopics).toBe(1);
    expect(first.topics[0]).toMatchObject({
      update: { text: "Two offers to compare.", formatted: false },
      history: [],
      meetings: 1,
    });
    await closeMeeting(context.lead, context.meetingId);
    const second = (await test.services.meetings.details(context.lead, context.seriesId)).upcoming?.id ?? "";
    await test.services.agenda.saveUpdate(context.lead, second, topicId, "Vendor B chosen.");
    await closeMeeting(context.lead, second);
    const third = (await test.services.meetings.details(context.lead, context.seriesId)).upcoming?.id ?? "";
    const agenda = await test.services.agenda.agenda(context.lead, third);
    expect(agenda.closedTopics).toBe(0);
    expect(agenda.topics[0]?.history.map((entry) => [entry.meetingId, entry.text])).toEqual([
      [context.meetingId, "Two offers to compare."],
      [second, "Vendor B chosen."],
    ]);
    expect(agenda.topics[0]?.meetings).toBe(3);
    const earlier = await test.services.agenda.agenda(context.lead, second);
    expect(earlier.topics[0]?.history.map((entry) => entry.meetingId)).toEqual([context.meetingId]);
    const meeting = await test.services.meetings.meeting(context.lead, second);
    expect(meeting.previousMeeting?.id).toBe(context.meetingId);
    expect(meeting.followingMeeting?.id).toBe(third);
    expect(
      (await test.services.meetings.meeting(context.lead, context.meetingId)).previousMeeting,
    ).toBeNull();
    await expect(
      test.services.topics.create(context.lead, context.seriesId, {
        title: "Too late",
        description: "No open meeting",
        meetingId: context.meetingId,
      }),
    ).rejects.toMatchObject({ code: "meetingRequired" });
  });

  it("removes untouched template sections from existing meeting pages and keeps written ones", async () => {
    const context = await setup();
    const [topicId = ""] = await topics(context, "Firewall");
    await test.services.agenda.saveUpdate(context.lead, context.meetingId, topicId, "Window on 1 Nov.");
    const placeholder = (text: string): NodeJson => ({
      type: "paragraph",
      content: [{ type: "placeholder", attrs: { text } }],
    });
    await test.database.transaction((tx) =>
      test.services.documents.editLocked(
        tx,
        context.meetingId,
        (current) => ({
          ...current,
          content: [
            { type: "section", attrs: { key: "agenda", title: "Agenda" }, content: [placeholder("Topic")] },
            ...(current.content ?? []),
            { type: "section", attrs: { key: "notes", title: "Notes" }, content: [paragraph("Kept")] },
            {
              type: "section",
              attrs: { key: "openTasks", title: "Open tasks" },
              content: [{ type: "taskReport", attrs: { status: "open" } }],
            },
          ],
        }),
        context.leadId,
      ),
    );
    expect(await test.services.meetingTemplateSections.pending()).toBe(true);
    const silent = { info: () => {} } as unknown as Parameters<
      TestServices["services"]["meetingTemplateSections"]["removeUntouched"]
    >[0];
    expect(await test.services.meetingTemplateSections.removeUntouched(silent)).toMatchObject({ cleaned: 1 });
    const keys = (await document(context.meetingId)).content
      ?.filter((node) => node.type === "section")
      .map((node) => node.attrs?.key);
    expect(keys).toEqual(["runningTopics", "notes"]);
    expect((await test.services.agenda.agenda(context.lead, context.meetingId)).topics[0]?.update?.text).toBe(
      "Window on 1 Nov.",
    );
    expect(await test.services.meetingTemplateSections.removeUntouched(silent)).toMatchObject({ cleaned: 0 });
  });

  it("saves updates and records decisions at the same moment without a deadlock", async () => {
    const context = await setup();
    const ids = await topics(context, "One", "Two", "Three", "Four");
    for (const [index, topicId] of ids.entries()) {
      await Promise.all([
        test.services.agenda.saveUpdate(context.editor, context.meetingId, topicId, `Update ${index}`),
        test.services.topics.closeAsDecision(context.lead, topicId, {
          statement: `Decision ${index}`,
          meetingId: context.meetingId,
        }),
      ]);
    }
    const decided = await test.services.topics.list(context.lead, context.seriesId, { status: "closed" });
    expect(decided.map((topic) => topic.outcome)).toEqual(["decided", "decided", "decided", "decided"]);
  });

  it("refuses to overwrite an update with formatting and topics of another series", async () => {
    const context = await setup();
    const [topicId = ""] = await topics(context, "Firewall");
    await test.database.transaction((tx) =>
      test.services.documents.editLocked(
        tx,
        context.meetingId,
        (current) => {
          const visit = (node: NodeJson): NodeJson =>
            node.type === "topicUpdate" && node.attrs?.topicId === topicId
              ? {
                  ...node,
                  content: [
                    { type: "bulletList", content: [{ type: "listItem", content: [paragraph("A")] }] },
                  ],
                }
              : node.content
                ? { ...node, content: node.content.map(visit) }
                : node;
          return visit(current) as DocumentJson;
        },
        context.leadId,
      ),
    );
    await expect(
      test.services.agenda.saveUpdate(context.editor, context.meetingId, topicId, "Plain"),
    ).rejects.toMatchObject({ code: "updateFormatted" });
    const other = await setup();
    const [foreign = ""] = await topics(other, "Elsewhere");
    await expect(
      test.services.agenda.saveUpdate(context.editor, context.meetingId, foreign, "x"),
    ).rejects.toMatchObject({ code: "topicNotFound" });
    await expect(
      test.services.agenda.addTask(context.editor, context.meetingId, topicId, { text: " " }),
    ).rejects.toMatchObject({ code: "invalidTask" });
  });

  it("keeps a topic for one meeting only in that meeting and closes it with the meeting", async () => {
    const context = await setup();
    const [running = ""] = await topics(context, "Running");
    const oneOff = await test.services.topics.create(context.lead, context.seriesId, {
      title: "Only today",
      meetingId: context.meetingId,
      oneOff: true,
    });
    await expect(
      test.services.topics.create(context.lead, context.seriesId, { title: "No meeting", oneOff: true }),
    ).rejects.toMatchObject({ code: "meetingRequired" });
    const extraId = await test.services.meetings.addExtra(
      context.lead,
      context.seriesId,
      new Date("2030-03-20T10:00:00Z"),
    );
    const extra = await test.services.agenda.agenda(context.lead, extraId);
    expect(extra.topics.map((topic) => topic.id)).toEqual([running]);
    expect((await test.services.meetings.details(context.lead, context.seriesId)).openTopics).toBe(1);
    await closeMeeting(context.lead, context.meetingId);
    const topic = await test.services.topics.get(context.lead, oneOff);
    expect(topic).toMatchObject({ status: "closed", outcome: "resolved", oneOff: true });
    await test.services.meetings.undoClose(context.lead, context.meetingId);
    expect(await test.services.topics.get(context.lead, oneOff)).toMatchObject({ status: "open" });
  });

  it("moves the topics for one meeting to the next meeting when that meeting is skipped", async () => {
    const context = await setup();
    const oneOff = await test.services.topics.create(context.lead, context.seriesId, {
      title: "Only today",
      meetingId: context.meetingId,
      oneOff: true,
    });
    const { nextMeetingId } = await test.services.meetings.skip(context.lead, context.meetingId);
    const next = await test.services.agenda.agenda(context.lead, nextMeetingId);
    expect(next.topics.map((topic) => topic.id)).toContain(oneOff);
    expect(await test.services.topics.get(context.lead, oneOff)).toMatchObject({
      status: "open",
      raisedIn: { id: nextMeetingId },
    });
    await closeMeeting(context.lead, nextMeetingId);
    expect(await test.services.topics.get(context.lead, oneOff)).toMatchObject({ status: "closed" });
  });

  it("plans an additional meeting outside the rhythm with the same open topics", async () => {
    const context = await setup();
    const [first = ""] = await topics(context, "Firewall");
    const extraId = await test.services.meetings.addExtra(
      context.lead,
      context.seriesId,
      new Date("2030-03-20T10:00:00Z"),
    );
    const details = await test.services.meetings.details(context.lead, context.seriesId);
    expect(details.upcoming?.id).toBe(context.meetingId);
    expect(blocksOf(await document(extraId), first)).toHaveLength(1);
    const added = await test.services.topics.create(context.lead, context.seriesId, { title: "New" });
    expect(blocksOf(await document(extraId), added)).toHaveLength(1);
    expect(blocksOf(await document(context.meetingId), added)).toHaveLength(1);
    const meeting = await test.services.meetings.meeting(context.lead, extraId);
    expect(meeting).toMatchObject({ extra: true, state: "upcoming", current: true });
    await expect(test.services.meetings.skip(context.lead, extraId)).rejects.toMatchObject({
      code: "extraMeetingNotSkippable",
    });
    expect(await closeMeeting(context.lead, extraId)).toEqual({ nextMeetingId: null });
    const after = await test.services.meetings.details(context.lead, context.seriesId);
    expect(after.upcoming?.id).toBe(context.meetingId);
  });

  it("treats an additional meeting before the regular one as the next meeting everywhere", async () => {
    const context = await setup();
    const extraId = await test.services.meetings.addExtra(
      context.lead,
      context.seriesId,
      new Date("2030-03-14T10:00:00Z"),
    );
    const details = await test.services.meetings.details(context.lead, context.seriesId);
    expect(details.upcoming?.id).toBe(extraId);
    const listed = await test.services.meetings.meetings(context.lead, context.seriesId);
    expect(listed.items.filter((meeting) => meeting.next).map((meeting) => meeting.id)).toEqual([extraId]);
    expect((await test.services.meetings.meeting(context.lead, extraId)).next).toBe(true);
    expect((await test.services.meetings.meeting(context.lead, context.meetingId)).next).toBe(false);
    expect(await test.services.meetings.currentMeeting(test.database, context.seriesId)).toBe(extraId);
    const spaceId =
      (
        await test.pool.query<{ space_id: string }>("select space_id from tree_items where id = $1", [
          context.seriesId,
        ])
      ).rows[0]?.space_id ?? "";
    const series = await test.services.meetings.listSeries(context.lead, spaceId);
    expect(series.find((entry) => entry.id === context.seriesId)?.upcomingAt?.toISOString()).toBe(
      "2030-03-14T10:00:00.000Z",
    );
  });

  it("refuses to mark a meeting as held before its day", async () => {
    const context = await setup();
    await expect(test.services.meetings.close(context.lead, context.meetingId)).rejects.toMatchObject({
      code: "meetingInFuture",
    });
    expect((await test.services.meetings.meeting(context.lead, context.meetingId)).state).toBe("upcoming");
    meetingNow = new Date("2030-03-18T05:00:00Z");
    try {
      await test.services.meetings.close(context.lead, context.meetingId);
    } finally {
      meetingNow = null;
    }
    expect((await test.services.meetings.meeting(context.lead, context.meetingId)).state).toBe("closed");
  });

  it("records guests without an account in the attendance, never as people with access", async () => {
    const context = await setup();
    const guestId = await test.services.meetings.addGuest(context.editor, context.meetingId, {
      name: "  Martin   Huber ",
      note: "Service provider",
    });
    await test.services.meetings.setGuestAttendance(context.editor, context.meetingId, guestId, "present");
    const meeting = await test.services.meetings.meeting(context.reader, context.meetingId);
    expect(meeting.guests).toEqual([
      { id: guestId, name: "Martin Huber", note: "Service provider", attendance: "present" },
    ]);
    expect(meeting.attendees.map((attendee) => attendee.id)).not.toContain(guestId);
    const stored = await test.database.execute<{ added_by: string; updated_by: string }>(
      sql`select added_by, updated_by from meeting_guests where id = ${guestId}`,
    );
    expect(stored.rows[0]).toEqual({ added_by: context.editorId, updated_by: context.editorId });
    await expect(
      test.services.meetings.addGuest(context.editor, context.meetingId, { name: " " }),
    ).rejects.toMatchObject({ code: "invalidGuestName" });
    const exported = await test.services.exports.page(context.lead, context.meetingId, "markdown");
    expect((await bytesOf(exported)).toString("utf8")).toContain("Martin Huber");
    await test.services.meetings.removeGuest(context.editor, context.meetingId, guestId);
    await expect(
      test.services.meetings.setGuestAttendance(context.editor, context.meetingId, guestId, "absent"),
    ).rejects.toMatchObject({ code: "guestNotFound" });
  });

  it("stores the overview layout per series with pinned pages the viewer can see", async () => {
    const context = await setup();
    expect((await test.services.meetings.details(context.reader, context.seriesId)).overview).toEqual({
      columns: [
        ["topics", "tasks"],
        ["meetings", "decisions"],
      ],
      hidden: ["attendance", "links"],
      links: [],
    });
    const page = await test.services.tree.create(context.lead, context.space.id, {
      kind: "page",
      mode: "live",
      placement: { parentId: null },
      title: "Network plan",
    });
    await test.services.meetings.setOverview(context.lead, context.seriesId, {
      columns: [["links", "topics"], ["attendance"]],
      hidden: ["tasks"],
      links: [page.id],
    });
    const overview = (await test.services.meetings.details(context.reader, context.seriesId)).overview;
    expect(overview.columns).toEqual([["links", "topics"], ["attendance"]]);
    expect(overview.hidden).toEqual(["tasks", "decisions", "meetings"]);
    expect(overview.links).toEqual([
      { id: page.id, number: page.number, title: "Network plan", kind: "page", spaceKey: context.space.key },
    ]);
    await test.services.pageAccess.change(context.lead, page.id, [{ action: "restrict", kind: "view" }]);
    expect((await test.services.meetings.details(context.reader, context.seriesId)).overview.links).toEqual(
      [],
    );
    expect(
      (await test.services.meetings.details(context.lead, context.seriesId)).overview.links,
    ).toHaveLength(1);
    await expect(
      test.services.meetings.setOverview(context.lead, context.seriesId, {
        columns: [["topics", "topics"], []],
        hidden: [],
        links: [],
      }),
    ).rejects.toMatchObject({ code: "invalidLayout" });
    await expect(
      test.services.meetings.setOverview(context.lead, context.seriesId, {
        columns: [["unknown"], []],
        hidden: [],
        links: [],
      }),
    ).rejects.toMatchObject({ code: "invalidLayout" });
    const other = await setup();
    const foreign = await test.services.tree.create(other.lead, other.space.id, {
      kind: "page",
      mode: "live",
      placement: { parentId: null },
      title: "Elsewhere",
    });
    await expect(
      test.services.meetings.setOverview(context.lead, context.seriesId, {
        columns: [[], []],
        hidden: [],
        links: [foreign.id],
      }),
    ).rejects.toMatchObject({ code: "invalidOverviewLink" });
  });

  it("computes attendance over the last ten meetings", async () => {
    const context = await setup();
    await test.services.meetings.setAttendance(context.lead, context.meetingId, context.leadId, "present");
    await test.services.meetings.setAttendance(context.lead, context.meetingId, context.editorId, "excused");
    await closeMeeting(context.lead, context.meetingId);
    const rates = await test.services.meetings.attendance(context.reader, context.seriesId);
    expect(rates.map(({ id, present, meetings }) => ({ id, present, meetings }))).toEqual([
      { id: context.leadId, present: 1, meetings: 1 },
      { id: context.editorId, present: 0, meetings: 1 },
    ]);
  });
});
