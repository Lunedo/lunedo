import type { Page } from "@playwright/test";
import type { Organization } from "./fixtures.js";
import { callApi } from "./helpers.js";
import { type Person, unique } from "./people.js";

export interface CollaborationSpace {
  id: string;
  key: string;
  colleague: Person;
}

export function paragraph(text: string) {
  return { type: "paragraph", content: [{ type: "text", text }] };
}

export async function collaborationSpace(
  page: Page,
  organization: Organization,
): Promise<CollaborationSpace> {
  await page.goto("/spaces");
  const colleague = await organization.invite("Carla");
  const key = `CO${unique()}`;
  const space = (await callApi(page, "POST", `/api/v1/organizations/${organization.id}/spaces`, {
    name: "Collaboration",
    key,
    visibility: "private",
    grants: [{ principalKind: "account", principalId: colleague.id, role: "commenter" }],
  })) as { id: string };
  return { id: space.id, key, colleague };
}

export async function vpnPage(page: Page, space: CollaborationSpace): Promise<{ id: string; path: string }> {
  const created = (await callApi(page, "POST", `/api/v1/spaces/${space.id}/items`, {
    kind: "page",
    title: "VPN access",
    parentId: null,
    mode: "publish",
  })) as { id: string };
  await callApi(page, "PUT", `/api/v1/pages/${created.id}/content`, {
    document: {
      type: "doc",
      content: [
        paragraph("Hotel Wi-Fi blocks UDP on port 51820."),
        {
          type: "taskList",
          content: [
            {
              type: "taskItem",
              attrs: { assignee: space.colleague.id, dueDate: "2026-12-01" },
              content: [paragraph("Test the TCP fallback")],
            },
          ],
        },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Ask " },
            { type: "mention", attrs: { id: space.colleague.id } },
            { type: "text", text: " about hotels." },
          ],
        },
      ],
    },
  });
  await callApi(page, "POST", `/api/v1/pages/${created.id}/publish`, {});
  return { id: created.id, path: `/spaces/${space.key}/pages/${created.id}/vpn-access` };
}

export async function publishedPost(page: Page, space: CollaborationSpace): Promise<string> {
  const post = (await callApi(page, "POST", `/api/v1/spaces/${space.id}/blog`, {
    title: "New VPN client from Monday",
    excerpt: "Existing tunnels keep working.",
  })) as { id: string };
  await callApi(page, "PUT", `/api/v1/pages/${post.id}/content`, {
    document: { type: "doc", content: [paragraph("The company portal ships the new client on Monday.")] },
  });
  await callApi(page, "POST", `/api/v1/pages/${post.id}/publish`, {});
  return post.id;
}

export async function commentOnVpnPage(page: Page, pageId: string): Promise<void> {
  await callApi(page, "POST", `/api/v1/pages/${pageId}/comments`, {
    body: { type: "doc", content: [paragraph("Happened twice this week.")] },
    anchor: { exact: "Hotel Wi-Fi blocks UDP on port 51820.", prefix: "", suffix: "" },
  });
}
