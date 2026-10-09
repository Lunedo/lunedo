import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PreferencesProvider } from "../preferences/preferences-provider.js";
import { mockApi, renderWithProviders } from "../testing/render.js";
import { PrivateNotesPanel } from "./private-notes-panel.js";

const MEETING = "01929b1e-0000-7000-8000-0000000000e1";

function paragraph(text: string) {
  return { type: "paragraph", content: [{ type: "text", text }] };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("private notes", () => {
  it("say that only their author can read them and copy them into the shared notes", async () => {
    const api = mockApi({
      [`GET /api/v1/meetings/${MEETING}/private-notes`]: () => ({
        body: {
          meetingId: MEETING,
          document: { type: "doc", content: [paragraph("Ask about the raise")] },
          schemaVersion: 4,
          revision: 2,
          updatedAt: "2026-10-12T07:40:00.000Z",
        },
      }),
      [`GET /api/v1/pages/${MEETING}/content`]: () => ({
        body: {
          itemId: MEETING,
          title: "Jour fixe",
          version: null,
          document: { type: "doc", content: [paragraph("Agenda")] },
          schemaVersion: 4,
          revision: 3,
          updatedAt: "2026-10-12T07:00:00.000Z",
          updatedBy: null,
          references: { people: {}, pages: {}, topics: {} },
        },
      }),
      [`PUT /api/v1/pages/${MEETING}/content`]: () => ({ body: {} }),
    });
    await renderWithProviders(
      <PreferencesProvider>
        <PrivateNotesPanel meetingId={MEETING} canCopy onClose={() => undefined} />
      </PreferencesProvider>,
    );
    expect(await screen.findByText(/Only you can read these notes/)).toBeTruthy();
    expect(await screen.findByText("Ask about the raise")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Copy to meeting notes" }));
    await waitFor(() => {
      const put = api.requests.find((request) => request.method === "PUT");
      expect(put?.body).toEqual({
        document: {
          type: "doc",
          content: [
            paragraph("Agenda"),
            { ...paragraph("Ask about the raise"), attrs: { indent: 0, textAlign: "left" } },
          ],
        },
      });
    });
  });

  it("offer no copy without edit access to the meeting", async () => {
    mockApi({
      [`GET /api/v1/meetings/${MEETING}/private-notes`]: () => ({
        body: {
          meetingId: MEETING,
          document: { type: "doc", content: [paragraph("Mine")] },
          schemaVersion: 4,
          revision: 0,
          updatedAt: null,
        },
      }),
    });
    await renderWithProviders(
      <PreferencesProvider>
        <PrivateNotesPanel meetingId={MEETING} canCopy={false} onClose={() => undefined} />
      </PreferencesProvider>,
    );
    expect(await screen.findByText("Mine")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Copy to meeting notes" })).toBeNull();
  });
});
