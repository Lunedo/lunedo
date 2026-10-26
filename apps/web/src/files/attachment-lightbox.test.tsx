import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { PageReadView } from "../editor/read-view.js";
import { PreferencesProvider } from "../preferences/preferences-provider.js";
import { mockApi, problem, renderWithProviders } from "../testing/render.js";
import { AttachmentPreviewProvider } from "./preview-host.js";

const PAGE = "01929b1e-0000-7000-8000-0000000000a9";
const PLAN = "01929b1e-0000-7000-8000-0000000000b1";
const RULES = "01929b1e-0000-7000-8000-0000000000b2";
const PHOTO = "01929b1e-0000-7000-8000-0000000000b3";

function attachment(id: string, name: string, preview: string, contentType: string) {
  return {
    id,
    itemId: PAGE,
    name,
    size: 2_400_000,
    contentType,
    preview,
    inline: preview === "image",
    version: 1,
    versions: 1,
    draft: null,
    uploadedBy: { id: "01929b1e-0000-7000-8000-0000000000c1", name: "Anna Berger" },
    uploadedAt: "2026-10-04T08:00:00.000Z",
    createdAt: "2026-10-04T08:00:00.000Z",
  };
}

const document = {
  type: "doc",
  content: [
    { type: "image", attrs: { attachmentId: PLAN, alt: "Network plan", width: 50, align: "center" } },
    { type: "file", attrs: { attachmentId: RULES, name: "firewall-rules.xlsx", preview: false } },
    { type: "image", attrs: { attachmentId: PHOTO, alt: "Server rack", width: null, align: "left" } },
  ],
};

beforeEach(() => {
  mockApi({
    "GET /api/v1/auth/session": () => problem(401, "notSignedIn"),
    [`GET /api/v1/attachments/${PLAN}`]: () => ({
      body: attachment(PLAN, "network-plan.png", "image", "image/png"),
    }),
    [`GET /api/v1/attachments/${RULES}`]: () => ({
      body: attachment(RULES, "firewall-rules.xlsx", "none", "application/octet-stream"),
    }),
    [`GET /api/v1/attachments/${PHOTO}`]: () => ({
      body: attachment(PHOTO, "rack.jpg", "image", "image/jpeg"),
    }),
  });
});

async function render() {
  return renderWithProviders(
    <PreferencesProvider>
      <AttachmentPreviewProvider canEdit={false}>
        <PageReadView document={document} references={{ people: {}, pages: {} }} pageId={PAGE} />
      </AttachmentPreviewProvider>
    </PreferencesProvider>,
  );
}

describe("the lightbox of the read view", () => {
  it("opens an image instead of a new tab and moves through the images and files of the page", async () => {
    await render();
    await userEvent.click(await screen.findByLabelText("Open Network plan large"));
    const lightbox = await screen.findByRole("dialog", { name: "network-plan.png" });
    expect(within(lightbox).getByText(/1 of 3 images and files on this page/)).toBeTruthy();
    await userEvent.keyboard("{ArrowRight}");
    expect(await screen.findByRole("dialog", { name: "firewall-rules.xlsx" })).toBeTruthy();
    expect(screen.getByText(/uploaded by Anna Berger/)).toBeTruthy();
    await userEvent.keyboard("{ArrowRight}");
    expect(await screen.findByRole("dialog", { name: "rack.jpg" })).toBeTruthy();
    await userEvent.keyboard("{ArrowRight}");
    expect(await screen.findByRole("dialog", { name: "network-plan.png" })).toBeTruthy();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("opens with the keyboard and closes with a click on the background", async () => {
    await render();
    const image = await screen.findByLabelText("Open Server rack large");
    image.focus();
    await userEvent.keyboard("{Enter}");
    const lightbox = await screen.findByRole("dialog", { name: "rack.jpg" });
    const stage = lightbox.querySelector('[role="presentation"]') as HTMLElement;
    await userEvent.click(stage);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
