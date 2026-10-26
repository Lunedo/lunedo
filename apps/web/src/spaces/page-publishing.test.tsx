import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MissingSection } from "../editor/extensions/required-sections.js";
import { mockApi, renderWithProviders } from "../testing/render.js";
import type { Draft } from "./content-queries.js";
import { DraftBanner, DraftStatusLine, PublishButton } from "./page-publishing.js";
import { contentQuery, type ItemDetails } from "./space-queries.js";

function draft(names: string[], overrides: Partial<Draft> = {}): Draft {
  return {
    hasChanges: true,
    changes: 4,
    basedOn: 2,
    contributors: names.map((name, index) => ({ id: `0192a000-0000-7000-8000-00000000000${index}`, name })),
    ...overrides,
  } as Draft;
}

describe("the draft banner", () => {
  it("uses the verb that fits one or several people in German", async () => {
    await renderWithProviders(
      <DraftBanner draft={draft(["Olivia Owner", "Bea Berger"])} onOpen={() => undefined} />,
      "de",
    );
    expect(
      screen.getByText(
        "Olivia Owner und Bea Berger haben an einem Entwurf mit 4 unveröffentlichten Änderungen gearbeitet. Du siehst die veröffentlichte Version.",
      ),
    ).toBeTruthy();
  });

  it("keeps the singular for one person and one change in German", async () => {
    await renderWithProviders(
      <DraftBanner draft={draft(["Olivia Owner"], { changes: 1 })} onOpen={() => undefined} />,
      "de",
    );
    expect(
      screen.getByText(
        "Olivia Owner hat an einem Entwurf mit 1 unveröffentlichten Änderung gearbeitet. Du siehst die veröffentlichte Version.",
      ),
    ).toBeTruthy();
  });

  it("names several people in English", async () => {
    await renderWithProviders(
      <DraftBanner draft={draft(["Olivia Owner", "Bea Berger"])} onOpen={() => undefined} />,
    );
    expect(
      screen.getByText(
        "Olivia Owner and Bea Berger worked on a draft with 4 unpublished changes. You see the published version.",
      ),
    ).toBeTruthy();
  });
});

describe("the draft status line", () => {
  it("keeps the separator at the end of the line before it instead of at the start of the next", async () => {
    await renderWithProviders(<DraftStatusLine draft={draft(["Olivia Owner"])} />);
    const line = screen.getByRole("status");
    expect(line.textContent).toContain("since version 2 · Readers see version 2");
  });
});

describe("publishing with an empty required section", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("closes and hands the empty required sections to the editor", async () => {
    const pageId = "01929b1e-0000-7000-8000-0000000000e1";
    mockApi({
      [`POST /api/v1/pages/${pageId}/publish`]: () => ({
        status: 409,
        body: {
          type: "urn:lunedo:problem:requiredSectionsEmpty",
          title: "Required sections are empty",
          status: 409,
          code: "requiredSectionsEmpty",
          sections: [{ key: "steps", title: "Steps" }],
        },
      }),
    });
    const reported: MissingSection[][] = [];
    const page = {
      id: pageId,
      spaceId: "01929b1e-0000-7000-8000-0000000000a1",
      ancestors: [],
    } as unknown as ItemDetails;
    await renderWithProviders(
      <PublishButton
        page={page}
        draft={draft(["Olivia Owner"], { basedOn: null })}
        saveState={{ current: "saved" }}
        onMissingSections={(sections) => reported.push(sections)}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Publish" }));
    await userEvent.click(await screen.findByRole("button", { name: "Publish version 1" }));
    await waitFor(() => expect(reported).toEqual([[{ key: "steps", title: "Steps" }]]));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Publish version 1" })).toBeNull());
  });
});

describe("updating a published page", () => {
  const pageId = "01929b1e-0000-7000-8000-0000000000e2";
  const page = {
    id: pageId,
    spaceId: "01929b1e-0000-7000-8000-0000000000a1",
    ancestors: [],
  } as unknown as ItemDetails;

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function api() {
    return mockApi({
      [`POST /api/v1/pages/${pageId}/publish`]: () => ({ body: { created: true, version: 3 } }),
    });
  }

  it("publishes at once without a dialog and leaves edit mode", async () => {
    const calls = api();
    const onPublished = vi.fn();
    await renderWithProviders(
      <PublishButton
        page={page}
        draft={draft(["Olivia Owner"])}
        saveState={{ current: "saved" }}
        onPublished={onPublished}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Update" }));
    await waitFor(() => expect(onPublished).toHaveBeenCalledOnce());
    expect(calls.requests.find((request) => request.method === "POST")?.body).toEqual({});
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(await screen.findByText("Updated · version 3")).toBeTruthy();
  });

  it("asks for a change note only from the menu and leaves edit mode afterwards", async () => {
    const calls = api();
    const onPublished = vi.fn();
    await renderWithProviders(
      <PublishButton
        page={page}
        draft={draft(["Olivia Owner"])}
        saveState={{ current: "saved" }}
        onPublished={onPublished}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "More ways to update" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Update with a change note …" }));
    const dialog = await screen.findByRole("dialog", { name: "Update with a change note" });
    await userEvent.type(
      within(dialog).getByRole("textbox", { name: /What changed/ }),
      "Added the VPN section",
    );
    await userEvent.click(within(dialog).getByRole("button", { name: "Update as version 3" }));
    await waitFor(() => expect(onPublished).toHaveBeenCalledOnce());
    expect(calls.requests.find((request) => request.method === "POST")?.body).toEqual({
      note: "Added the VPN section",
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("marks knowledge base articles as reviewed and offers to discard the draft", async () => {
    const calls = api();
    const onDiscard = vi.fn();
    await renderWithProviders(
      <PublishButton
        page={page}
        draft={draft(["Olivia Owner"])}
        saveState={{ current: "saved" }}
        onDiscard={onDiscard}
        article
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "More ways to update" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Mark as reviewed and update" }));
    await waitFor(() =>
      expect(calls.requests.find((request) => request.method === "POST")?.body).toEqual({ reviewed: true }),
    );
    await userEvent.click(screen.getByRole("button", { name: "More ways to update" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Discard draft" }));
    expect(onDiscard).toHaveBeenCalledOnce();
  });

  it("keeps Publish with its details for a page that was never published and leaves edit mode", async () => {
    const calls = mockApi({
      [`POST /api/v1/pages/${pageId}/publish`]: () => ({ body: { created: true, version: 1 } }),
      [`GET /api/v1/pages/${pageId}/content`]: () => ({ body: { document: { type: "doc", content: [] } } }),
    });
    const onPublished = vi.fn();
    await renderWithProviders(
      <PublishButton
        page={page}
        draft={draft(["Olivia Owner"], { basedOn: null })}
        saveState={{ current: "saved" }}
        onPublished={onPublished}
      />,
      "en",
      (queryClient) => void queryClient.prefetchQuery(contentQuery(pageId)),
    );
    expect(screen.queryByRole("button", { name: "Update" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Publish" }));
    await userEvent.click(await screen.findByRole("button", { name: "Publish version 1" }));
    await waitFor(() => expect(onPublished).toHaveBeenCalledOnce());
    expect(
      calls.requests.some((request) => request.method === "GET" && request.path.endsWith("/content")),
    ).toBe(true);
  });
});
