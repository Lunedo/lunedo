import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { describe, expect, it } from "vitest";
import type { SaveState } from "../editor/index.js";
import { renderWithProviders } from "../testing/render.js";
import { PublishButton } from "./page-publishing.js";
import type { ItemDetails } from "./space-queries.js";

const page = (ancestors: ItemDetails["ancestors"]): ItemDetails => ({
  id: "01929b1e-0000-7000-8000-0000000000b2",
  spaceId: "01929b1e-0000-7000-8000-0000000000a1",
  parentId: ancestors.at(-1)?.id ?? null,
  kind: "page",
  title: "VPN access",
  description: "",
  width: "fixed",
  mode: "publish",
  published: false,
  archived: false,
  position: "a0",
  hasChildren: false,
  viewRestriction: "none",
  editRestricted: false,
  link: null,
  creatorId: null,
  ownerId: null,
  createdAt: "2026-10-05T08:00:00.000Z",
  updatedAt: "2026-10-05T08:00:00.000Z",
  contentUpdatedAt: "2026-10-05T08:00:00.000Z",
  spaceKey: "ITOPS",
  spaceName: "IT Operations",
  spaceAccess: true,
  ancestors,
});

async function openPublish(ancestors: ItemDetails["ancestors"], language = "en") {
  const saveState = createRef<SaveState>() as { current: SaveState };
  saveState.current = "saved";
  await renderWithProviders(
    <PublishButton page={page(ancestors)} draft={undefined} saveState={saveState} />,
    language,
  );
  await userEvent.click(
    screen.getByRole("button", { name: language === "de" ? "Veröffentlichen" : "Publish" }),
  );
}

describe("publishing below an unpublished page", () => {
  it("names the unpublished ancestors and says that only this page is published", async () => {
    await openPublish([
      { id: "01929b1e-0000-7000-8000-0000000000c1", kind: "folder", title: "Network", published: true },
      { id: "01929b1e-0000-7000-8000-0000000000c2", kind: "page", title: "Remote work", published: false },
    ]);
    expect(await screen.findByText("Readers will not see this page yet")).toBeTruthy();
    expect(
      screen.getByText(
        "It sits below “Remote work”, which is not published. Readers see this page once that page is published. Publishing here publishes only this page.",
      ),
    ).toBeTruthy();
  });

  it("names every unpublished ancestor in German", async () => {
    await openPublish(
      [
        { id: "01929b1e-0000-7000-8000-0000000000c1", kind: "page", title: "Handbuch", published: false },
        { id: "01929b1e-0000-7000-8000-0000000000c2", kind: "page", title: "Remote", published: false },
      ],
      "de",
    );
    expect(
      await screen.findByText(
        "Sie liegt unter „Handbuch“, „Remote“, die noch nicht veröffentlicht sind. Leser sehen diese Seite, sobald diese Seiten veröffentlicht sind. Hier wird nur diese Seite veröffentlicht.",
      ),
    ).toBeTruthy();
  });

  it("shows no notice when every ancestor is published", async () => {
    await openPublish([
      { id: "01929b1e-0000-7000-8000-0000000000c1", kind: "page", title: "Handbook", published: true },
    ]);
    expect(await screen.findByText("Until it is published, only editors see this page.")).toBeTruthy();
    expect(screen.queryByText("Readers will not see this page yet")).toBeNull();
  });
});
