import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getSchema } from "@tiptap/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { requiredSectionDecorations } from "../editor/extensions/required-sections.js";
import { schemaExtensions } from "../editor/schema/extensions.js";
import { SpaceContext, type SpaceContextValue } from "../spaces/space-context.js";
import type { SpaceWithRole } from "../spaces/space-queries.js";
import { canContain, creatableKinds } from "../spaces/space-types.js";
import { mockApi, renderWithProviders } from "../testing/render.js";
import { articleTypeIcon, articleTypeLabel, knownArticleType } from "./article-types.js";
import { NamedIcon } from "./icons.js";
import { AudienceForm } from "./settings/visibility-screen.js";

const SPACE_ID = "01929b1e-0000-7000-8000-0000000000b1";
const GROUP = { id: "01929b1e-0000-7000-8000-0000000000c1", name: "IT team" };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("content kinds by space type", () => {
  it("offer only articles and categories in a knowledge base", () => {
    expect(creatableKinds({ type: "knowledgeBase" })).toEqual(["page", "folder"]);
    expect(creatableKinds({ type: "standard" })).toEqual(["page", "folder", "whiteboard", "link"]);
    expect(canContain({ type: "knowledgeBase" }, "page")).toBe(false);
    expect(canContain({ type: "knowledgeBase" }, "folder")).toBe(true);
    expect(canContain({ type: "standard" }, "page")).toBe(true);
  });

  it("treat article types of later versions as unknown", () => {
    expect(knownArticleType("howTo")).toBe("howTo");
    expect(knownArticleType("faq")).toBeNull();
    const t = ((key: string) => key) as unknown as Parameters<typeof articleTypeLabel>[0];
    expect(articleTypeLabel(t, "faq")).toBe("knowledgeBase.articleTypes.other");
    expect(articleTypeIcon("faq")).toBe(articleTypeIcon(null));
  });
});

describe("icons of sections and categories", () => {
  it("render only known icons and ignore names of object properties", async () => {
    await renderWithProviders(
      <div data-testid="icons">
        <NamedIcon name="wrench" />
        <NamedIcon name="constructor" />
        <NamedIcon name="to-string" />
      </div>,
    );
    expect(screen.getByTestId("icons").querySelectorAll("svg")).toHaveLength(1);
  });
});

describe("required sections in the editor", () => {
  const schema = getSchema(schemaExtensions());
  const section = (key: string, title: string, content: object[]) => ({
    type: "section",
    attrs: { key, title },
    content,
  });
  const doc = schema.nodeFromJSON({
    type: "doc",
    content: [
      section("summary", "What this is about", [{ type: "paragraph" }]),
      section("steps", "Steps", [
        { type: "paragraph", content: [{ type: "text", text: "Open the client." }] },
      ]),
      section("help", "Did it not work?", [
        { type: "paragraph", content: [{ type: "placeholder", attrs: { text: "Hint" } }] },
      ]),
    ],
  });

  it("mark only the required sections that are still empty", () => {
    const decorations = requiredSectionDecorations(doc, {
      missing: [
        { key: "summary", title: "What this is about" },
        { key: "steps", title: "Steps" },
        { key: "help", title: "Did it not work?" },
      ],
      message: (missing) => `${missing.title} is required`,
    }).find();
    const keys = decorations
      .map((decoration) => (decoration.spec as { key?: string }).key)
      .filter((key): key is string => key !== undefined);
    expect(keys).toEqual(["required-summary", "required-help"]);
  });

  it("mark nothing while no section is missing", () => {
    expect(requiredSectionDecorations(doc, { missing: [], message: () => "" }).find()).toEqual([]);
  });
});

function knowledgeBase(): SpaceWithRole {
  return {
    id: SPACE_ID,
    key: "HELP",
    type: "knowledgeBase",
    audience: "groups",
    name: "Help",
    description: "",
    visibility: "private",
    discoverable: false,
    confidential: false,
    oneOnOne: false,
    quarantined: false,
    organizationId: "01929b1e-6f2a-7c3d-8e9f-0a1b2c3d4e5f",
    organizationName: "Example",
    personal: false,
    ownerId: null,
    ownerName: null,
    overviewItemId: null,
    archived: false,
    exportEnabled: true,
    createdAt: "2026-10-01T08:00:00.000Z",
    updatedAt: "2026-10-01T08:00:00.000Z",
    role: "admin",
    mayExport: true,
  } as SpaceWithRole;
}

async function showAudience(widening: boolean) {
  const api = mockApi({
    [`POST /api/v1/spaces/${SPACE_ID}/knowledge-base/audience/preview`]: () => ({
      body: { widening, articles: widening ? 140 : 0 },
    }),
    [`PUT /api/v1/spaces/${SPACE_ID}/knowledge-base/audience`]: (request) => ({
      body: {
        spaceId: SPACE_ID,
        audience: (request.body as { audience: string }).audience,
        groups: [],
        contactEmail: null,
      },
    }),
  });
  const context: SpaceContextValue = {
    space: knowledgeBase(),
    canEdit: true,
    openMove: () => undefined,
    openCopy: () => undefined,
    openCreate: () => undefined,
  };
  await renderWithProviders(
    <SpaceContext value={context}>
      <AudienceForm
        settings={{ spaceId: SPACE_ID, audience: "groups", groups: [GROUP], contactEmail: null }}
      />
    </SpaceContext>,
  );
  return api;
}

describe("the visibility of a knowledge base", () => {
  it("asks before letting more people read and names the number of articles", async () => {
    const api = await showAudience(true);
    await userEvent.click(screen.getByRole("radio", { name: /^Public/ }));
    await userEvent.click(screen.getByRole("button", { name: "Save visibility" }));
    const dialog = await screen.findByRole("dialog", { name: "Let more people read Help?" });
    expect(within(dialog).getByText(/140 articles will be readable for Public/)).toBeTruthy();
    expect(api.requests.some((request) => request.method === "PUT")).toBe(false);
    await userEvent.click(within(dialog).getByRole("button", { name: "Allow reading" }));
    await waitFor(() =>
      expect(api.requests.find((request) => request.method === "PUT")?.body).toEqual({
        audience: "public",
        groupIds: [],
        confirmWidening: true,
      }),
    );
  });

  it("narrows without asking", async () => {
    const api = await showAudience(false);
    await userEvent.click(screen.getByRole("radio", { name: /^Portal accounts/ }));
    await userEvent.click(screen.getByRole("button", { name: "Save visibility" }));
    await waitFor(() =>
      expect(api.requests.find((request) => request.method === "PUT")?.body).toEqual({
        audience: "portal",
        groupIds: [],
        confirmWidening: false,
      }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("needs a group for the group audience and says so at the field", async () => {
    const api = await showAudience(false);
    await userEvent.click(screen.getByRole("button", { name: /Remove IT team|IT team/ }));
    await userEvent.click(screen.getByRole("button", { name: "Save visibility" }));
    expect(
      await screen.findByText("Choose at least one group that may read the knowledge base."),
    ).toBeTruthy();
    expect(api.requests.length).toBe(0);
  });
});
