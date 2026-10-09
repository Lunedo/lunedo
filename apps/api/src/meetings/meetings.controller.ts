import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Put, Query, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { Permission } from "../access/route-access.js";
import { servicesOf } from "../auth/auth.controller.js";
import { API_CONTEXT, type ApiContext } from "../context.js";
import { ApiRoute } from "../http/api-route.js";
import { decodeCursor, encodeCursor } from "../http/pagination.js";
import { actorOf } from "../http/request.js";
import { uuid } from "../http/schemas.js";
import {
  addAttendeeSchema,
  attendanceSchema,
  closeTopicSchema,
  createSeriesSchema,
  createTopicSchema,
  decideTopicSchema,
  decisionEntrySchema,
  decisionQuerySchema,
  exampleMeeting,
  exampleMeetingSummary,
  examplePrivateNotes,
  exampleSeries,
  exampleTopic,
  meetingSchema,
  meetingSummarySchema,
  meetingsQuerySchema,
  moveMeetingSchema,
  nextDateSchema,
  privateNotesListSchema,
  privateNotesSchema,
  savePrivateNotesSchema,
  seriesListSchema,
  seriesSchema,
  topicDetailsSchema,
  topicQuerySchema,
  topicSchema,
  upcomingQuerySchema,
  upcomingSchema,
  updateSeriesSchema,
  updateTopicSchema,
} from "./schemas.js";

const TAG = "Meetings";
const space = { type: "space", param: "spaceId" } as const;
const series = { type: "item", param: "seriesId" } as const;
const meeting = { type: "item", param: "meetingId" } as const;
const topic = { type: "item", param: "topicId" } as const;
const spaceParams = z.object({ spaceId: uuid("ID of the space.") }).strict();
const seriesParams = z.object({ seriesId: uuid("ID of the meeting series.") }).strict();
const meetingParams = z.object({ meetingId: uuid("ID of the meeting page.") }).strict();
const attendeeParams = meetingParams.extend({ accountId: uuid("ID of the attendee.") }).strict();
const topicParams = z.object({ topicId: uuid("ID of the running topic.") }).strict();
const meetingCursor = z.tuple([z.string().max(64), z.string().max(40)]);
const ended = z
  .object({ ended: z.boolean().describe("True to end the series, false to continue it.") })
  .strict()
  .describe("Whether the series has ended.");

@Controller("api/v1")
export class MeetingsController {
  constructor(@Inject(API_CONTEXT) private readonly context: ApiContext) {}

  get #services() {
    return servicesOf(this.context);
  }

  @Get("spaces/:spaceId/meeting-series")
  @Permission("space.view", space)
  @ApiRoute({
    summary: "List the meeting series of a space",
    description: "Lists the series of the space the caller can read: running series first, then ended ones.",
    tags: [TAG],
    params: spaceParams,
    response: {
      description: "The series.",
      schema: seriesListSchema,
      example: [
        {
          id: exampleSeries.id,
          title: exampleSeries.title,
          archived: false,
          upcomingAt: exampleMeetingSummary.startsAt,
        },
      ],
    },
  })
  async listSeries(@Param("spaceId") spaceId: string, @Req() request: FastifyRequest) {
    return this.#services.meetings.listSeries(actorOf(request), spaceId);
  }

  @Post("spaces/:spaceId/meeting-series")
  @Permission("space.edit", space)
  @ApiRoute({
    summary: "Create a meeting series",
    description:
      "Creates a series with its members, schedule and template, and its first meeting. Without a fixed rhythm the first meeting takes place at `startsOn` and `startTime`.",
    tags: [TAG],
    params: spaceParams,
    body: createSeriesSchema,
    bodyExample: {
      name: "Jour fixe IT",
      parentId: null,
      members: ["01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a20"],
      templateId: "builtin:team-meeting",
      rhythm: { frequency: "weekly", interval: 1, weekdays: ["MO"] },
      startsOn: "2026-10-12",
      startTime: "09:30",
      timeZone: "Europe/Vienna",
      durationMinutes: 45,
    },
    status: 201,
    response: { description: "The new series.", schema: seriesSchema, example: exampleSeries },
    errors: [
      "invalidTitle",
      "invalidRhythm",
      "invalidSchedule",
      "invalidTimeZone",
      "invalidDuration",
      "invalidMember",
      "tooManyMembers",
      "invalidPlacement",
      "templateNotFound",
    ],
  })
  async createSeries(
    @Param("spaceId") spaceId: string,
    @Body() body: z.output<typeof createSeriesSchema>,
    @Req() request: FastifyRequest,
  ) {
    const actor = actorOf(request);
    const id = await this.#services.meetings.createSeries(actor, spaceId, body);
    return this.#services.meetings.details(actor, id);
  }

  @Get("meeting-series/:seriesId")
  @Permission("item.view", series)
  @ApiRoute({
    summary: "Get a meeting series",
    description: "Returns members, schedule, template and the next meeting of a series.",
    tags: [TAG],
    params: seriesParams,
    response: { description: "The series.", schema: seriesSchema, example: exampleSeries },
  })
  async series(@Param("seriesId") seriesId: string, @Req() request: FastifyRequest) {
    return this.#services.meetings.details(actorOf(request), seriesId);
  }

  @Patch("meeting-series/:seriesId")
  @Permission("item.edit", series)
  @ApiRoute({
    summary: "Change a meeting series",
    description:
      "Changes name, members, template or schedule. A new schedule moves the upcoming meeting to the new rhythm and drops earlier moves and exceptions. New members join the upcoming meeting.",
    tags: [TAG],
    params: seriesParams,
    body: updateSeriesSchema,
    bodyExample: { members: ["01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a20"] },
    response: { description: "The series.", schema: seriesSchema, example: exampleSeries },
    errors: [
      "invalidTitle",
      "invalidRhythm",
      "invalidSchedule",
      "invalidTimeZone",
      "invalidMember",
      "seriesEnded",
    ],
  })
  async updateSeries(
    @Param("seriesId") seriesId: string,
    @Body() body: z.output<typeof updateSeriesSchema>,
    @Req() request: FastifyRequest,
  ) {
    const actor = actorOf(request);
    await this.#services.meetings.updateSeries(actor, seriesId, body);
    return this.#services.meetings.details(actor, seriesId);
  }

  @Put("meeting-series/:seriesId/ended")
  @Permission("item.archive", series)
  @ApiRoute({
    summary: "End a meeting series or continue it",
    description:
      "Ending archives the series with its meetings and topics: read-only and without a next meeting. Continuing brings it back.",
    tags: [TAG],
    params: seriesParams,
    body: ended,
    bodyExample: { ended: true },
  })
  async end(
    @Param("seriesId") seriesId: string,
    @Body() body: z.output<typeof ended>,
    @Req() request: FastifyRequest,
  ) {
    await this.#services.meetings.details(actorOf(request), seriesId);
    if (body.ended) await this.#services.archive.archive(actorOf(request), seriesId);
    else await this.#services.archive.unarchive(actorOf(request), seriesId);
  }

  @Get("meeting-series/:seriesId/meetings")
  @Permission("item.view", series)
  @ApiRoute({
    summary: "List the meetings of a series",
    description: "Lists the meetings newest first; a meeting that is not scheduled yet comes first.",
    tags: [TAG],
    params: seriesParams,
    query: meetingsQuerySchema,
    response: {
      description: "The meetings.",
      schema: z
        .object({
          items: z.array(meetingSummarySchema).describe("Meetings."),
          nextCursor: z.string().nullable().describe("Cursor for the next page, or null."),
        })
        .describe("A page of meetings."),
      example: { items: [exampleMeetingSummary], nextCursor: null },
    },
  })
  async meetings(
    @Param("seriesId") seriesId: string,
    @Query() query: z.output<typeof meetingsQuerySchema>,
    @Req() request: FastifyRequest,
  ) {
    const after = decodeCursor(query.cursor, meetingCursor) ?? undefined;
    const result = await this.#services.meetings.meetings(actorOf(request), seriesId, {
      after,
      limit: query.limit,
    });
    return { items: result.items, nextCursor: result.next ? encodeCursor(result.next) : null };
  }

  @Get("meetings/upcoming")
  @Permission("instance.content.view")
  @ApiRoute({
    summary: "List upcoming meetings",
    description: "Lists the next meeting of every series the caller can read, the soonest first.",
    tags: [TAG],
    query: upcomingQuerySchema,
    response: {
      description: "Upcoming meetings.",
      schema: upcomingSchema,
      example: [
        {
          id: exampleMeetingSummary.id,
          title: exampleMeetingSummary.title,
          startsAt: exampleMeetingSummary.startsAt,
          durationMinutes: 45,
          seriesId: exampleSeries.id,
          seriesTitle: exampleSeries.title,
          spaceId: exampleSeries.spaceId,
          spaceKey: "ITOPS",
          oneOnOne: false,
        },
      ],
    },
  })
  async upcoming(@Query() query: z.output<typeof upcomingQuerySchema>, @Req() request: FastifyRequest) {
    return this.#services.meetings.upcoming(actorOf(request), {
      limit: query.limit,
      ...(query.oneOnOne === undefined ? {} : { oneOnOne: query.oneOnOne }),
    });
  }

  @Get("meetings/:meetingId")
  @Permission("item.view", meeting)
  @ApiRoute({
    summary: "Get a meeting",
    description:
      "Returns state, time and attendees of a meeting. The notes are the content of the meeting page; read them through the page content.",
    tags: [TAG],
    params: meetingParams,
    response: { description: "The meeting.", schema: meetingSchema, example: exampleMeeting },
  })
  async meeting(@Param("meetingId") meetingId: string, @Req() request: FastifyRequest) {
    return this.#services.meetings.meeting(actorOf(request), meetingId);
  }

  @Post("meetings/:meetingId/close")
  @Permission("item.edit", meeting)
  @ApiRoute({
    summary: "Close a meeting",
    description:
      "Closes the meeting and notifies the attendees that the notes are available. Closing the upcoming meeting creates the next one: the next occurrence of the rhythm after now, or, without a fixed rhythm, at `nextStartsAt`. When two people close at the same moment, one succeeds and the other gets `meetingClosed`.",
    tags: [TAG],
    status: 200,
    params: meetingParams,
    body: nextDateSchema,
    bodyExample: {},
    response: {
      description: "The meeting created next, if any.",
      schema: z
        .object({
          nextMeetingId: uuid("The next meeting, or null after closing a reopened meeting.").nullable(),
        })
        .describe("The result."),
      example: { nextMeetingId: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f6a11" },
    },
    errors: ["meetingClosed", "nextDateRequired", "seriesEnded"],
  })
  async close(
    @Param("meetingId") meetingId: string,
    @Body() body: z.output<typeof nextDateSchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.meetings.close(actorOf(request), meetingId, { nextStartsAt: body.nextStartsAt });
  }

  @Post("meetings/:meetingId/close/undo")
  @Permission("item.edit", meeting)
  @ApiRoute({
    summary: "Undo closing a meeting",
    description:
      "Opens a closed meeting again. The meeting created by closing it is removed while nobody has touched it; otherwise it stays and this works like reopening. Unread notifications about the notes are withdrawn.",
    tags: [TAG],
    status: 200,
    params: meetingParams,
    response: {
      description: "The removed meeting, if any.",
      schema: z
        .object({ removedMeetingId: uuid("The next meeting that was removed, or null.").nullable() })
        .describe("The result."),
      example: { removedMeetingId: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f6a11" },
    },
    errors: ["meetingNotClosed", "seriesEnded"],
  })
  async undoClose(@Param("meetingId") meetingId: string, @Req() request: FastifyRequest) {
    return this.#services.meetings.undoClose(actorOf(request), meetingId);
  }

  @Post("meetings/:meetingId/reopen")
  @Permission("item.edit", meeting)
  @ApiRoute({
    summary: "Reopen a closed meeting",
    description: "Opens a closed meeting again. The next meeting stays.",
    tags: [TAG],
    status: 204,
    params: meetingParams,
    errors: ["meetingNotClosed", "seriesEnded"],
  })
  async reopen(@Param("meetingId") meetingId: string, @Req() request: FastifyRequest) {
    await this.#services.meetings.reopen(actorOf(request), meetingId);
  }

  @Post("meetings/:meetingId/skip")
  @Permission("item.edit", meeting)
  @ApiRoute({
    summary: "Skip the upcoming meeting",
    description:
      "Marks the upcoming meeting as skipped and keeps its agenda. The following meeting is created with the agenda carried over.",
    tags: [TAG],
    status: 200,
    params: meetingParams,
    body: nextDateSchema,
    bodyExample: {},
    response: {
      description: "The following meeting.",
      schema: z.object({ nextMeetingId: uuid("The following meeting.") }).describe("The result."),
      example: { nextMeetingId: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f6a11" },
    },
    errors: ["meetingNotUpcoming", "nextDateRequired", "seriesEnded"],
  })
  async skip(
    @Param("meetingId") meetingId: string,
    @Body() body: z.output<typeof nextDateSchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.meetings.skip(actorOf(request), meetingId, { nextStartsAt: body.nextStartsAt });
  }

  @Put("meetings/:meetingId/start")
  @Permission("item.edit", meeting)
  @ApiRoute({
    summary: "Move the upcoming meeting",
    description:
      "Sets a new start for the upcoming meeting. With a rhythm, the move is kept as a moved occurrence of the series.",
    tags: [TAG],
    status: 204,
    params: meetingParams,
    body: moveMeetingSchema,
    bodyExample: { startsAt: "2026-10-13T12:00:00.000Z" },
    errors: ["meetingNotUpcoming", "startRequired", "seriesEnded"],
  })
  async move(
    @Param("meetingId") meetingId: string,
    @Body() body: z.output<typeof moveMeetingSchema>,
    @Req() request: FastifyRequest,
  ) {
    await this.#services.meetings.move(actorOf(request), meetingId, body.startsAt);
  }

  @Post("meetings/:meetingId/attendees")
  @Permission("item.edit", meeting)
  @ApiRoute({
    summary: "Add an attendee",
    description:
      "Adds a person beyond the members of the series. Someone without read access is listed with `canRead: false`; share the meeting page with them to give access.",
    tags: [TAG],
    status: 204,
    params: meetingParams,
    body: addAttendeeSchema,
    bodyExample: { accountId: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a21" },
    errors: ["invalidMember", "tooManyAttendees"],
  })
  async addAttendee(
    @Param("meetingId") meetingId: string,
    @Body() body: z.output<typeof addAttendeeSchema>,
    @Req() request: FastifyRequest,
  ) {
    await this.#services.meetings.addAttendee(actorOf(request), meetingId, body.accountId);
  }

  @Put("meetings/:meetingId/attendees/:accountId")
  @Permission("item.edit", meeting)
  @ApiRoute({
    summary: "Record attendance",
    description:
      "Sets present, excused or absent for an attendee. Attendance is stored apart from the notes.",
    tags: [TAG],
    status: 204,
    params: attendeeParams,
    body: attendanceSchema,
    bodyExample: { attendance: "present" },
    errors: ["attendeeNotFound"],
  })
  async attendance(
    @Param("meetingId") meetingId: string,
    @Param("accountId") accountId: string,
    @Body() body: z.output<typeof attendanceSchema>,
    @Req() request: FastifyRequest,
  ) {
    await this.#services.meetings.setAttendance(actorOf(request), meetingId, accountId, body.attendance);
  }

  @Delete("meetings/:meetingId/attendees/:accountId")
  @Permission("item.edit", meeting)
  @ApiRoute({
    summary: "Remove an attendee",
    description: "Removes a person from the attendees of this meeting. Series members stay members.",
    tags: [TAG],
    status: 204,
    params: attendeeParams,
  })
  async removeAttendee(
    @Param("meetingId") meetingId: string,
    @Param("accountId") accountId: string,
    @Req() request: FastifyRequest,
  ) {
    await this.#services.meetings.removeAttendee(actorOf(request), meetingId, accountId);
  }

  @Get("meetings/:meetingId/private-notes")
  @Permission("item.view", meeting)
  @ApiRoute({
    summary: "Get your private notes on a meeting",
    description:
      "Returns the caller's own private notes. Nobody else can read them: not the other attendees, not space admins, not administrators.",
    tags: [TAG],
    params: meetingParams,
    response: { description: "The notes.", schema: privateNotesSchema, example: examplePrivateNotes },
    errors: ["notesNeedAccount"],
  })
  async privateNotes(@Param("meetingId") meetingId: string, @Req() request: FastifyRequest) {
    return this.#services.privateNotes.get(actorOf(request), meetingId);
  }

  @Put("meetings/:meetingId/private-notes")
  @Permission("item.view", meeting)
  @ApiRoute({
    summary: "Save your private notes on a meeting",
    description:
      "Stores the caller's private notes, validated against the editor schema. The revision must match the stored notes, so a save from another window is not overwritten.",
    tags: [TAG],
    params: meetingParams,
    body: savePrivateNotesSchema,
    bodyExample: { document: examplePrivateNotes.document, revision: 3 },
    response: { description: "The saved notes.", schema: privateNotesSchema, example: examplePrivateNotes },
    errors: ["notesChanged", "notesTooLarge", "invalidDocument", "notesNeedAccount"],
  })
  async savePrivateNotes(
    @Param("meetingId") meetingId: string,
    @Body() body: z.output<typeof savePrivateNotesSchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.privateNotes.save(actorOf(request), meetingId, body);
  }

  @Get("meeting-series/:seriesId/private-notes")
  @Permission("item.view", series)
  @ApiRoute({
    summary: "List your private notes of a series",
    description: "Lists the caller's own private notes on the meetings of a series in one list.",
    tags: [TAG],
    params: seriesParams,
    response: {
      description: "The notes.",
      schema: privateNotesListSchema,
      example: [
        {
          meetingId: exampleMeetingSummary.id,
          meetingTitle: exampleMeetingSummary.title,
          startsAt: exampleMeetingSummary.startsAt,
          document: examplePrivateNotes.document,
          updatedAt: examplePrivateNotes.updatedAt,
        },
      ],
    },
    errors: ["notesNeedAccount"],
  })
  async seriesNotes(@Param("seriesId") seriesId: string, @Req() request: FastifyRequest) {
    return this.#services.privateNotes.listForSeries(actorOf(request), seriesId);
  }

  @Get("meeting-series/:seriesId/topics")
  @Permission("item.view", series)
  @ApiRoute({
    summary: "List the running topics of a series",
    description:
      "Lists topics with filters for status, owner, label, period and title, the most recently updated first.",
    tags: [TAG],
    params: seriesParams,
    query: topicQuerySchema,
    response: {
      description: "The topics.",
      schema: z.array(topicSchema).describe("Topics."),
      example: [exampleTopic],
    },
  })
  async topics(
    @Param("seriesId") seriesId: string,
    @Query() query: z.output<typeof topicQuerySchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.topics.list(actorOf(request), seriesId, query);
  }

  @Post("meeting-series/:seriesId/topics")
  @Permission("item.edit", series)
  @ApiRoute({
    summary: "Add a running topic",
    description: "Creates a topic and adds it to the upcoming meeting.",
    tags: [TAG],
    params: seriesParams,
    body: createTopicSchema,
    bodyExample: { title: "Positions in AD", labels: ["directory"] },
    status: 201,
    response: {
      description: "The topic.",
      schema: topicDetailsSchema,
      example: {
        ...exampleTopic,
        spaceId: exampleSeries.spaceId,
        seriesTitle: exampleSeries.title,
        timeline: [],
        decision: null,
      },
    },
    errors: ["invalidTitle", "invalidLabel", "tooManyLabels", "invalidMember", "seriesEnded"],
  })
  async createTopic(
    @Param("seriesId") seriesId: string,
    @Body() body: z.output<typeof createTopicSchema>,
    @Req() request: FastifyRequest,
  ) {
    const actor = actorOf(request);
    const id = await this.#services.topics.create(actor, seriesId, body);
    return this.#services.topics.get(actor, id);
  }

  @Get("topics/:topicId")
  @Permission("item.view", topic)
  @ApiRoute({
    summary: "Get a running topic",
    description:
      "Returns status, owner, labels, the timeline of all updates with their meeting and the linked decision, as far as the caller can read them.",
    tags: [TAG],
    params: topicParams,
    response: {
      description: "The topic.",
      schema: topicDetailsSchema,
      example: {
        ...exampleTopic,
        spaceId: exampleSeries.spaceId,
        seriesTitle: exampleSeries.title,
        timeline: [],
        decision: null,
      },
    },
  })
  async topic(@Param("topicId") topicId: string, @Req() request: FastifyRequest) {
    return this.#services.topics.get(actorOf(request), topicId);
  }

  @Patch("topics/:topicId")
  @Permission("item.edit", topic)
  @ApiRoute({
    summary: "Change a running topic",
    description: "Changes title, owner or labels.",
    tags: [TAG],
    params: topicParams,
    body: updateTopicSchema,
    bodyExample: { ownerId: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a20" },
    response: {
      description: "The topic.",
      schema: topicDetailsSchema,
      example: {
        ...exampleTopic,
        spaceId: exampleSeries.spaceId,
        seriesTitle: exampleSeries.title,
        timeline: [],
        decision: null,
      },
    },
    errors: ["invalidTitle", "invalidLabel", "tooManyLabels", "invalidMember", "seriesEnded"],
  })
  async updateTopic(
    @Param("topicId") topicId: string,
    @Body() body: z.output<typeof updateTopicSchema>,
    @Req() request: FastifyRequest,
  ) {
    const actor = actorOf(request);
    await this.#services.topics.update(actor, topicId, body);
    return this.#services.topics.get(actor, topicId);
  }

  @Post("topics/:topicId/close")
  @Permission("item.edit", topic)
  @ApiRoute({
    summary: "Close a running topic",
    description: "Closes the topic as resolved or dropped. It leaves later meetings; its history stays.",
    tags: [TAG],
    status: 204,
    params: topicParams,
    body: closeTopicSchema,
    bodyExample: { outcome: "resolved" },
    errors: ["topicClosed", "seriesEnded"],
  })
  async closeTopic(
    @Param("topicId") topicId: string,
    @Body() body: z.output<typeof closeTopicSchema>,
    @Req() request: FastifyRequest,
  ) {
    await this.#services.topics.close(actorOf(request), topicId, body);
  }

  @Post("topics/:topicId/reopen")
  @Permission("item.edit", topic)
  @ApiRoute({
    summary: "Reopen a running topic",
    description: "Opens a closed topic again and adds it to the upcoming meeting.",
    tags: [TAG],
    status: 204,
    params: topicParams,
    errors: ["seriesEnded"],
  })
  async reopenTopic(@Param("topicId") topicId: string, @Req() request: FastifyRequest) {
    await this.#services.topics.reopen(actorOf(request), topicId);
  }

  @Post("topics/:topicId/decision")
  @Permission("item.edit", topic)
  @ApiRoute({
    summary: "Close a running topic as a decision",
    description:
      "Inserts a decision block linked to the topic into the current meeting, closes the topic with outcome `decided` and links both. The topic keeps its history.",
    tags: [TAG],
    status: 200,
    params: topicParams,
    body: decideTopicSchema,
    bodyExample: { statement: "Positions are kept in AD and synchronized nightly." },
    response: {
      description: "The decision and the meeting it was recorded in.",
      schema: z
        .object({ decisionId: uuid("The new decision."), meetingId: uuid("The meeting it is in.") })
        .describe("The result."),
      example: { decisionId: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f6c00", meetingId: exampleMeetingSummary.id },
    },
    errors: ["topicClosed", "meetingNotEditable", "invalidStatement", "seriesEnded"],
  })
  async decide(
    @Param("topicId") topicId: string,
    @Body() body: z.output<typeof decideTopicSchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.topics.closeAsDecision(actorOf(request), topicId, body);
  }

  @Get("meeting-series/:seriesId/decisions")
  @Permission("item.view", series)
  @ApiRoute({
    summary: "List the decision log of a series",
    description:
      "Lists the decisions recorded in the meetings of a series, newest first, with filters for period, topic and text.",
    tags: [TAG],
    params: seriesParams,
    query: decisionQuerySchema,
    response: {
      description: "The decisions.",
      schema: z.array(decisionEntrySchema).describe("Decisions."),
      example: [
        {
          id: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f6c00",
          statement: [{ type: "paragraph", content: [{ type: "text", text: "Laptops get BitLocker." }] }],
          text: "Laptops get BitLocker.",
          meeting: {
            id: exampleMeetingSummary.id,
            title: exampleMeetingSummary.title,
            startsAt: exampleMeetingSummary.startsAt,
          },
          topic: null,
          recordedAt: "2026-10-12T08:00:00.000Z",
        },
      ],
    },
  })
  async decisions(
    @Param("seriesId") seriesId: string,
    @Query() query: z.output<typeof decisionQuerySchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.decisions.log(actorOf(request), seriesId, query);
  }
}
