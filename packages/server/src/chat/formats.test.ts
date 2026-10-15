import { describe, expect, it } from "vitest";
import { OutboundError } from "../outbound/guarded-request.js";
import {
  type ChatMessage,
  chatRequest,
  classifyError,
  classifyResponse,
  webhookSignature,
} from "./formats.js";

const message: ChatMessage = {
  event: "pagePublished",
  heading: "New page in IT <Ops> & more",
  title: "Restart *the* VPN | gateway @everyone",
  detail: "Published by Anna <script>",
  link: { url: "https://wiki.example.org/spaces/ITOPS/pages/1/restart", label: "Open in Pagehall" },
  occurredAt: new Date("2026-10-15T10:00:00Z"),
  space: { id: "0192a000-0000-7000-8000-000000000001", key: "ITOPS", name: "IT Ops" },
  organizationId: "0192a000-0000-7000-8000-000000000002",
  item: { id: "0192a000-0000-7000-8000-000000000003", kind: "page" },
  actor: "Anna",
};

const now = new Date("2026-10-15T10:00:05Z");
const delivery = { id: "0192a000-0000-7000-8000-0000000000aa", signingSecret: null, message, now };

function bodyOf(request: { body: Buffer | string }): Record<string, unknown> {
  return JSON.parse(String(request.body)) as Record<string, unknown>;
}

describe("chatRequest", () => {
  it("posts an Adaptive Card to a Teams Workflows webhook", () => {
    const request = chatRequest({
      ...delivery,
      kind: "teams",
      target: { url: "https://prod.logic.azure.com/w" },
    });
    expect(request).toMatchObject({ url: "https://prod.logic.azure.com/w", method: "POST" });
    const body = bodyOf(request) as {
      type: string;
      attachments: {
        contentType: string;
        content: { type: string; body: { text: string }[]; actions: unknown[] };
      }[];
    };
    expect(body.type).toBe("message");
    expect(body.attachments[0]?.contentType).toBe("application/vnd.microsoft.card.adaptive");
    expect(body.attachments[0]?.content.type).toBe("AdaptiveCard");
    expect(body.attachments[0]?.content.body.map((block) => block.text)).toEqual([
      String.raw`New page in IT <Ops\> & more`,
      String.raw`Restart \*the\* VPN \| gateway \@everyone`,
      String.raw`Published by Anna <script\>`,
    ]);
    const linked = chatRequest({
      ...delivery,
      message: { ...message, title: "[Sign in](https://phish.example)" },
      kind: "teams",
      target: { url: "https://prod.logic.azure.com/w" },
    });
    expect(String(linked.body)).not.toContain("[Sign in](https://phish.example)");
    expect(body.attachments[0]?.content.actions).toEqual([
      { type: "Action.OpenUrl", title: "Open in Pagehall", url: message.link?.url },
    ]);
  });

  it("posts Slack blocks as plain text, so names cannot mention or link anything", () => {
    const request = chatRequest({
      ...delivery,
      kind: "slack",
      target: { url: "https://hooks.slack.com/services/x" },
    });
    const body = bodyOf(request) as { text: string; blocks: { type: string; text?: { type: string } }[] };
    expect(body.text).toBe("New page in IT &lt;Ops&gt; &amp; more: Restart *the* VPN | gateway @everyone");
    expect(body.blocks.map((block) => block.type)).toEqual(["context", "section", "actions"]);
    expect(body.blocks[1]?.text?.type).toBe("plain_text");
    expect(body).toMatchObject({ unfurl_links: false, unfurl_media: false });
  });

  it("posts a Discord embed that never pings anyone", () => {
    const request = chatRequest({
      ...delivery,
      kind: "discord",
      target: { url: "https://discord.com/api/webhooks/1/x" },
    });
    const body = bodyOf(request) as {
      allowed_mentions: unknown;
      embeds: { title: string; url: string; description: string; author: { name: string } }[];
    };
    expect(body.allowed_mentions).toEqual({ parse: [] });
    expect(body.embeds[0]).toMatchObject({
      title: String.raw`Restart \*the\* VPN \| gateway \@everyone`,
      url: message.link?.url,
      author: { name: message.heading },
      description: String.raw`Published by Anna <script\>`,
    });
  });

  it("sends a Matrix notice with the delivery as transaction ID and escaped HTML", () => {
    const request = chatRequest({
      ...delivery,
      kind: "matrix",
      target: {
        homeserver: "https://matrix.example.org/",
        roomId: "!abc:example.org",
        accessToken: "syt_token",
      },
    });
    expect(request.method).toBe("PUT");
    expect(request.url).toBe(
      `https://matrix.example.org/_matrix/client/v3/rooms/!abc%3Aexample.org/send/m.room.message/${delivery.id}`,
    );
    expect(request.headers.authorization).toBe("Bearer syt_token");
    const body = bodyOf(request) as {
      msgtype: string;
      formatted_body: string;
      body: string;
      "m.mentions": unknown;
    };
    expect(body.msgtype).toBe("m.notice");
    expect(body["m.mentions"]).toEqual({});
    expect(body.formatted_body).toContain("Published by Anna &lt;script&gt;");
    expect(body.formatted_body).not.toContain("<script>");
    expect(body.body).toContain(message.link?.url);
  });

  it("signs the JSON body of a generic webhook", () => {
    const secret = "s3cret";
    const request = chatRequest({
      ...delivery,
      signingSecret: secret,
      kind: "webhook",
      target: { url: "https://example.com/hook" },
    });
    const timestamp = String(now.getTime() / 1000);
    expect(request.headers).toMatchObject({
      "x-pagehall-event": "pagePublished",
      "x-pagehall-delivery": delivery.id,
      "x-pagehall-timestamp": timestamp,
      "x-pagehall-signature": webhookSignature(secret, timestamp, String(request.body)),
    });
    expect(webhookSignature("other", timestamp, String(request.body))).not.toBe(
      request.headers["x-pagehall-signature"],
    );
    expect(bodyOf(request)).toMatchObject({
      id: delivery.id,
      event: "pagePublished",
      space: message.space,
      item: { id: message.item?.id, kind: "page", title: message.title, url: message.link?.url },
      actor: { name: "Anna" },
    });
  });
});

describe("classifyResponse", () => {
  const answer = (status: number, body = "") => ({ status, headers: {}, body });

  it.each([
    [200, "", null],
    [202, "", null],
    [204, "", null],
  ])("accepts %i", (status, body, expected) => {
    expect(classifyResponse("teams", answer(status, body))).toBe(expected);
  });

  it("explains why a service refused the message", () => {
    expect(classifyResponse("slack", answer(404, "no_service"))).toEqual({
      reason: "addressGone",
      status: 404,
      code: "no_service",
      permanent: true,
    });
    expect(classifyResponse("slack", answer(403, "invalid_token"))).toMatchObject({
      reason: "unauthorized",
      code: "invalid_token",
      permanent: true,
    });
    expect(
      classifyResponse("matrix", answer(403, '{"errcode":"M_FORBIDDEN","error":"not in room"}')),
    ).toMatchObject({
      reason: "unauthorized",
      code: "M_FORBIDDEN",
    });
    expect(
      classifyResponse("discord", answer(400, '{"code":50006,"message":"Cannot send an empty message"}')),
    ).toMatchObject({
      reason: "rejected",
      code: "50006",
      permanent: true,
    });
    expect(classifyResponse("teams", answer(429))).toMatchObject({ reason: "unavailable", permanent: false });
    expect(classifyResponse("teams", answer(503))).toMatchObject({ reason: "unavailable", permanent: false });
    expect(classifyResponse("slack", answer(500, "<html>long page</html>"))).toMatchObject({ code: null });
  });

  it("keeps address problems permanent and network problems retryable", () => {
    expect(classifyError(new OutboundError("blockedAddress", "x"))).toMatchObject({
      reason: "blockedAddress",
      permanent: true,
    });
    expect(classifyError(new OutboundError("timeout", "x"))).toMatchObject({
      reason: "unreachable",
      permanent: false,
    });
    expect(classifyError(new Error("boom"))).toMatchObject({ reason: "unreachable", permanent: false });
  });
});
