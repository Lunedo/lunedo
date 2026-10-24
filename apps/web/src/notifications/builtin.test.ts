import { describe, expect, it } from "vitest";
import "./builtin.js";
import { notificationTypes } from "./notification-types.js";
import type { NotificationItem } from "./notifications-api.js";

function linkFor(type: string, params: Record<string, unknown>) {
  const definition = notificationTypes.list().find((entry) => entry.id === type);
  return definition?.link({
    type,
    target: { type: "item", id: "01929b1e-0000-7000-8000-0000000000d1" },
    params,
  } as unknown as NotificationItem);
}

describe("links of notifications", () => {
  it("open the comment a notification is about", () => {
    const link = linkFor("comment.created", {
      itemTitle: "Restart the VPN gateway",
      itemKind: "page",
      spaceKey: "OPS",
      commentId: "01929b1e-0000-7000-8000-0000000000e1",
    });
    expect(link?.to).toBe("/spaces/OPS/pages/01929b1e-0000-7000-8000-0000000000d1/restart-the-vpn-gateway");
    expect(link?.search).toEqual({ comment: "01929b1e-0000-7000-8000-0000000000e1" });
  });

  it("open only the page when the notification names no comment", () => {
    expect(
      linkFor("content.changed", { itemTitle: "Restart", itemKind: "page", spaceKey: "OPS" })?.search,
    ).toBeUndefined();
  });
});
