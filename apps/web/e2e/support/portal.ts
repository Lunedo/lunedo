import { expect, type Page } from "@playwright/test";
import { callApi } from "./helpers.js";
import { unique } from "./people.js";

export type Audience = "public" | "signedIn" | "groups" | "portal";

export interface PortalArticle {
  id: string;
  title: string;
  address: string;
}

export interface PortalFixture {
  spaceId: string;
  spaceKey: string;
  name: string;
  path: string;
  categories: Record<string, string>;
  articles: PortalArticle[];
}

const paragraph = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });

const HOW_TO = (lead: string) => ({
  type: "doc",
  content: [
    {
      type: "section",
      attrs: { key: "summary", title: "What this is about" },
      content: [paragraph(lead)],
    },
    {
      type: "section",
      attrs: { key: "prerequisites", title: "Before you start" },
      content: [
        {
          type: "bulletList",
          content: [
            { type: "listItem", content: [paragraph("You work on a company laptop.")] },
            { type: "listItem", content: [paragraph("Two-factor sign-in is set up.")] },
          ],
        },
      ],
    },
    {
      type: "section",
      attrs: { key: "steps", title: "Steps", icon: "list-ordered" },
      content: [
        {
          type: "orderedList",
          content: [
            { type: "listItem", content: [paragraph("Open the VPN client from the start menu.")] },
            { type: "listItem", content: [paragraph("Enter the server address and choose Connect.")] },
            { type: "listItem", content: [paragraph("Confirm the sign-in in the authenticator app.")] },
          ],
        },
        {
          type: "callout",
          attrs: { variant: "info" },
          content: [paragraph("The client remembers the address. Next time one click on Connect is enough.")],
        },
      ],
    },
    {
      type: "section",
      attrs: { key: "help", title: "Did it not work?" },
      content: [paragraph("Restart the laptop and try again.")],
    },
  ],
});

const TROUBLESHOOTING = (lead: string) => ({
  type: "doc",
  content: [
    {
      type: "section",
      attrs: { key: "symptom", title: "What you see", icon: "eye" },
      content: [paragraph(lead)],
    },
    {
      type: "section",
      attrs: { key: "cause", title: "Cause", icon: "search" },
      content: [paragraph("The printer waits until you release the job at the device with your badge.")],
    },
    {
      type: "section",
      attrs: { key: "resolution", title: "Solution", icon: "wrench" },
      content: [
        paragraph("Hold your badge to the reader and release the job under My jobs."),
        {
          type: "callout",
          attrs: { variant: "warning" },
          content: [paragraph("Jobs that are not released within 24 hours are deleted.")],
        },
      ],
    },
  ],
});

export async function createPortal(
  page: Page,
  options: { audience: Audience; groupIds?: string[]; organizationId: string; name?: string },
): Promise<PortalFixture> {
  const name = options.name ?? `Help ${unique()}`;
  const space = (await callApi(page, "POST", `/api/v1/organizations/${options.organizationId}/spaces`, {
    name,
    key: `H${unique()
      .replace(/[^A-Za-z0-9]/g, "")
      .slice(0, 8)
      .toUpperCase()}`,
    type: "knowledgeBase",
    audience: "signedIn",
    grants: [],
  })) as { id: string; key: string };
  if (options.audience !== "signedIn") {
    await callApi(page, "PUT", `/api/v1/spaces/${space.id}/knowledge-base/audience`, {
      audience: options.audience,
      groupIds: options.groupIds ?? [],
      confirmWidening: true,
    });
  }
  await callApi(page, "PUT", `/api/v1/spaces/${space.id}/knowledge-base/contact`, {
    contactEmail: "help@example.org",
  });
  const categories: Record<string, string> = {};
  for (const [title, description, icon] of [
    ["IT", "Accounts, devices, printing and working from home.", "monitor"],
    ["People", "Leave, payroll, travel and your first days.", "users"],
    ["Academy", "Seminars, learning platform and funded training.", null],
  ] as const) {
    const folder = (await callApi(page, "POST", `/api/v1/spaces/${space.id}/items`, {
      kind: "folder",
      title,
      description,
      parentId: null,
    })) as { id: string };
    if (icon) await callApi(page, "PUT", `/api/v1/categories/${folder.id}`, { icon });
    categories[title] = folder.id;
  }
  await callApi(page, "PUT", `/api/v1/categories/${categories.IT}/contact`, {
    contactEmail: "it-support@example.org",
  });
  const remote = (await callApi(page, "POST", `/api/v1/spaces/${space.id}/items`, {
    kind: "folder",
    title: "Remote access",
    description: "Working from home, VPN client and certificates.",
    parentId: categories.IT,
  })) as { id: string };
  categories["Remote access"] = remote.id;
  const articles: PortalArticle[] = [];
  for (const [title, parent, type, lead] of [
    [
      "Set up the VPN connection from home",
      remote.id,
      "howTo",
      "With the VPN connection you reach the internal drives from home.",
    ],
    [
      "Printer shows job held",
      categories.IT,
      "troubleshooting",
      "Your print job is in the queue but nothing comes out of the printer.",
    ],
    [
      "VPN disconnects after a few minutes",
      remote.id,
      "troubleshooting",
      "The VPN connection drops after a short time.",
    ],
    [
      "Request leave",
      categories.People,
      "howTo",
      "Request leave in the time tracking portal and see who approves it.",
    ],
    ["Book a seminar", categories.Academy, "howTo", "Book seminars from the academy programme."],
  ] as const) {
    const item = (await callApi(page, "POST", `/api/v1/spaces/${space.id}/items`, {
      kind: "page",
      title,
      parentId: parent,
      articleType: type,
    })) as { id: string };
    await callApi(page, "PUT", `/api/v1/pages/${item.id}/content`, {
      document: type === "howTo" ? HOW_TO(lead) : TROUBLESHOOTING(lead),
    });
    await callApi(page, "POST", `/api/v1/pages/${item.id}/publish`, {});
    const article = (await (await page.request.get(`/api/v1/articles/${item.id}`)).json()) as {
      number: number;
      slug: string;
    };
    articles.push({ id: item.id, title, address: `${article.number}-${article.slug}` });
  }
  const portal = (await (
    await page.request.get(`/api/v1/spaces/${space.id}/knowledge-base/portal`)
  ).json()) as {
    path: string;
  };
  return { spaceId: space.id, spaceKey: space.key, name, path: `/help/${portal.path}`, categories, articles };
}

export async function waitForIndex(page: Page, fixture: PortalFixture, query: string): Promise<void> {
  const matching = fixture.articles.filter((article) =>
    article.title.toLowerCase().includes(query.toLowerCase()),
  );
  const expected = (matching.length > 0 ? matching : fixture.articles.slice(0, 1)).map(
    (article) => article.address,
  );
  await expect
    .poll(
      async () => {
        const response = await page.request.get(`${fixture.path}/search?q=${encodeURIComponent(query)}`);
        const html = await response.text();
        return expected.length > 0 && expected.every((address) => html.includes(address));
      },
      { timeout: 30_000, intervals: [500, 1000] },
    )
    .toBe(true);
}
