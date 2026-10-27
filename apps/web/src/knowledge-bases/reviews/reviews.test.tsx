import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode, RefObject } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SaveState } from "../../editor/save-state.js";
import { PreferencesProvider } from "../../preferences/preferences-provider.js";
import { PublishButton } from "../../spaces/page-publishing.js";
import { SpaceContext, type SpaceContextValue } from "../../spaces/space-context.js";
import type { ItemDetails, SpaceWithRole } from "../../spaces/space-queries.js";
import { mockApi, problem, renderWithProviders } from "../../testing/render.js";
import { ArticleReviewLine } from "./article-review.js";
import { DueForReview } from "./home-reviews.js";
import type { ReviewItem } from "./queries.js";
import { ReviewScreen } from "./review-screen.js";
import { ReviewSettingsScreen } from "./review-settings-screen.js";
import { reviewProgress } from "./review-status.js";

const SPACE_ID = "01929b1e-0000-7000-8000-0000000000b1";
const ARTICLE = "01929b1e-0000-7000-8000-0000000000d1";
const ORPHAN = "01929b1e-0000-7000-8000-0000000000d2";
const REVIEW = "01929b1e-0000-7000-8000-0000000000e1";
const NOW = Date.now();
const day = (offset: number) => new Date(NOW + offset * 86_400_000).toISOString();

afterEach(() => {
  vi.unstubAllGlobals();
});

function space(role: "admin" | "editor" = "admin"): SpaceWithRole {
  return {
    id: SPACE_ID,
    key: "HELP",
    type: "knowledgeBase",
    audience: "signedIn",
    name: "Help",
    description: "",
    visibility: "instance",
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
    role,
    mayExport: true,
  } as SpaceWithRole;
}

function inSpace(ui: ReactNode, role: "admin" | "editor" = "admin") {
  const context: SpaceContextValue = {
    space: space(role),
    canEdit: true,
    openMove: () => undefined,
    openCopy: () => undefined,
    openCreate: () => undefined,
  };
  const root = createRootRoute({
    component: () => (
      <PreferencesProvider>
        <SpaceContext value={context}>{ui}</SpaceContext>
      </PreferencesProvider>
    ),
  });
  const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ["/"] }) });
  return <RouterProvider router={router} />;
}

const overdue: ReviewItem = {
  id: ARTICLE,
  number: 1020,
  title: "Set up the VPN at home",
  type: "howTo",
  categoryPath: [{ id: "01929b1e-0000-7000-8000-0000000000f1", title: "IT" }],
  owner: { id: "01929b1e-0000-7000-8000-0000000000a9", name: "Lea Hoffmann", pictureRef: null },
  ownerActive: true,
  formerOwner: null,
  intervalMonths: 6,
  inherited: true,
  publishedAt: day(-400),
  reviewedAt: day(-200),
  dueAt: day(-17),
  sourceChangedAt: null,
  state: "overdue",
  language: null,
  translationOutdated: false,
};

const orphan: ReviewItem = {
  ...overdue,
  id: ORPHAN,
  title: "Printer on the third floor",
  owner: null,
  ownerActive: false,
  formerOwner: { id: "01929b1e-0000-7000-8000-0000000000a8", name: "Paul Krämer", pictureRef: null },
  dueAt: day(10),
  state: "dueSoon",
  language: null,
  translationOutdated: false,
};

describe("the review list", () => {
  it("lists due articles with their state, marks one as reviewed and undoes it", async () => {
    const api = mockApi({
      [`GET /api/v1/spaces/${SPACE_ID}/reviews`]: () => ({
        body: {
          items: [overdue, orphan],
          nextCursor: null,
          counts: { all: 2, due: 1, soon: 1, unowned: 1, translations: 0 },
        },
      }),
      [`POST /api/v1/articles/${ARTICLE}/reviews`]: () => ({
        status: 201,
        body: { reviewId: REVIEW, reviewedAt: day(0), dueAt: day(182) },
      }),
      [`DELETE /api/v1/articles/${ARTICLE}/reviews/${REVIEW}`]: () => ({ status: 204 }),
    });
    await renderWithProviders(inSpace(<ReviewScreen />));
    const list = await screen.findByRole("list", { name: "Review" });
    expect(within(list).getByText("Overdue for 17 days")).toBeTruthy();
    expect(within(list).getByText("Due in 10 days")).toBeTruthy();
    expect(within(list).getByText("Nobody (Paul Krämer left)")).toBeTruthy();
    expect(within(list).getByRole("button", { name: "Set owner" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Due (1)" })).toBeTruthy();

    const row = within(list).getByText("Set up the VPN at home").closest("li");
    if (!row) throw new Error("No row for the article");
    await userEvent.click(within(row).getByRole("button", { name: /^Mark as reviewed/ }));
    expect(await screen.findByText(/“Set up the VPN at home” marked as reviewed/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /Undo/ }));
    await waitFor(() =>
      expect(
        api.requests.some((request) => request.method === "DELETE" && request.path.includes(REVIEW)),
      ).toBe(true),
    );
  });

  it("asks only for the caller's articles when “Only my articles” is ticked", async () => {
    const api = mockApi({
      [`GET /api/v1/spaces/${SPACE_ID}/reviews`]: () => ({
        body: {
          items: [],
          nextCursor: null,
          counts: { all: 0, due: 0, soon: 0, unowned: 0, translations: 0 },
        },
      }),
    });
    await renderWithProviders(inSpace(<ReviewScreen />));
    expect(await screen.findByText("Nothing due in this selection")).toBeTruthy();
    await userEvent.click(screen.getByRole("checkbox", { name: "Only my articles" }));
    await waitFor(() =>
      expect(api.requests.some((request) => request.path.includes("mine=true"))).toBe(true),
    );
    expect(await screen.findByText("No articles in this selection")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Show all articles" }));
    expect(await screen.findByText("Nothing due in this selection")).toBeTruthy();
  });

  it("explains that reviews are off and leads space admins to the settings", async () => {
    mockApi({
      [`GET /api/v1/spaces/${SPACE_ID}/reviews`]: () => ({
        body: {
          items: [],
          nextCursor: null,
          counts: { all: 0, due: 0, soon: 0, unowned: 0, translations: 0 },
        },
      }),
      [`GET /api/v1/spaces/${SPACE_ID}/knowledge-base/reviews`]: () => ({
        body: { intervalMonths: null, leadDays: 14, recipients: "owner" },
      }),
    });
    await renderWithProviders(inSpace(<ReviewScreen />));
    expect(await screen.findByText("Reviews are off")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Set review interval" })).toBeTruthy();
  });

  it("offers to set an owner only to space admins", async () => {
    mockApi({
      [`GET /api/v1/spaces/${SPACE_ID}/reviews`]: () => ({
        body: {
          items: [orphan],
          nextCursor: null,
          counts: { all: 1, due: 0, soon: 1, unowned: 1, translations: 0 },
        },
      }),
    });
    await renderWithProviders(inSpace(<ReviewScreen />, "editor"));
    await screen.findByRole("list", { name: "Review" });
    expect(screen.queryByRole("button", { name: "Set owner" })).toBeNull();
  });

  it("keeps state, owner and actions in the row of each article, with no hidden columns", async () => {
    mockApi({
      [`GET /api/v1/spaces/${SPACE_ID}/reviews`]: () => ({
        body: {
          items: [overdue],
          nextCursor: null,
          counts: { all: 1, due: 1, soon: 0, unowned: 0, translations: 0 },
        },
      }),
    });
    await renderWithProviders(inSpace(<ReviewScreen />));
    const list = await screen.findByRole("list", { name: "Review" });
    expect(screen.queryByRole("table")).toBeNull();
    const row = within(list).getByRole("listitem");
    expect(row.className).toContain("flex-wrap");
    for (const element of [
      within(row).getByText("Overdue for 17 days"),
      within(row).getByText("Lea Hoffmann"),
      within(row).getByRole("button", { name: "Mark as reviewed: Set up the VPN at home" }),
      within(row).getByRole("link", { name: "Edit “Set up the VPN at home”" }),
    ]) {
      expect(element.closest(".hidden")).toBeNull();
    }
    expect(within(row).getByRole("link", { name: "Edit “Set up the VPN at home”" }).className).toContain(
      "after:h-hit",
    );
    expect(within(row).getByRole("button", { name: /^Mark as reviewed/ }).className).toContain("after:h-hit");
  });

  it("says that a source page changed also when the article is overdue", async () => {
    mockApi({
      [`GET /api/v1/spaces/${SPACE_ID}/reviews`]: () => ({
        body: {
          items: [{ ...overdue, sourceChangedAt: day(-2) }],
          nextCursor: null,
          counts: { all: 1, due: 1, soon: 0, unowned: 0, translations: 0 },
        },
      }),
    });
    await renderWithProviders(inSpace(<ReviewScreen />));
    const list = await screen.findByRole("list", { name: "Review" });
    expect(within(list).getByText("Overdue for 17 days")).toBeTruthy();
    expect(within(list).getByText("A source page changed since the last review")).toBeTruthy();
  });

  it("moves the focus to the next article after one was marked as reviewed", async () => {
    let reviewed = false;
    mockApi({
      [`GET /api/v1/spaces/${SPACE_ID}/reviews`]: () => ({
        body: {
          items: reviewed ? [orphan] : [overdue, orphan],
          nextCursor: null,
          counts: { all: 2, due: 1, soon: 1, unowned: 1, translations: 0 },
        },
      }),
      [`POST /api/v1/articles/${ARTICLE}/reviews`]: () => {
        reviewed = true;
        return { status: 201, body: { reviewId: REVIEW, reviewedAt: day(0), dueAt: day(182) } };
      },
    });
    await renderWithProviders(inSpace(<ReviewScreen />));
    const button = await screen.findByRole("button", { name: "Mark as reviewed: Set up the VPN at home" });
    await userEvent.click(button);
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Mark as reviewed: Printer on the third floor" }),
      ),
    );
  });
});

describe("the review settings", () => {
  it("save each field at once", async () => {
    const api = mockApi({
      [`GET /api/v1/spaces/${SPACE_ID}/knowledge-base/reviews`]: () => ({
        body: { intervalMonths: null, leadDays: 14, recipients: "owner" },
      }),
      [`PUT /api/v1/spaces/${SPACE_ID}/knowledge-base/reviews`]: (request) => ({
        body: { intervalMonths: 6, leadDays: 14, recipients: "owner", ...(request.body as object) },
      }),
    });
    await renderWithProviders(inSpace(<ReviewSettingsScreen />));
    await userEvent.click(await screen.findByRole("combobox", { name: "Review interval" }));
    await userEvent.click(await screen.findByRole("option", { name: "Every 6 months" }));
    await waitFor(() =>
      expect(api.requests.find((request) => request.method === "PUT")?.body).toEqual({ intervalMonths: 6 }),
    );
  });
});

describe("the publish popover of an article", () => {
  it("counts the publication as a review only when “Content reviewed” is ticked", async () => {
    const api = mockApi({
      "POST /api/v1/pages/01929b1e-0000-7000-8000-0000000000d1/publish": () => ({
        body: { version: 2, created: true },
      }),
    });
    const saved: RefObject<SaveState> = { current: "saved" };
    const page = { id: ARTICLE, title: "VPN", ancestors: [], spaceId: SPACE_ID } as unknown as ItemDetails;
    await renderWithProviders(
      inSpace(<PublishButton page={page} draft={undefined} saveState={saved} article />),
    );
    await userEvent.click(await screen.findByRole("button", { name: "Publish" }));
    await userEvent.click(await screen.findByRole("checkbox", { name: /Content reviewed/ }));
    await userEvent.click(screen.getByRole("button", { name: /Publish version/ }));
    await waitFor(() =>
      expect(api.requests.find((request) => request.method === "POST")?.body).toEqual({ reviewed: true }),
    );
  });

  it("does not offer the review outside knowledge bases", async () => {
    mockApi({});
    const saved: RefObject<SaveState> = { current: "saved" };
    const page = { id: ARTICLE, title: "Page", ancestors: [], spaceId: SPACE_ID } as unknown as ItemDetails;
    await renderWithProviders(inSpace(<PublishButton page={page} draft={undefined} saveState={saved} />));
    await userEvent.click(await screen.findByRole("button", { name: "Publish" }));
    expect(screen.queryByRole("checkbox", { name: /Content reviewed/ })).toBeNull();
  });
});

describe("due for review on the personal home page", () => {
  it("lists the person's articles and stays hidden when nothing is due", async () => {
    mockApi({
      "GET /api/v1/reviews/mine": () => ({
        body: {
          items: [
            {
              id: ARTICLE,
              title: "Set up the VPN at home",
              type: "howTo",
              spaceKey: "HELP",
              spaceName: "Help",
              dueAt: null,
              sourceChangedAt: day(-1),
              state: "sourceChanged",
            },
          ],
          total: 1,
        },
      }),
    });
    await renderWithProviders(inSpace(<DueForReview />));
    expect(await screen.findByRole("heading", { name: "Due for review" })).toBeTruthy();
    expect(screen.getByText("Source page changed")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Mark as reviewed: Set up the VPN at home" })).toBeTruthy();
  });

  it("shows nothing without due articles", async () => {
    mockApi({ "GET /api/v1/reviews/mine": () => ({ body: { items: [], total: 0 } }) });
    await renderWithProviders(inSpace(<DueForReview />));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByRole("heading", { name: "Due for review" })).toBeNull();
  });
});

describe("the review ring", () => {
  it("fills with the part of the interval that has passed", () => {
    const timing = { state: "current" as const, reviewedAt: day(-90), publishedAt: null, dueAt: day(90) };
    expect(reviewProgress(timing, NOW)).toBeCloseTo(0.5, 2);
    expect(reviewProgress({ ...timing, dueAt: null }, NOW)).toBe(0);
    expect(reviewProgress({ ...timing, dueAt: day(-1) }, NOW)).toBe(1);
  });
});

describe("the source pages of an article", () => {
  it("lets editors remove source pages they cannot read after asking", async () => {
    const api = mockApi({
      [`GET /api/v1/articles/${ARTICLE}/review`]: () => problem(404, "notFound"),
      [`GET /api/v1/articles/${ARTICLE}/sources`]: () => ({ body: [] }),
      [`GET /api/v1/articles/${ARTICLE}/hidden-sources`]: () => ({ body: { count: 1, changed: true } }),
      [`DELETE /api/v1/articles/${ARTICLE}/hidden-sources`]: () => ({ body: { count: 0, changed: false } }),
    });
    await renderWithProviders(
      inSpace(<ArticleReviewLine itemId={ARTICLE} title="Set up the VPN" editable published />),
    );
    expect(await screen.findByText("1 source page you cannot read")).toBeTruthy();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Remove this source page" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Only people who can read it can link it again/)).toBeTruthy();
    expect(api.requests.some((entry) => entry.method === "DELETE")).toBe(false);
    await user.click(within(dialog).getByRole("button", { name: "Remove this source page" }));
    await waitFor(() => expect(screen.queryByText("1 source page you cannot read")).toBeNull());
    expect(api.requests.filter((entry) => entry.method === "DELETE")).toHaveLength(1);
  });
});
