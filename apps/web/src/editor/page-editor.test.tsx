import { act, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { sessionQuery } from "../api/queries.js";
import { PreferencesProvider } from "../preferences/preferences-provider.js";
import { mockApi, renderWithProviders } from "../testing/render.js";
import { closeCollaboration, discardOpenCollaborations, openCollaboration } from "./collaboration.js";
import { PageEditor } from "./page-editor.js";

const PAGE_ID = "01929b1e-0000-7000-8000-0000000000d1";
const SESSION = {
  sessionKind: "full",
  account: { id: "01929b1e-8d4b-7e3f-a05c-4d3e2f1a6b7c", email: "olivia@example.org", name: "Olivia Owner" },
  methods: ["password"],
  recentlyAuthenticated: true,
};

afterEach(() => discardOpenCollaborations());

describe("the page editor", () => {
  it("accepts typing only once the page has been loaded from the server", async () => {
    mockApi({ "GET /api/v1/account/preferences": () => ({ body: [] }) });
    await renderWithProviders(
      <PreferencesProvider>
        <PageEditor pageId={PAGE_ID} spaceId="01929b1e-0000-7000-8000-0000000000a1" spaceKey="ITOPS" />
      </PreferencesProvider>,
      "en",
      (queryClient) => queryClient.setQueryData(sessionQuery.queryKey, SESSION as never),
    );
    const content = await screen.findByRole("textbox", { name: "Page content" });
    expect(content.getAttribute("contenteditable")).toBe("false");

    const collaboration = openCollaboration(PAGE_ID);
    act(() => {
      (collaboration.provider as unknown as { emit(event: string, payload: unknown): void }).emit("synced", {
        state: true,
      });
    });
    await waitFor(() => expect(content.getAttribute("contenteditable")).toBe("true"));
    closeCollaboration(collaboration);
  });
});
