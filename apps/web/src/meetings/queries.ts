import { queryOptions } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import { api } from "../api/client.js";
import type { paths } from "../api/generated/schema.js";
import { request } from "../api/request.js";
import { localDateInZone } from "../format/zoned.js";
import { translateKey } from "../i18n/translate.js";

type Json<T> = T extends { content: { "application/json": infer Body } } ? Body : never;
type Ok<Path extends keyof paths, Method extends "get" | "post" | "put" | "patch" | "delete"> = Json<
  NonNullable<paths[Path][Method]> extends { responses: infer Responses }
    ? Responses[keyof Responses & (200 | 201)]
    : never
>;

export type Series = Ok<"/api/v1/meeting-series/{seriesId}", "get">;
export type SeriesListEntry = Ok<"/api/v1/spaces/{spaceId}/meeting-series", "get">[number];
export type MeetingSummary = Ok<"/api/v1/meeting-series/{seriesId}/meetings", "get">["items"][number];
export type Meeting = Ok<"/api/v1/meetings/{meetingId}", "get">;
export type Attendee = Meeting["attendees"][number];
export type Guest = Meeting["guests"][number];
export type Agenda = Ok<"/api/v1/meetings/{meetingId}/agenda", "get">;
export type AgendaTopic = Agenda["topics"][number];
export type AgendaTask = Agenda["tasks"][number];
export type AttendanceRate = Ok<"/api/v1/meeting-series/{seriesId}/attendance", "get">[number];
export type Topic = Ok<"/api/v1/meeting-series/{seriesId}/topics", "get">[number];
export type TopicDetails = Ok<"/api/v1/topics/{topicId}", "get">;
export type DecisionEntry = Ok<"/api/v1/meeting-series/{seriesId}/decisions", "get">[number];
export type PrivateNotes = Ok<"/api/v1/meetings/{meetingId}/private-notes", "get">;
export type UpcomingMeeting = Ok<"/api/v1/meetings/upcoming", "get">[number];
export type OneOnOne = Ok<"/api/v1/one-on-ones", "get">[number];
export type TopicQuery = NonNullable<
  paths["/api/v1/meeting-series/{seriesId}/topics"]["get"]["parameters"]["query"]
>;
export type DecisionQuery = NonNullable<
  paths["/api/v1/meeting-series/{seriesId}/decisions"]["get"]["parameters"]["query"]
>;

export const meetingKeys = {
  all: ["meetings"] as const,
  spaceSeries: (spaceId: string) => ["meetings", "space", spaceId] as const,
  series: (seriesId: string) => ["meetings", "series", seriesId] as const,
  seriesMeetings: (seriesId: string) => ["meetings", "series", seriesId, "meetings"] as const,
  topics: (seriesId: string, query: TopicQuery = {}) =>
    ["meetings", "series", seriesId, "topics", query] as const,
  decisions: (seriesId: string, query: DecisionQuery = {}) =>
    ["meetings", "series", seriesId, "decisions", query] as const,
  seriesNotes: (seriesId: string) => ["meetings", "series", seriesId, "notes"] as const,
  meeting: (meetingId: string) => ["meetings", "meeting", meetingId] as const,
  agenda: (meetingId: string) => ["meetings", "meeting", meetingId, "agenda"] as const,
  attendance: (seriesId: string) => ["meetings", "series", seriesId, "attendance"] as const,
  notes: (meetingId: string) => ["meetings", "meeting", meetingId, "notes"] as const,
  topic: (topicId: string) => ["meetings", "topic", topicId] as const,
  upcoming: (oneOnOne?: boolean) => ["meetings", "upcoming", oneOnOne ?? null] as const,
  oneOnOnes: ["meetings", "oneOnOnes"] as const,
};

export function spaceSeriesQuery(spaceId: string) {
  return queryOptions({
    queryKey: meetingKeys.spaceSeries(spaceId),
    queryFn: () =>
      request(() => api.GET("/api/v1/spaces/{spaceId}/meeting-series", { params: { path: { spaceId } } })),
  });
}

export function seriesQuery(seriesId: string) {
  return queryOptions({
    queryKey: meetingKeys.series(seriesId),
    queryFn: () =>
      request(() => api.GET("/api/v1/meeting-series/{seriesId}", { params: { path: { seriesId } } })),
  });
}

export function meetingQuery(meetingId: string) {
  return queryOptions({
    queryKey: meetingKeys.meeting(meetingId),
    queryFn: () =>
      request(() => api.GET("/api/v1/meetings/{meetingId}", { params: { path: { meetingId } } })),
  });
}

export function agendaQuery(meetingId: string) {
  return queryOptions({
    queryKey: meetingKeys.agenda(meetingId),
    queryFn: () =>
      request(() => api.GET("/api/v1/meetings/{meetingId}/agenda", { params: { path: { meetingId } } })),
  });
}

export function attendanceQuery(seriesId: string) {
  return queryOptions({
    queryKey: meetingKeys.attendance(seriesId),
    queryFn: () =>
      request(() =>
        api.GET("/api/v1/meeting-series/{seriesId}/attendance", { params: { path: { seriesId } } }),
      ),
  });
}

export function topicsQuery(seriesId: string, query: TopicQuery = {}) {
  return queryOptions({
    queryKey: meetingKeys.topics(seriesId, query),
    queryFn: () =>
      request(() =>
        api.GET("/api/v1/meeting-series/{seriesId}/topics", { params: { path: { seriesId }, query } }),
      ),
  });
}

export function decisionsQuery(seriesId: string, query: DecisionQuery = {}) {
  return queryOptions({
    queryKey: meetingKeys.decisions(seriesId, query),
    queryFn: () =>
      request(() =>
        api.GET("/api/v1/meeting-series/{seriesId}/decisions", { params: { path: { seriesId }, query } }),
      ),
  });
}

export function topicQuery(topicId: string) {
  return queryOptions({
    queryKey: meetingKeys.topic(topicId),
    queryFn: () => request(() => api.GET("/api/v1/topics/{topicId}", { params: { path: { topicId } } })),
  });
}

export function privateNotesQuery(meetingId: string) {
  return queryOptions({
    queryKey: meetingKeys.notes(meetingId),
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: () =>
      request(() =>
        api.GET("/api/v1/meetings/{meetingId}/private-notes", { params: { path: { meetingId } } }),
      ),
  });
}

export function seriesNotesQuery(seriesId: string) {
  return queryOptions({
    queryKey: meetingKeys.seriesNotes(seriesId),
    queryFn: () =>
      request(() =>
        api.GET("/api/v1/meeting-series/{seriesId}/private-notes", { params: { path: { seriesId } } }),
      ),
  });
}

export interface MeetingStateInput {
  state: string;
  next: boolean;
  startsAt: string | null;
}

export function isToday(startsAt: string, timeZone: string, now: Date = new Date()): boolean {
  return localDateInZone(new Date(startsAt), timeZone) === localDateInZone(now, timeZone);
}

export function meetingState(meeting: MeetingStateInput, timeZone: string, now: Date = new Date()): string {
  if (meeting.state !== "upcoming") return meeting.state;
  if (!meeting.startsAt) return meeting.next ? "upcoming" : "planned";
  const day = localDateInZone(new Date(meeting.startsAt), timeZone);
  const today = localDateInZone(now, timeZone);
  if (day === today) return "today";
  if (day < today) return "open";
  return meeting.next ? "upcoming" : "planned";
}

export function meetingStateLabel(t: TFunction, meeting: MeetingStateInput, timeZone: string): string {
  return translateKey(t, `meetings.state.${meetingState(meeting, timeZone)}`);
}

export function meetingStateAccent(meeting: MeetingStateInput, timeZone: string): boolean {
  const state = meetingState(meeting, timeZone);
  return state === "today" || state === "upcoming";
}

export function upcomingQuery(oneOnOne?: boolean) {
  return queryOptions({
    queryKey: meetingKeys.upcoming(oneOnOne),
    queryFn: () =>
      request(() =>
        api.GET("/api/v1/meetings/upcoming", {
          params: {
            query: { limit: 8, ...(oneOnOne === undefined ? {} : { oneOnOne: oneOnOne ? "true" : "false" }) },
          },
        }),
      ),
  });
}

export function oneOnOnesQuery() {
  return queryOptions({
    queryKey: meetingKeys.oneOnOnes,
    queryFn: () => request(() => api.GET("/api/v1/one-on-ones")),
  });
}

export function seriesPath(spaceKey: string, seriesId: string): string {
  return `/spaces/${encodeURIComponent(spaceKey)}/meetings/${seriesId}`;
}

export function topicPath(spaceKey: string, topicId: string): string {
  return `/spaces/${encodeURIComponent(spaceKey)}/topics/${topicId}`;
}
