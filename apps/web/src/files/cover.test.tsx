import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { PreferencesProvider } from "../preferences/preferences-provider.js";
import { mockApi, type RecordedRequest, renderWithProviders } from "../testing/render.js";
import { CoverEditor, CoverImage } from "./cover.js";

const POST = "01929b1e-0000-7000-8000-0000000000b3";
const RACK = "01929b1e-0000-7000-8000-0000000000c2";

let requests: RecordedRequest[] = [];

beforeEach(() => {
  ({ requests } = mockApi({
    [`GET /api/v1/pages/${POST}/attachments`]: () => ({
      body: [
        {
          id: RACK,
          itemId: POST,
          name: "Rack.png",
          contentType: "image/png",
          preview: "image",
          inline: true,
          size: 1024,
          version: 1,
          versions: 1,
          uploadedAt: "2026-10-05T08:00:00.000Z",
          uploadedBy: null,
        },
        {
          id: POST.replace("b3", "c9"),
          itemId: POST,
          name: "Notes.pdf",
          contentType: "application/pdf",
          preview: "pdf",
          inline: false,
          size: 1024,
          version: 1,
          versions: 1,
          uploadedAt: "2026-10-05T08:00:00.000Z",
          uploadedBy: null,
        },
      ],
    }),
    [`PUT /api/v1/blog-posts/${POST}/cover`]: () => ({ body: {} }),
  }));
});

const covers = () => requests.filter((request) => request.method === "PUT").map((request) => request.body);

async function renderEditor(cover: { attachmentId: string; focusX: number; focusY: number } | null) {
  await renderWithProviders(
    <PreferencesProvider>
      <CoverEditor postId={POST} itemId={POST} cover={cover} onChanged={async () => undefined} />
    </PreferencesProvider>,
  );
}

describe("the cover image of a blog post", () => {
  it("offers only attached images and saves the choice at once", async () => {
    await renderEditor(null);
    await userEvent.click(await screen.findByRole("combobox", { name: "Image" }));
    expect(screen.queryByRole("option", { name: "Notes.pdf" })).toBeNull();
    await userEvent.click(await screen.findByRole("option", { name: "Rack.png" }));
    await waitFor(() => expect(covers()).toEqual([{ attachmentId: RACK, focusX: 0.5, focusY: 0.5 }]));
  });

  it("moves the focal point by click and by arrow keys", async () => {
    await renderEditor({ attachmentId: RACK, focusX: 0.5, focusY: 0.5 });
    const focus = await screen.findByRole("button", {
      name: /Focal point at 50 % from the left and 50 % from the top/,
    });
    focus.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      width: 200,
      height: 100,
      right: 200,
      bottom: 100,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    fireEvent.click(focus, { clientX: 50, clientY: 75 });
    await waitFor(() => expect(covers().at(-1)).toEqual({ attachmentId: RACK, focusX: 0.25, focusY: 0.75 }));
    focus.focus();
    await userEvent.keyboard("{ArrowRight}");
    await waitFor(() => expect(covers().at(-1)).toEqual({ attachmentId: RACK, focusX: 0.3, focusY: 0.75 }));
  });

  it("removes the cover", async () => {
    await renderEditor({ attachmentId: RACK, focusX: 0.2, focusY: 0.4 });
    await userEvent.click(await screen.findByRole("combobox", { name: "Image" }));
    await userEvent.click(await screen.findByRole("option", { name: "No cover" }));
    await waitFor(() => expect(covers()).toEqual([{ attachmentId: null }]));
  });

  it("keeps the focal point visible when lists crop the image", async () => {
    await renderWithProviders(
      <CoverImage cover={{ attachmentId: RACK, focusX: 0.2, focusY: 0.4 }} alt="Cover" />,
    );
    const image = screen.getByRole("img", { name: "Cover" });
    expect(image.getAttribute("src")).toBe(`/api/v1/attachments/${RACK}/content?size=display`);
    expect(image.style.objectPosition).toBe("20% 40%");
  });
});
