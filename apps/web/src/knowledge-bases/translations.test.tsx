import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PreferencesProvider } from "../preferences/preferences-provider.js";
import { SpaceContext, type SpaceContextValue } from "../spaces/space-context.js";
import type { SpaceWithRole } from "../spaces/space-queries.js";
import { mockApi, problem, renderWithProviders } from "../testing/render.js";
import type { ArticleTranslations, LanguageSettings } from "./queries.js";
import { LanguagesScreen } from "./settings/languages-screen.js";
import { TranslationsControl } from "./translations-control.js";

const SPACE_ID = "01929b1e-0000-7000-8000-0000000000b1";
const ORIGINAL = "01929b1e-0000-7000-8000-0000000000d1";
const ENGLISH = "01929b1e-0000-7000-8000-0000000000d2";

afterEach(() => {
  vi.unstubAllGlobals();
});

function space(role: "admin" | "editor" = "admin"): SpaceWithRole {
  return {
    id: SPACE_ID,
    key: "HELP",
    type: "knowledgeBase",
    audience: "public",
    name: "Hilfe",
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

const LANGUAGES: LanguageSettings = {
  spaceId: SPACE_ID,
  defaultLanguage: "de",
  languages: ["de", "en"],
  articles: 140,
  progress: [{ language: "en", translated: 12, outdated: 2, missing: 128 }],
  searchUpdate: null,
};

describe("languages of a knowledge base", () => {
  it("shows the state of the translations and saves the default language at once", async () => {
    const api = mockApi({
      [`GET /api/v1/spaces/${SPACE_ID}/knowledge-base/languages`]: () => ({ body: LANGUAGES }),
      [`PUT /api/v1/spaces/${SPACE_ID}/knowledge-base/languages`]: () =>
        problem(409, "defaultLanguageTranslated", {
          translations: 3,
        }),
    });
    await renderWithProviders(inSpace(<LanguagesScreen />));
    expect(await screen.findByText("12 of 140 articles translated")).toBeTruthy();
    expect(screen.getByText("128 missing")).toBeTruthy();
    expect(screen.getByText("2 outdated")).toBeTruthy();
    const user = userEvent.setup();
    await user.click(screen.getByRole("combobox", { name: "Default language" }));
    await user.click(await screen.findByRole("option", { name: "English" }));
    await waitFor(() => expect(api.requests.some((request) => request.method === "PUT")).toBe(true));
    expect(api.requests.find((request) => request.method === "PUT")?.body).toEqual({ defaultLanguage: "en" });
    expect(await screen.findByText(/already have translations/)).toBeTruthy();
  });

  it("says before a change that search is updated and shows the progress until it is done", async () => {
    let remaining = 2;
    mockApi({
      [`GET /api/v1/spaces/${SPACE_ID}/knowledge-base/languages`]: () => ({
        body: { ...LANGUAGES, searchUpdate: remaining > 0 ? { remaining, total: 140 } : null },
      }),
    });
    await renderWithProviders(inSpace(<LanguagesScreen />));
    expect(
      await screen.findByText(/A change updates the search of all articles in the background/),
    ).toBeTruthy();
    expect(screen.getByText(/Search is being updated: 2 of 140 articles left/)).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: "Search update" }).getAttribute("aria-valuenow")).toBe(
      "138",
    );
    remaining = 0;
    await waitFor(() => expect(screen.queryByText(/Search is being updated/)).toBeNull(), { timeout: 5000 });
  });

  it("says that readers see nothing about languages while only one is enabled", async () => {
    mockApi({
      [`GET /api/v1/spaces/${SPACE_ID}/knowledge-base/languages`]: () => ({
        body: { ...LANGUAGES, languages: ["de"], progress: [] },
      }),
    });
    await renderWithProviders(inSpace(<LanguagesScreen />));
    expect(
      await screen.findByText("Only one language is enabled, so readers see nothing about languages."),
    ).toBeTruthy();
  });
});

describe("translations of an article", () => {
  const translations = (
    states: Partial<Record<"en" | "fr", ArticleTranslations["translations"][number]["state"]>>,
  ) =>
    ({
      sourceId: ORIGINAL,
      spaceId: SPACE_ID,
      defaultLanguage: "de",
      language: "de",
      translations: [
        { language: "de", itemId: ORIGINAL, title: "Passwort ändern", state: "original", enabled: true },
        {
          language: "en",
          itemId: states.en === "missing" ? null : ENGLISH,
          title: states.en === "missing" ? null : "Change the password",
          state: states.en ?? "current",
          enabled: true,
        },
      ],
    }) satisfies ArticleTranslations;

  it("lists the languages with their state and creates a missing translation", async () => {
    const api = mockApi({
      [`GET /api/v1/articles/${ORIGINAL}/translations`]: () => ({ body: translations({ en: "missing" }) }),
      [`POST /api/v1/articles/${ORIGINAL}/translations`]: () => ({
        status: 201,
        body: { id: ENGLISH, title: "Passwort ändern" },
      }),
    });
    await renderWithProviders(
      inSpace(<TranslationsControl itemId={ORIGINAL} spaceId={SPACE_ID} spaceKey="HELP" editable />),
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Languages of the article: German" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Missing")).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Translate into English" }));
    await waitFor(() =>
      expect(api.requests.find((request) => request.method === "POST")?.body).toEqual({ language: "en" }),
    );
  });

  it("marks an outdated translation and offers no creation to readers", async () => {
    mockApi({
      [`GET /api/v1/articles/${ENGLISH}/translations`]: () => ({
        body: { ...translations({ en: "outdated" }), language: "en" },
      }),
    });
    await renderWithProviders(
      inSpace(<TranslationsControl itemId={ENGLISH} spaceId={SPACE_ID} spaceKey="HELP" editable={false} />),
    );
    const trigger = await screen.findByRole("button", { name: "Languages of the article: English" });
    expect(within(trigger).getByText("Outdated")).toBeTruthy();
    const user = userEvent.setup();
    await user.click(trigger);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/published after this translation/)).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: /Translate into/ })).toBeNull();
    expect(within(dialog).getByRole("link", { name: "Open" }).getAttribute("href")).toContain(ORIGINAL);
  });

  it("shows nothing while the knowledge base has one language", async () => {
    mockApi({
      [`GET /api/v1/articles/${ORIGINAL}/translations`]: () => ({
        body: { ...translations({}), translations: [translations({}).translations[0]] },
      }),
    });
    const { queryClient } = await renderWithProviders(
      inSpace(<TranslationsControl itemId={ORIGINAL} spaceId={SPACE_ID} spaceKey="HELP" editable />),
    );
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));
    expect(screen.queryByRole("button", { name: /Languages of the article/ })).toBeNull();
  });
});
