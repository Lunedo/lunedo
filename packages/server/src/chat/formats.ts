import { createHmac } from "node:crypto";
import type { ChatChannelKind, ChatEvent, ChatFailureReason } from "@pagehall/shared";
import { z } from "zod";
import { OutboundError, type OutboundRequest, type OutboundResponse } from "../outbound/guarded-request.js";

export const webhookTargetSchema = z.object({ url: z.string().min(1).max(2000) });
export const matrixTargetSchema = z.object({
  homeserver: z.string().min(1).max(2000),
  roomId: z.string().regex(/^![^:\s]+:\S+$/, "must look like !room:server"),
  accessToken: z.string().min(1).max(2000),
});

export const matrixInputSchema = matrixTargetSchema.extend({ roomId: z.string().min(1).max(500) });

export type WebhookTarget = z.infer<typeof webhookTargetSchema>;
export type MatrixTarget = z.infer<typeof matrixTargetSchema>;
export type ChatTarget = WebhookTarget | MatrixTarget;

export function targetSchemaOf(kind: ChatChannelKind): z.ZodType<ChatTarget> {
  return kind === "matrix" ? matrixTargetSchema : webhookTargetSchema;
}

export type RoomAddress = { roomId: string } | { alias: string };

export function parseRoomAddress(value: string): RoomAddress | null {
  let text = value.trim();
  const link = /^https:\/\/matrix\.to\/#\/(.+)$/i.exec(text);
  if (link?.[1]) {
    try {
      text = decodeURIComponent(link[1].split("?")[0] ?? "");
    } catch {
      return null;
    }
  }
  if (/^![^:\s]+:\S+$/.test(text)) return { roomId: text };
  if (/^#[^:\s]+:\S+$/.test(text)) return { alias: text };
  return null;
}

export function roomDirectoryRequest(
  homeserver: string,
  alias: string,
  accessToken: string,
): OutboundRequest {
  return {
    url: `${homeserver.replace(/\/+$/, "")}/_matrix/client/v3/directory/room/${encodeURIComponent(alias)}`,
    method: "GET",
    headers: { "user-agent": USER_AGENT, authorization: `Bearer ${accessToken}` },
    body: "",
  };
}

export interface ChatMessage {
  event: ChatEvent | "test";
  heading: string;
  title: string;
  detail: string | null;
  link: { url: string; label: string } | null;
  occurredAt: Date;
  space: { id: string; key: string; name: string } | null;
  organizationId: string;
  item: { id: string; kind: string } | null;
  actor: string | null;
}

export interface ChatDelivery {
  id: string;
  kind: ChatChannelKind;
  target: ChatTarget;
  signingSecret: string | null;
  message: ChatMessage;
  now: Date;
}

const USER_AGENT = "Pagehall";

function slackEscape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function htmlEscape(value: string): string {
  return slackEscape(value).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function markdownEscape(value: string): string {
  return value.replace(/([\\`*_~|>[\]()#@:-])/g, "\\$1");
}

function clip(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
}

function plainLines(message: ChatMessage): string[] {
  return [message.heading, message.title, message.detail ?? "", message.link?.url ?? ""].filter(Boolean);
}

function teams(message: ChatMessage): unknown {
  const body: unknown[] = [
    { type: "TextBlock", text: markdownEscape(message.heading), size: "Small", isSubtle: true, wrap: true },
    { type: "TextBlock", text: markdownEscape(message.title), weight: "Bolder", size: "Medium", wrap: true },
  ];
  if (message.detail) body.push({ type: "TextBlock", text: markdownEscape(message.detail), wrap: true });
  return {
    type: "message",
    attachments: [
      {
        contentType: "application/vnd.microsoft.card.adaptive",
        contentUrl: null,
        content: {
          $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
          type: "AdaptiveCard",
          version: "1.4",
          body,
          ...(message.link
            ? { actions: [{ type: "Action.OpenUrl", title: message.link.label, url: message.link.url }] }
            : {}),
        },
      },
    ],
  };
}

function slack(message: ChatMessage): unknown {
  const blocks: unknown[] = [
    { type: "context", elements: [{ type: "plain_text", text: clip(message.heading, 2000), emoji: false }] },
    {
      type: "section",
      text: {
        type: "plain_text",
        text: clip([message.title, message.detail].filter(Boolean).join("\n"), 3000),
        emoji: false,
      },
    },
  ];
  if (message.link) {
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: clip(message.link.label, 75), emoji: false },
          url: message.link.url,
        },
      ],
    });
  }
  return {
    text: slackEscape(clip(`${message.heading}: ${message.title}`, 3000)),
    blocks,
    unfurl_links: false,
    unfurl_media: false,
  };
}

function discord(message: ChatMessage): unknown {
  return {
    content: "",
    embeds: [
      {
        author: { name: clip(message.heading, 256) },
        title: clip(markdownEscape(message.title), 256),
        ...(message.link ? { url: message.link.url } : {}),
        ...(message.detail ? { description: clip(markdownEscape(message.detail), 4000) } : {}),
        timestamp: message.occurredAt.toISOString(),
      },
    ],
    allowed_mentions: { parse: [] },
  };
}

function matrix(message: ChatMessage): unknown {
  const title = message.link
    ? `<a href="${htmlEscape(message.link.url)}"><strong>${htmlEscape(message.title)}</strong></a>`
    : `<strong>${htmlEscape(message.title)}</strong>`;
  return {
    msgtype: "m.notice",
    body: plainLines(message).join("\n"),
    format: "org.matrix.custom.html",
    formatted_body: [
      `<p>${htmlEscape(message.heading)}</p>`,
      `<p>${title}</p>`,
      message.detail ? `<p>${htmlEscape(message.detail)}</p>` : "",
    ].join(""),
  };
}

function webhook(id: string, message: ChatMessage): unknown {
  return {
    id,
    event: message.event,
    occurredAt: message.occurredAt.toISOString(),
    organizationId: message.organizationId,
    space: message.space,
    item: message.item ? { ...message.item, title: message.title, url: message.link?.url ?? null } : null,
    actor: message.actor ? { name: message.actor } : null,
    text: plainLines(message).join("\n"),
  };
}

export function webhookSignature(secret: string, timestamp: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`, "utf8").digest("hex")}`;
}

export function chatRequest(delivery: ChatDelivery): OutboundRequest {
  const json = (url: string, payload: unknown, method: "POST" | "PUT" = "POST"): OutboundRequest => ({
    url,
    method,
    headers: { "content-type": "application/json", "user-agent": USER_AGENT },
    body: JSON.stringify(payload),
  });
  const { kind, target, message } = delivery;
  if (kind === "matrix") {
    const { homeserver, roomId, accessToken } = target as MatrixTarget;
    const base = homeserver.replace(/\/+$/, "");
    const request = json(
      `${base}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${encodeURIComponent(delivery.id)}`,
      matrix(message),
      "PUT",
    );
    return { ...request, headers: { ...request.headers, authorization: `Bearer ${accessToken}` } };
  }
  const { url } = target as WebhookTarget;
  if (kind === "teams") return json(url, teams(message));
  if (kind === "slack") return json(url, slack(message));
  if (kind === "discord") return json(url, discord(message));
  const body = JSON.stringify(webhook(delivery.id, message));
  const timestamp = String(Math.floor(delivery.now.getTime() / 1000));
  return {
    url,
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": USER_AGENT,
      "x-pagehall-event": message.event,
      "x-pagehall-delivery": delivery.id,
      "x-pagehall-timestamp": timestamp,
      ...(delivery.signingSecret
        ? { "x-pagehall-signature": webhookSignature(delivery.signingSecret, timestamp, body) }
        : {}),
    },
    body,
  };
}

export interface ChatFailure {
  reason: ChatFailureReason;
  status: number | null;
  code: string | null;
  permanent: boolean;
}

function codeOf(kind: ChatChannelKind, body: string): string | null {
  const text = body.trim();
  if (kind === "slack" && /^[a-z_]{1,60}$/.test(text)) return text;
  try {
    const parsed = JSON.parse(text) as
      | string
      | { errcode?: unknown; code?: unknown; error?: { code?: unknown } }
      | null;
    if (typeof parsed === "string") return kind === "slack" && /^[a-z_]{1,60}$/.test(parsed) ? parsed : null;
    if (!parsed || typeof parsed !== "object") return null;
    const code = kind === "matrix" ? parsed.errcode : (parsed.error?.code ?? parsed.code);
    if (typeof code === "number" && Number.isInteger(code)) return String(code);
    if (typeof code === "string" && /^[A-Za-z0-9_.]{1,60}$/.test(code)) return code;
  } catch {
    return null;
  }
  return null;
}

export function classifyResponse(kind: ChatChannelKind, response: OutboundResponse): ChatFailure | null {
  const { status } = response;
  if (status >= 200 && status < 300) return null;
  const code = codeOf(kind, response.body);
  if (status === 404 || status === 410) return { reason: "addressGone", status, code, permanent: true };
  if (status === 401 || status === 403) return { reason: "unauthorized", status, code, permanent: true };
  if (status === 408 || status === 429 || status >= 500) {
    return { reason: "unavailable", status, code, permanent: false };
  }
  return { reason: "rejected", status, code, permanent: true };
}

export function classifyError(error: unknown): ChatFailure {
  if (error instanceof OutboundError) {
    if (error.reason === "blockedAddress") {
      return { reason: "blockedAddress", status: null, code: null, permanent: true };
    }
    if (error.reason === "insecureAddress") {
      return { reason: "insecureAddress", status: null, code: null, permanent: true };
    }
    if (error.reason === "invalidAddress" || error.reason === "tooManyRedirects") {
      return { reason: "rejected", status: null, code: error.reason, permanent: true };
    }
  }
  return { reason: "unreachable", status: null, code: null, permanent: false };
}
