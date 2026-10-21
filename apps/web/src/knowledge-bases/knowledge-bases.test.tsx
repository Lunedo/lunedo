import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getSchema } from "@tiptap/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { requiredSectionDecorations } from "../editor/extensions/required-sections.js";
import { schemaExtensions } from "../editor/schema/extensions.js";
import { SpaceContext, type SpaceContextValue } from "../spaces/space-context.js";
import type { SpaceWithRole } from "../spaces/space-queries.js";
import { canContain, creatableKinds } from "../spaces/space-types.js";
import { mockApi, problem, renderWithProviders } from "../testing/render.js";
import { articleTypeIcon, articleTypeLabel, knownArticleType } from "./article-types.js";
import { NamedIcon } from "./icons.js";
import { PortalLink } from "./portal-link.js";
import type { PortalSettings } from "./queries.js";
import { AddressPanel } from "./settings/address-screen.js";
import { BrandRow } from "./settings/appearance-screen.js";
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

  it("describes the public audience as it works today, through the portal", async () => {
    await showAudience(false);
    expect(
      screen.getByText(
        "Everyone, also without signing in. The portal shows the published articles, and search engines can find them.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/once the portal is available/)).toBeNull();
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

const PORTAL: PortalSettings = {
  spaceId: SPACE_ID,
  path: "help",
  domain: null,
  url: "http://localhost/help/help/",
  brand: { color: "petrol", light: null, dark: null },
  colors: { light: "#0B6F78", dark: "#5DB9C2" },
  welcomeHeading: "",
  welcomeText: "",
  topBarThreshold: 10,
  poweredBy: true,
  feedbackRetentionMonths: 12,
  logoRef: null,
};

function spaceContext(): SpaceContextValue {
  return {
    space: knowledgeBase(),
    canEdit: true,
    openMove: () => undefined,
    openCopy: () => undefined,
    openCreate: () => undefined,
  };
}

describe("the portal of a knowledge base", () => {
  it("links to the portal and to an article in it", async () => {
    mockApi({ [`GET /api/v1/spaces/${SPACE_ID}/knowledge-base/portal`]: () => ({ body: PORTAL }) });
    await renderWithProviders(
      <SpaceContext value={spaceContext()}>
        <PortalLink />
        <PortalLink article={{ number: 12, slug: "vpn-einrichten" }} />
      </SpaceContext>,
    );
    const links = await screen.findAllByRole("link", { name: "View in portal" });
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "http://localhost/help/help/",
      "http://localhost/help/help/12-vpn-einrichten",
    ]);
  });

  it("shows the DNS record before saving an own domain and checks the path without asking the server", async () => {
    const api = mockApi({
      [`GET /api/v1/spaces/${SPACE_ID}/knowledge-base/portal/domains`]: () => ({
        body: [
          {
            domain: "hilfe.example.org",
            organizationId: "01929b1e-6f2a-7c3d-8e9f-0a1b2c3d4e5f",
            organizationName: "Example",
            spaceId: null,
            spaceName: null,
            createdAt: "2026-10-19T08:00:00.000Z",
          },
        ],
      }),
      [`PUT /api/v1/spaces/${SPACE_ID}/knowledge-base/portal/address`]: (request) => ({
        body: { ...PORTAL, ...(request.body as object) },
      }),
    });
    await renderWithProviders(
      <SpaceContext value={spaceContext()}>
        <AddressPanel portal={PORTAL} />
      </SpaceContext>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Change" }));
    const path = screen.getByRole("textbox", { name: "Path" });
    await userEvent.clear(path);
    await userEvent.type(path, "Hilfe Neu");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/Use lowercase letters, digits and single hyphens/)).toBeTruthy();
    expect(api.requests.some((request) => request.method === "PUT")).toBe(false);
    await userEvent.clear(path);
    await userEvent.type(path, "hilfe-neu");
    await userEvent.click(screen.getByRole("combobox", { name: "Own domain" }));
    await userEvent.click(await screen.findByRole("option", { name: "hilfe.example.org" }));
    expect(screen.getByText("hilfe.example.org CNAME localhost.")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(api.requests.find((request) => request.method === "PUT")?.body).toEqual({
        path: "hilfe-neu",
        domain: "hilfe.example.org",
      }),
    );
  });

  it("proposes a passing shade for an own color and saves it only after confirmation", async () => {
    const api = mockApi({
      [`PUT /api/v1/spaces/${SPACE_ID}/knowledge-base/portal/appearance`]: (request) => {
        const body = request.body as { confirmProposal?: boolean };
        if (!body.confirmProposal) {
          return problem(409, "brandContrast", {
            light: { color: "#FFB000", passes: false, onBackground: 1.9, onBrand: 1.9, proposal: "#8A5F00" },
            dark: { color: "#8AA8E6", passes: true, onBackground: 7.4, onBrand: 7.8, proposal: "#8AA8E6" },
          });
        }
        return {
          body: {
            ...PORTAL,
            brand: { color: "custom", light: "#8A5F00", dark: "#8AA8E6" },
            colors: { light: "#8A5F00", dark: "#8AA8E6" },
          },
        };
      },
    });
    await renderWithProviders(
      <SpaceContext value={spaceContext()}>
        <BrandRow portal={PORTAL} editable />
      </SpaceContext>,
    );
    await userEvent.click(screen.getByRole("combobox", { name: "Brand color" }));
    await userEvent.click(await screen.findByRole("option", { name: "Own color" }));
    const light = screen.getByRole("textbox", { name: "Light mode" });
    await userEvent.clear(light);
    await userEvent.type(light, "#FFB000");
    const dark = screen.getByRole("textbox", { name: "Dark mode" });
    await userEvent.clear(dark);
    await userEvent.type(dark, "#8AA8E6");
    await userEvent.click(screen.getByRole("button", { name: "Check contrast and save" }));
    expect(await screen.findByText("The color does not reach the required contrast")).toBeTruthy();
    expect(screen.getByText("#8A5F00")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Use the proposed shades" }));
    await waitFor(() =>
      expect(api.requests.filter((request) => request.method === "PUT").at(-1)?.body).toEqual({
        brand: { color: "custom", light: "#FFB000", dark: "#8AA8E6" },
        confirmProposal: true,
      }),
    );
  });
});
