import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PreferencesProvider } from "../preferences/preferences-provider.js";
import { mockApi, renderWithProviders } from "../testing/render.js";
import { CommentsPanel } from "./comments-panel.js";

const BOARD = "01929b1e-0000-7000-8000-0000000000e1";
const AUTHOR = { id: "01929b1e-0000-7000-8000-0000000000e2", name: "Lukas Hofer" };

function thread(id: string, extra: Record<string, unknown>) {
  return {
    id,
    itemId: BOARD,
    parentId: null,
    author: AUTHOR,
    body: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: `Body ${id}` }] }] },
    deleted: false,
    createdAt: "2026-10-16T08:00:00.000Z",
    editedAt: null,
    reactions: [],
    quote: null,
    anchor: "page",
    elementId: null,
    resolvedAt: null,
    resolvedBy: null,
    replies: [],
    ...extra,
  };
}

const permissions = { viewerId: AUTHOR.id, canComment: true, canModerate: false, canReact: true };

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("comments on whiteboard elements", () => {
  it("name the element, show it on the board and keep threads of removed elements", async () => {
    mockApi({
      [`GET /api/v1/pages/${BOARD}/comments`]: () => ({
        body: {
          threads: [
            thread("01929b1e-0000-7000-8000-0000000000f1", {
              anchor: "element",
              elementId: "note",
              quote: "Uplink auf 10G?",
            }),
            thread("01929b1e-0000-7000-8000-0000000000f2", {
              anchor: "detached",
              elementId: "gone",
              quote: "Alter Plan",
            }),
          ],
          people: {},
        },
      }),
    });
    const onActivate = vi.fn();
    await renderWithProviders(
      <PreferencesProvider>
        <CommentsPanel
          itemId={BOARD}
          permissions={permissions}
          pending={null}
          onPendingDone={() => undefined}
          activeThread={null}
          onActivate={onActivate}
          onClose={() => undefined}
          describeElement={(elementId, quote) =>
            elementId === "note" ? `Sticky note: “${quote}”` : `“${quote}”`
          }
          hint="Select an element and choose Comment on element."
        />
      </PreferencesProvider>,
    );
    const button = await screen.findByRole("button", { name: "Sticky note: “Uplink auf 10G?”" });
    await userEvent.click(button);
    expect(onActivate).toHaveBeenCalledWith("01929b1e-0000-7000-8000-0000000000f1");
    expect(screen.getByText("Element removed. The comment stays here.")).toBeTruthy();
    expect(screen.getByText("“Alter Plan”").className).toContain("line-through");
    expect(screen.getByText("Select an element and choose Comment on element.")).toBeTruthy();
  });

  it("send a comment on the selected element with its ID", async () => {
    const { requests } = mockApi({
      [`GET /api/v1/pages/${BOARD}/comments`]: () => ({ body: { threads: [], people: {} } }),
      [`POST /api/v1/pages/${BOARD}/comments`]: () => ({
        status: 201,
        body: { id: "01929b1e-0000-7000-8000-0000000000f3" },
      }),
    });
    const done = vi.fn();
    await renderWithProviders(
      <PreferencesProvider>
        <CommentsPanel
          itemId={BOARD}
          permissions={permissions}
          pending={{ elementId: "note", label: "Sticky note" }}
          onPendingDone={done}
          activeThread={null}
          onActivate={() => undefined}
          onClose={() => undefined}
        />
      </PreferencesProvider>,
    );
    const section = (await screen.findByText("Sticky note")).closest("section");
    expect(section).toBeTruthy();
    const composer = within(section as HTMLElement).getByRole("textbox");
    await userEvent.click(composer);
    await userEvent.keyboard("Passt das?");
    await userEvent.click(within(section as HTMLElement).getByRole("button", { name: "Comment" }));
    await waitFor(() => expect(done).toHaveBeenCalled());
    const sent = requests.find((request) => request.method === "POST");
    expect(sent?.body).toMatchObject({ elementId: "note" });
    expect(JSON.stringify(sent?.body)).not.toContain("anchor");
  });
});
